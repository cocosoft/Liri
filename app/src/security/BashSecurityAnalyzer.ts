/**
 * Bash 安全分析器
 *
 * 参考 cc_code/backend/tools/BashTool/bashSecurity.ts 实现
 * 提供多层次的命令安全检查
 *
 * 使用Rust原生库进行高性能模式匹配（编译时零依赖C FFI）
 * 当原生库不可用时自动降级为TypeScript模式匹配
 */

import { checkBashAllowlist } from '../tools/BashAllowlistMatcher';

let nativeAnalyzeSave: ((command: string) => object | null) | null = null;

function lazyInitNative() {
  if (nativeAnalyzeSave === undefined) {
    try {
      const native = require('../../native');
      if (native && typeof native.analyzeBashCommand === 'function') {
        nativeAnalyzeSave = (command) => {
          try {
            return native.analyzeBashCommand(command);
          } catch (err) {
            return null;
          }
        };
        nativeDegraded = false;
        nativeDegradeReason = null;
      } else {
        nativeAnalyzeSave = null;
        nativeDegraded = true;
        nativeDegradeReason = '原生模块导出缺少 analyzeBashCommand 函数';
        logger.warn('Rust原生安全分析器不可用，降级为TypeScript分析', {
          reason: nativeDegradeReason,
        });
      }
    } catch (err) {
      nativeAnalyzeSave = null;
      nativeDegraded = true;
      nativeDegradeReason = '原生模块加载失败';
      logger.warn('Rust原生安全分析器不可用，降级为TypeScript分析', {
        reason: nativeDegradeReason,
      });
    }
  }
  return nativeAnalyzeSave;
}

import type {
  SecurityAnalysisResult,
  SecurityPattern,
  SecurityCheckContext,
  SecurityBehavior,
  RiskLevel,
} from './types';
import {
  DANGEROUS_COMMAND_PATTERNS,
  DANGEROUS_BASE_COMMANDS,
  INJECTION_PATTERNS,
  IFS_INJECTION_PATTERNS,
  ENV_INJECTION_PATTERNS,
  ZSH_SPECIFIC_PATTERNS,
  ZSH_DANGEROUS_COMMANDS,
  PRIVILEGE_ESCALATION_COMMANDS,
  SPECIAL_CHAR_PATTERNS,
} from './patterns';
import { parseCommand, type IParsedCommand } from './bash/ParsedCommand';
import { analyzeBashCommand, type BashAnalysisResult } from './bash/BashAST';
import {
  extractHeredocs,
  hasHeredoc,
  isHeredocSafe,
  type HeredocInfo,
} from './bash/HeredocHandler';
import { classifyCommand, type CommandCategory } from './bash/CommandRegistry';
import { hasUnterminatedQuote, hasShellQuoteBug } from './bash/QuoteHandler';
import {
  PathValidator,
  createDefaultPathValidator,
  isDangerousRemovalPath,
} from './validation/PathValidator.js';
import { configManager } from '@modules/config';
import type { PermissionConfig } from '@modules/config/types';
import { loadRules } from '@modules/config/types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'security:bashAnalyzer',
  level: LogLevel.INFO,
});

/** 标记原生分析器是否已降级 */
let nativeDegraded = false;
/** 标记原生分析器降级原因 */
let nativeDegradeReason: string | null = null;

const ADDITIONAL_DANGEROUS_COMMANDS = new Set([
  'chgrp',
  'usermod',
  'groupadd',
  'groupdel',
  'passwd',
  'su',
  'sudo',
  'doas',
  'pkexec',
]);

const DEFAULT_SENSITIVE_DIRECTORIES = [
  '/etc',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/var',
  '/boot',
  '/lib',
  '/lib64',
];

export class BashSecurityAnalyzer {
  private allPatterns: SecurityPattern[];
  private pathValidator: PathValidator;
  private sensitiveDirectories: string[];
  /** 合并用户黑名单后的危险命令集合 */
  private dangerousCommands: Set<string>;

  constructor() {
    this.allPatterns = [
      ...DANGEROUS_COMMAND_PATTERNS,
      ...INJECTION_PATTERNS,
      ...IFS_INJECTION_PATTERNS,
      ...ENV_INJECTION_PATTERNS,
      ...ZSH_SPECIFIC_PATTERNS,
      ...PRIVILEGE_ESCALATION_COMMANDS,
      ...SPECIAL_CHAR_PATTERNS,
    ];
    this.pathValidator = createDefaultPathValidator();

    // 从用户配置加载敏感目录，未配置时使用默认值
    this.sensitiveDirectories = this.loadSensitiveDirectories();

    // 合并默认危险命令与用户自定义黑名单
    this.dangerousCommands = this.loadCommandRules();
  }

  /**
   * 白名单前置检查：当 config.json 配置了 whitelist 模式时，
   * 只放行匹配白名单的指令，其余直接拒绝
   */
  private checkWhitelistPreCheck(
    command: string
  ): SecurityAnalysisResult | null {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const rules = permission?.customRules?.commandRules;
      if (!rules || rules.mode !== 'whitelist') return null;

      const whitelistPatterns = rules.whitelist || [];
      const matched = whitelistPatterns.some((r) =>
        command.toLowerCase().includes(r.pattern.toLowerCase())
      );

      if (matched) {
        return {
          safe: true,
          behavior: 'allow' as SecurityBehavior,
          riskLevel: 'low' as RiskLevel,
          matchedPatterns: [],
        };
      }

      return {
        safe: false,
        behavior: 'deny' as SecurityBehavior,
        riskLevel: 'high' as RiskLevel,
        matchedPatterns: [`未匹配白名单规则: ${command}`],
      };
    } catch (err) {
      // 安全修复：白名单检查异常时，熔断为拒绝（而非静默跳过）
      return {
        safe: false,
        behavior: 'deny' as SecurityBehavior,
        riskLevel: 'high' as RiskLevel,
        matchedPatterns: ['白名单检查异常，已熔断拒绝'],
      };
    }
  }

  /**
   * 从用户配置加载敏感目录列表，未配置时降级到硬编码默认值
   */
  private loadSensitiveDirectories(): string[] {
    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const blacklist = permission?.customRules?.directoryRules?.blacklist;
      if (blacklist && blacklist.length > 0) {
        const userDirs = blacklist
          .map((r) => r.path)
          .filter((p: string) => p.startsWith('/'));
        return loadRules(
          DEFAULT_SENSITIVE_DIRECTORIES,
          userDirs.length > 0 ? userDirs : undefined
        );
      }
    } catch (err) {
      // config 系统未初始化时静默降级
    }
    return [...DEFAULT_SENSITIVE_DIRECTORIES];
  }

  /**
   * 从用户配置加载命令黑名单，合并到默认危险命令集合
   * 用户配置的 blacklist 会追加到默认危险命令列表末尾
   */
  private loadCommandRules(): Set<string> {
    const merged = new Set<string>([
      ...DANGEROUS_BASE_COMMANDS,
      ...ADDITIONAL_DANGEROUS_COMMANDS,
    ]);

    try {
      const permission =
        configManager.getConfigValue<PermissionConfig>('permission');
      const rules = permission?.customRules?.commandRules;
      if (rules?.blacklist && rules.blacklist.length > 0) {
        for (const rule of rules.blacklist) {
          merged.add(rule.pattern.toLowerCase());
        }
      }
    } catch (err) {
      // config 系统未初始化时静默降级
    }

    return merged;
  }

  /**
   * 分析命令安全性
   * @param command 命令字符串
   * @param trustLevel 信任级别（可选），用于信任工作区场景下行为降级
   */
  analyze(command: string, trustLevel?: string): SecurityAnalysisResult {
    if (!command) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        matchedPatterns: [],
      };
    }

    // P3-3: allowlist 前缀匹配 — 仅放行已知安全命令，拒绝含 shell operator 的命令
    const allowlistCheck = checkBashAllowlist(trimmedCommand);
    if (!allowlistCheck.safe) {
      return {
        safe: false,
        behavior: 'deny',
        riskLevel: 'high',
        matchedPatterns: [`Bash allowlist rejected: ${allowlistCheck.reason}`],
      };
    }

    // 前置检查：白名单模式 — 配置了 whitelist 时，只放行匹配的指令
    {
      const preCheck = this.checkWhitelistPreCheck(trimmedCommand);
      if (preCheck) return preCheck;
    }

    // 尝试Rust原生安全分析作为第一遍检查
    const nativeAnalyze = lazyInitNative();
    if (nativeAnalyze) {
      try {
        const nativeResult = nativeAnalyze(trimmedCommand) as any;
        if (nativeResult) {
          const matchedPatterns: string[] = [];
          let highestRiskLevel: RiskLevel = 'low';
          let finalBehavior: SecurityBehavior = 'allow';
          const messages: string[] = [];

          // 映射Rust结果到TS类型
          if (nativeResult.risk_level === 'dangerous') {
            highestRiskLevel = 'high';
            finalBehavior = 'deny';
            messages.push(
              `检测到危险命令: ${nativeResult.matches?.map((m: any) => m.pattern).join(', ') || trimmedCommand}`
            );
            if (nativeResult.matches) {
              for (const m of nativeResult.matches) {
                matchedPatterns.push(m.type || m.pattern);
              }
            }
          } else if (nativeResult.risk_level === 'suspicious') {
            highestRiskLevel = 'medium';
            finalBehavior = 'ask';
            messages.push('命令存在可疑特征');
            if (nativeResult.matches) {
              for (const m of nativeResult.matches) {
                matchedPatterns.push(m.type || m.pattern);
              }
            }
          }

          // 注入类型检测
          if (nativeResult.injection_types?.length > 0) {
            for (const inj of nativeResult.injection_types) {
              matchedPatterns.push(`injection:${inj}`);
            }
            highestRiskLevel = 'high';
            finalBehavior = 'deny';
            messages.push(
              `检测到注入攻击: ${nativeResult.injection_types.join(', ')}`
            );
          }

          // 原生检查通过了，但仍然需要运行TS特有的检查
          const context = this.buildContext(trimmedCommand);
          const augmentedResult = this.runAugmentedChecks(
            trimmedCommand,
            context,
            matchedPatterns,
            highestRiskLevel,
            finalBehavior,
            messages
          );
          return this.applyTrustLevelBehavior(augmentedResult, trustLevel);
        }
      } catch (err) {
        // 降级到TypeScript完整分析
      }
    }

    // TypeScript降级：完整分析
    const result = this.runFullAnalysis(trimmedCommand);
    return this.applyTrustLevelBehavior(result, trustLevel);
  }

  /**
   * 在Rust原生分析基础上，补充TS特有的安全检查
   */
  private runAugmentedChecks(
    trimmedCommand: string,
    context: SecurityCheckContext,
    matchedPatterns: string[],
    highestRiskLevel: RiskLevel,
    finalBehavior: SecurityBehavior,
    messages: string[]
  ): SecurityAnalysisResult {
    let risk = highestRiskLevel;
    let behavior = finalBehavior;

    if (
      this.checkDangerousBaseCommand(context.baseCommand) &&
      !matchedPatterns.includes('dangerous_base_command')
    ) {
      matchedPatterns.push('dangerous_base_command');
      risk = this.isHigherRisk('high', risk) ? 'high' : risk;
      if (behavior === 'allow') behavior = 'ask';
      messages.push(`检测到危险基础命令: ${context.baseCommand}`);
    }

    if (
      this.checkDangerousPathOperations(trimmedCommand) &&
      !matchedPatterns.includes('dangerous_path_operation')
    ) {
      matchedPatterns.push('dangerous_path_operation');
      risk = this.isHigherRisk('high', risk) ? 'high' : risk;
      if (behavior === 'allow') behavior = 'ask';
      messages.push('检测到危险路径操作，需要路径验证');
    }

    if (
      this.checkSensitiveDirectoryAccess(trimmedCommand) &&
      !matchedPatterns.includes('sensitive_directory_access')
    ) {
      matchedPatterns.push('sensitive_directory_access');
      risk = this.isHigherRisk('high', risk) ? 'high' : risk;
      if (behavior === 'allow') behavior = 'ask';
      messages.push('检测到访问敏感系统目录');
    }

    if (
      this.checkEnvVarPollution(trimmedCommand) &&
      !matchedPatterns.includes('env_var_pollution')
    ) {
      matchedPatterns.push('env_var_pollution');
      risk = this.isHigherRisk('high', risk) ? 'high' : risk;
      if (behavior === 'allow') behavior = 'ask';
      messages.push('检测到环境变量污染攻击尝试');
    }

    if (
      this.checkZshEqualsExpansion(trimmedCommand) &&
      !matchedPatterns.includes('zsh_equals_expansion')
    ) {
      matchedPatterns.push('zsh_equals_expansion');
      risk = this.isHigherRisk('high', risk) ? 'high' : risk;
      behavior = 'deny';
      messages.push('检测到Zsh equals expansion绕过尝试');
    }

    const safe = behavior === 'allow';
    return {
      safe,
      behavior: behavior,
      riskLevel: risk,
      message: messages.length > 0 ? messages.join('; ') : undefined,
      matchedPatterns,
    };
  }

  /**
   * 完整的TypeScript分析（降级路径）
   */
  private runFullAnalysis(trimmedCommand: string): SecurityAnalysisResult {
    const context = this.buildContext(trimmedCommand);
    const matchedPatterns: string[] = [];
    let highestRiskLevel: RiskLevel = 'low';
    let finalBehavior: SecurityBehavior = 'allow';
    const messages: string[] = [];

    for (const pattern of this.allPatterns) {
      if (pattern.pattern.test(trimmedCommand)) {
        matchedPatterns.push(pattern.name);

        if (this.isHigherRisk(pattern.riskLevel, highestRiskLevel)) {
          highestRiskLevel = pattern.riskLevel;
        }

        if (pattern.behavior === 'deny') {
          finalBehavior = 'deny';
        } else if (pattern.behavior === 'ask' && finalBehavior !== 'deny') {
          finalBehavior = 'ask';
        }

        messages.push(pattern.message);
      }
    }

    if (this.checkDangerousBaseCommand(context.baseCommand)) {
      matchedPatterns.push('dangerous_base_command');
      highestRiskLevel = 'high';
      finalBehavior = 'ask';
      messages.push(`检测到危险基础命令: ${context.baseCommand}`);
    }

    if (
      context.shellType === 'zsh' &&
      ZSH_DANGEROUS_COMMANDS.has(context.baseCommand)
    ) {
      matchedPatterns.push('zsh_dangerous_command');
      highestRiskLevel = 'high';
      finalBehavior = 'deny';
      messages.push(`检测到 Zsh 危险命令: ${context.baseCommand}`);
    }

    if (this.checkDangerousPathOperations(trimmedCommand)) {
      matchedPatterns.push('dangerous_path_operation');
      if (highestRiskLevel !== 'high') {
        highestRiskLevel = 'high';
      }
      finalBehavior = 'ask';
      messages.push('检测到危险路径操作，需要路径验证');
    }

    if (this.checkSensitiveDirectoryAccess(trimmedCommand)) {
      matchedPatterns.push('sensitive_directory_access');
      if (highestRiskLevel !== 'high') {
        highestRiskLevel = 'high';
      }
      if (finalBehavior === 'allow') {
        finalBehavior = 'ask';
      }
      messages.push('检测到访问敏感系统目录');
    }

    if (this.checkEnvVarPollution(trimmedCommand)) {
      matchedPatterns.push('env_var_pollution');
      if (highestRiskLevel !== 'high') {
        highestRiskLevel = 'high';
      }
      if (finalBehavior === 'allow') {
        finalBehavior = 'ask';
      }
      messages.push('检测到环境变量污染攻击尝试');
    }

    if (this.checkNullByteInjection(trimmedCommand)) {
      matchedPatterns.push('null_byte_injection');
      highestRiskLevel = 'high';
      finalBehavior = 'deny';
      messages.push('检测到空字节注入攻击');
    }

    if (this.checkZeroWidthCharacters(trimmedCommand)) {
      matchedPatterns.push('zero_width_characters');
      highestRiskLevel = 'high';
      finalBehavior = 'deny';
      messages.push('检测到Unicode零宽字符，可能隐藏恶意代码');
    }

    if (this.checkZshEqualsExpansion(trimmedCommand)) {
      matchedPatterns.push('zsh_equals_expansion');
      highestRiskLevel = 'high';
      finalBehavior = 'deny';
      messages.push('检测到Zsh equals expansion绕过尝试');
    }

    const safe = finalBehavior === 'allow';

    return {
      safe,
      behavior: finalBehavior,
      riskLevel: highestRiskLevel,
      message: messages.length > 0 ? messages.join('; ') : undefined,
      matchedPatterns,
    };
  }

  /**
   * 检查危险路径操作
   */
  private checkDangerousPathOperations(command: string): boolean {
    const pathPatterns = [
      /\brm\s+(-[rf]+\s+)?\/[^s]/,
      /\brm\s+(-[rf]+\s+)?~\//,
      /\brm\s+(-[rf]+\s+)?[A-Z]:\\/,
      /\bchmod\s+777\s+\/[^s]/,
      /\bchmod\s+777\s+~\//,
      /\bmv\s+.*\/(etc|usr|var|tmp|home)\b/,
      /\bcp\s+.*\/(etc|usr|var|tmp|home)\b/,
    ];

    return pathPatterns.some((pattern) => pattern.test(command));
  }

  /**
   * 构建检查上下文
   */
  private buildContext(command: string): SecurityCheckContext {
    const baseCommand = this.extractBaseCommand(command);
    const shellType = this.detectShellType(command);

    return {
      command,
      baseCommand,
      shellType,
    };
  }

  /**
   * 提取基础命令
   */
  private extractBaseCommand(command: string): string {
    if (!command) {
      return '';
    }

    const parts = command.trim().split(/\s+/);
    let baseCmd = parts[0] || '';

    if (baseCmd.includes('=')) {
      const eqIndex = baseCmd.indexOf('=');
      baseCmd = baseCmd.substring(eqIndex + 1) || baseCmd;
    }

    return baseCmd.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  }

  /**
   * 检测 Shell 类型
   */
  private detectShellType(
    command: string
  ): 'bash' | 'zsh' | 'powershell' | 'unknown' {
    if (!command) {
      return 'unknown';
    }

    if (command.includes('zsh') || command.includes('=curl')) {
      return 'zsh';
    }
    if (command.includes('powershell') || command.includes('pwsh')) {
      return 'powershell';
    }
    return 'bash';
  }

  /**
   * 检查是否为危险基础命令
   */
  private checkDangerousBaseCommand(baseCommand: string): boolean {
    return this.dangerousCommands.has(baseCommand);
  }

  /**
   * 检查是否访问敏感目录
   */
  private checkSensitiveDirectoryAccess(command: string): boolean {
    const lowerCommand = command.toLowerCase();
    return this.sensitiveDirectories.some(
      (dir) =>
        lowerCommand.includes(dir) ||
        lowerCommand.includes(dir.replace('/', '\\'))
    );
  }

  /**
   * 检查环境变量污染攻击
   */
  private checkEnvVarPollution(command: string): boolean {
    const envPatterns = [
      /\bPATH\s*=\s*[^$]/,
      /\bLD_PRELOAD\s*=/,
      /\bLD_LIBRARY_PATH\s*=/,
      /\bPYTHONPATH\s*=/,
      /\bLD_AUDIT\s*=/,
      /\bLD_DEBUG\s*=/,
    ];
    return envPatterns.some((pattern) => pattern.test(command));
  }

  /**
   * 检查空字节注入
   */
  private checkNullByteInjection(command: string): boolean {
    return command.includes('\x00');
  }

  /**
   * 检查Unicode零宽字符
   */
  private checkZeroWidthCharacters(command: string): boolean {
    const zeroWidthPattern = /[\u200B-\u200F\u2028-\u202F\u205F-\u206F\uFEFF]/;
    return zeroWidthPattern.test(command);
  }

  /**
   * 检查Zsh equals expansion绕过
   */
  private checkZshEqualsExpansion(command: string): boolean {
    return /(?:^|[\s;&|])=[a-zA-Z_]/.test(command);
  }

  /**
   * 比较风险级别
   */
  private isHigherRisk(newLevel: RiskLevel, currentLevel: RiskLevel): boolean {
    const levels: Record<RiskLevel, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };
    return levels[newLevel] > levels[currentLevel];
  }

  /**
   * 快速安全检查（用于只读命令）
   */
  isReadOnlyCommand(command: string): boolean {
    const readOnlyCommands = new Set([
      'ls',
      'cat',
      'head',
      'tail',
      'less',
      'more',
      'wc',
      'grep',
      'find',
      'which',
      'whereis',
      'type',
      'echo',
      'printf',
      'pwd',
      'whoami',
      'id',
      'date',
      'uname',
      'hostname',
      'df',
      'du',
      'git',
      'npm',
      'yarn',
      'pnpm',
      'bun',
      'node',
      'python',
      'python3',
    ]);

    const baseCommand = this.extractBaseCommand(command);
    return readOnlyCommands.has(baseCommand);
  }

  /**
   * 获取所有模式
   */
  getPatterns(): SecurityPattern[] {
    return [...this.allPatterns];
  }

  /**
   * 深度安全分析（使用 AST 和结构分析）
   * 在现有 analyze() 基础上增加更深层次的检查
   */
  analyzeDeep(command: string): SecurityAnalysisResult {
    const baseResult = this.analyze(command);

    const warnings: string[] = [];
    if (baseResult.message) {
      warnings.push(baseResult.message);
    }

    if (hasUnterminatedQuote(command)) {
      warnings.push('检测到未闭合的引号');
    }

    if (hasShellQuoteBug(command)) {
      warnings.push('检测到单引号内转义模式（可能的解析差异）');
    }

    if (hasHeredoc(command)) {
      const { heredocs } = extractHeredocs(command);
      for (const [, info] of heredocs) {
        if (!info.quoted) {
          const content = info.fullText;
          if (!isHeredocSafe(info, content)) {
            warnings.push('Heredoc 内容可能包含危险操作');
            if (baseResult.behavior === 'allow') {
              return {
                ...baseResult,
                behavior: 'ask',
                riskLevel: 'medium',
                message: warnings.join('; '),
              };
            }
          }
        }
      }
    }

    const astResult = analyzeBashCommand(command);
    if (!astResult.isSimple) {
      warnings.push('复杂命令结构');
    } else if (astResult.isDangerous) {
      warnings.push('检测到危险命令');
    }

    const parsedCmd = parseCommand(command);
    const segments = parsedCmd.getPipeSegments();
    for (const segment of segments) {
      const firstWord = segment.trim().split(/\s+/, 1)[0] || '';
      const category = classifyCommand(firstWord);
      if (category === 'dangerous') {
        warnings.push(`危险命令分类: ${firstWord}`);
      }
    }

    const safe =
      baseResult.safe &&
      !warnings.some((w) => w.includes('危险') || w.includes('未闭合'));

    return {
      ...baseResult,
      safe,
      message: warnings.length > 0 ? warnings.join('; ') : baseResult.message,
    };
  }

  /**
   * 解析命令结构
   */
  parseCommand(command: string): IParsedCommand {
    return parseCommand(command);
  }

  /**
   * AST 分析命令
   */
  analyzeAST(command: string): BashAnalysisResult {
    return analyzeBashCommand(command);
  }

  /**
   * 分类命令
   */
  classifyCommand(commandName: string): CommandCategory {
    return classifyCommand(commandName);
  }

  /**
   * 检查 heredoc
   */
  checkHeredoc(command: string): {
    hasHeredoc: boolean;
    heredocCount: number;
    allSafe: boolean;
  } {
    if (!hasHeredoc(command)) {
      return { hasHeredoc: false, heredocCount: 0, allSafe: true };
    }

    const { heredocs } = extractHeredocs(command);
    let allSafe = true;
    for (const [, info] of heredocs) {
      if (!info.quoted) {
        const content = info.fullText;
        if (!isHeredocSafe(info, content)) {
          allSafe = false;
        }
      }
    }

    return {
      hasHeredoc: true,
      heredocCount: heredocs.size,
      allSafe,
    };
  }

  /**
   * 检查引号完整性
   */
  checkQuotes(command: string): {
    hasUnterminatedQuote: boolean;
    hasShellQuoteBug: boolean;
  } {
    return {
      hasUnterminatedQuote: hasUnterminatedQuote(command),
      hasShellQuoteBug: hasShellQuoteBug(command),
    };
  }

  /**
   * 根据信任级别降级安全行为
   * development → 放行非危险命令；work → ask 降级为 allow；chat/无 → 不做处理
   *
   * ⚠️ 设计约束（§9.1）：危险命令（behavior === 'deny'）在所有信任级别下均不会被绕过
   */
  private applyTrustLevelBehavior(
    result: SecurityAnalysisResult,
    trustLevel?: string
  ): SecurityAnalysisResult {
    if (!trustLevel) return result;

    // 危险命令在所有信任级别下都不可绕过（§9.1）
    if (result.behavior === 'deny') return result;

    if (trustLevel === 'development') {
      return {
        ...result,
        safe: true,
        behavior: 'allow',
      };
    }

    if (trustLevel === 'work' && result.behavior === 'ask') {
      return {
        ...result,
        safe: true,
        behavior: 'allow',
        message: result.message
          ? `[信任工作区·work] 低风险已放行: ${result.message}`
          : undefined,
      };
    }

    return result;
  }

  /**
   * 获取原生分析器降级状态（供 /security status 查询）
   */
  getNativeStatus(): { degraded: boolean; reason: string | null } {
    return { degraded: nativeDegraded, reason: nativeDegradeReason };
  }
}
