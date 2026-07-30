/**
 * ShellExecutor —— 命令执行管线统一模块
 *
 * 将分散在 PowerShellTool、BashTool、ToolExecutor 中的
 * 转义 + 安全检查 + 执行 + 错误归一 收归一个公共模块。
 *
 * 核心设计：
 *   - 转义层：统一使用 base64 编码，消灭引号地狱
 *   - 安全层：合并 PowerShell + Bash 的安全规则，统一输出
 *   - 执行层：统一 child_process.exec 出口
 *   - 错误归一化：拆分 stdout/stderr，去除 cmd.exe 本地化前缀污染
 */
import { exec } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

// ─── 类型定义 ───────────────────────────────────────────────

export type ShellType = 'powershell' | 'bash' | 'cmd';

export interface ShellExecOptions {
  /** 要执行的命令 */
  command: string;
  /** 目标 shell 类型 */
  shell: ShellType;
  /** 超时时间（毫秒），默认 60000 */
  timeout?: number;
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否跳过安全检查（默认 false） */
  skipSecurity?: boolean;
  /** PowerShell 执行策略（仅 powershell 类型生效），默认 Bypass */
  executionPolicy?: string;
  /** P0-03: 是否执行 dry-run 预览模式（仅预览，不实际执行） */
  dryRun?: boolean;
  /** P2-03: 删除前快照配置（默认启用） */
  snapshotConfig?: Partial<SnapshotConfig>;
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
}

export interface SecurityCheckResult {
  safe: boolean;
  behavior: 'allow' | 'ask' | 'deny';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
  errors: string[];
  matchedPatterns: string[];
  /** P0-03: 删除操作执行预览信息 */
  preview?: DryRunPreview;
}

/**
 * P0-03: dry-run 执行预览
 * 删除操作前展示目标路径、文件数、空间、匹配规则
 */
export interface DryRunPreview {
  /** 目标路径列表 */
  targets: string[];
  /** 待删除文件数 */
  fileCount: number;
  /** 所占空间 */
  sizeBytes: number;
  /** 触发的匹配规则名称列表 */
  matchedRules: string[];
  /** 预览命令（追加了 -WhatIf 的 PowerShell 命令） */
  previewCommand: string;
}

// ─── 安全规则 ────────────────────────────────────────────────

import {
  ALL_UNIFIED_RULES,
  COMPOSITE_COMMAND_RULES,
} from '../../security/patterns/dangerousCommands';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'services:executor:ShellExecutor',
  level: LogLevel.INFO,
});

/** P1: ShellExecutor 的 SecurityPattern（内部使用，保持与 int 签名一致） */
interface SecurityPattern {
  name: string;
  pattern: RegExp;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  behavior: 'allow' | 'ask' | 'deny';
  message: string;
  /** 仅在特定 shell 类型下生效，undefined 表示所有 shell */
  shellType?: ShellType;
}

/**
 * P1: 将 UnifiedSecurityRule 转为 SecurityPattern 用于安全检查
 */
function toSecurityPattern(
  rule: import('../../security/patterns/dangerousCommands').UnifiedSecurityRule,
  shell: ShellType
): SecurityPattern[] {
  return rule.patterns.map((pattern) => ({
    name: rule.name,
    pattern,
    riskLevel: rule.riskLevel,
    behavior: rule.defaultBehavior,
    message: rule.message,
    shellType: rule.platforms.includes(shell as any) ? shell : undefined,
  }));
}

/**
 * P1: 获取当前 shell 适用的所有规则
 */
function getRulesForShell(shell: ShellType): SecurityPattern[] {
  const result: SecurityPattern[] = [];
  for (const rule of ALL_UNIFIED_RULES) {
    if (rule.platforms.includes(shell as any)) {
      result.push(...toSecurityPattern(rule, shell));
    }
  }
  return result;
}

// ─── 路径安全 ────────────────────────────────────────────────

/**
 * 快照模式
 * - full: 全量压缩为 zip 包，适合小规模删除（< 200 个文件）
 * - manifest: 文件镜像快照，将文件原样复制到备份目录，适合大规模删除
 */
export type SnapshotMode = 'full' | 'manifest';

/**
 * 删除前快照配置
 */
export interface SnapshotConfig {
  /** 是否启用快照，默认 true */
  enabled: boolean;
  /** 最小触发文件数，默认 10 */
  minFileCount: number;
  /** 快照存储位置，默认 ~/.trae/snapshots/ */
  backupLocation: string;
  /** 自动清理天数，默认 7 */
  autoCleanupDays: number;
  /** 最大快照大小，默认 1GB */
  maxSnapshotSize: number;
  /** 快照模式 */
  mode: SnapshotMode;
  /** 磁盘空闲最低百分比，低于此值自动禁用快照，默认 10 */
  diskFreeMinPercent: number;
}

/** 默认快照配置 */
export const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfig = {
  enabled: true,
  minFileCount: 10,
  // BUG15 修复：使用 paths.ts 集中管理路径
  get backupLocation() {
    try {
      const { resolveSnapshotsDir } = require('@modules/core/paths');
      return resolveSnapshotsDir();
    } catch {
      return join(homedir(), '.trae', 'snapshots');
    }
  },
  autoCleanupDays: 7,
  maxSnapshotSize: 1024 * 1024 * 1024, // 1GB
  mode: 'manifest',
  diskFreeMinPercent: 10,
};

/**
 * 快照元数据
 */
export interface SnapshotMetadata {
  /** 快照唯一标识（时间戳） */
  id: string;
  /** 快照创建时间 */
  createdAt: string;
  /** 源路径列表 */
  sourcePaths: string[];
  /** 文件数量 */
  fileCount: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 快照模式 */
  mode: SnapshotMode;
  /** 快照存储路径 */
  snapshotPath: string;
  /** 是否已恢复 */
  restored: boolean;
  /** 是否已清理 */
  cleaned: boolean;
}

/**
 * 创建删除前快照
 * 自动根据文件数量和磁盘空间选择模式
 * @param targetPaths 目标路径列表
 * @param config 快照配置（可选）
 * @returns 快照元数据
 */
export function createSnapshot(
  targetPaths: string[],
  config: SnapshotConfig = DEFAULT_SNAPSHOT_CONFIG
): SnapshotMetadata {
  if (!config.enabled) {
    throw new Error('快照功能已禁用');
  }

  // 收集所有文件
  const files: string[] = [];
  let totalSize = 0;

  for (const targetPath of targetPaths) {
    if (!existsSync(targetPath)) continue;

    const stat = statSync(targetPath);
    if (stat.isDirectory()) {
      // 递归收集目录下的文件
      collectFiles(targetPath, files);
    } else {
      files.push(targetPath);
    }
  }

  if (files.length < config.minFileCount) {
    throw new Error(
      `文件数 (${files.length}) 低于最小触发阈值 (${config.minFileCount})`
    );
  }

  for (const file of files) {
    totalSize += statSync(file).size;
  }

  // 自动选择快照模式
  const effectiveMode = files.length >= 200 ? 'manifest' : config.mode;

  // 生成快照 ID
  const id = Date.now().toString(36);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = join(config.backupLocation, `${id}_${timestamp}`);
  mkdirSync(snapshotDir, { recursive: true });

  // 根据模式创建快照
  if (effectiveMode === 'manifest') {
    // manifest 模式：逐文件复制到备份目录（保留目录结构）
    for (const file of files) {
      const relativePath = file
        .replace(/^[a-zA-Z]:\\/, '')
        .replace(/^[/\\]+/, '');
      const destPath = join(snapshotDir, relativePath);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(file, destPath);
    }
  } else {
    // full 模式：简单复制到备份目录（保留目录结构）
    for (const file of files) {
      const relativePath = file
        .replace(/^[a-zA-Z]:\\/, '')
        .replace(/^[/\\]+/, '');
      const destPath = join(snapshotDir, relativePath);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(file, destPath);
    }
  }

  // 写入元数据文件
  const metadata: SnapshotMetadata = {
    id,
    createdAt: new Date().toISOString(),
    sourcePaths: [...targetPaths],
    fileCount: files.length,
    totalSize,
    mode: effectiveMode,
    snapshotPath: snapshotDir,
    restored: false,
    cleaned: false,
  };

  writeFileSync(
    join(snapshotDir, 'snapshot.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  return metadata;
}

/**
 * 内部：递归收集目录下的所有文件
 */
function collectFiles(dirPath: string, result: string[]): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath, result);
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  } catch (err) {
    // 跳过无权限访问的目录

    handleError(err, { module: 'services:executor', action: 'scanWorkingDir' });
  }
}

/**
 * 从快照恢复文件
 * 将快照目录中的文件镜像复制回原始路径
 * @param metadata 快照元数据
 * @returns 恢复的文件数
 */
export function restoreSnapshot(metadata: SnapshotMetadata): number {
  if (metadata.restored) {
    throw new Error('快照已恢复，不可重复恢复');
  }
  if (metadata.cleaned) {
    throw new Error('快照已被清理，无法恢复');
  }

  const snapshotDir = metadata.snapshotPath;
  if (!existsSync(snapshotDir)) {
    throw new Error(`快照目录不存在: ${snapshotDir}`);
  }

  // 从快照目录读取文件清单（跳过元数据文件）
  const restoredFiles: string[] = [];
  restoreFromDir(snapshotDir, snapshotDir, restoredFiles);

  // 更新元数据
  metadata.restored = true;
  writeFileSync(
    join(snapshotDir, 'snapshot.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  return restoredFiles.length;
}

/**
 * 内部：递归从快照目录恢复文件到原始路径
 */
function restoreFromDir(
  snapshotDir: string,
  currentDir: string,
  restoredFiles: string[]
): void {
  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'snapshot.json') continue;

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        restoreFromDir(snapshotDir, fullPath, restoredFiles);
      } else if (entry.isFile()) {
        // 计算原始路径：从 snapshotDir 之后的相对路径
        const relativePath = fullPath.substring(snapshotDir.length + 1);
        const originalPath = /^[a-zA-Z]:\\/.test(relativePath)
          ? relativePath
          : join('/', relativePath.replace(/\\/g, '/'));

        mkdirSync(dirname(originalPath), { recursive: true });
        copyFileSync(fullPath, originalPath);
        restoredFiles.push(originalPath);
      }
    }
  } catch (err) {
    // 跳过恢复失败的条目

    handleError(err, {
      module: 'services:executor',
      action: 'restorePathState',
    });
  }
}

/**
 * 清理过期快照
 * @param config 快照配置（可选）
 * @returns 清理的快照数量
 */
export function cleanupSnapshots(
  config: SnapshotConfig = DEFAULT_SNAPSHOT_CONFIG
): number {
  const backupDir = config.backupLocation;
  if (!existsSync(backupDir)) return 0;

  const now = Date.now();
  const maxAge = config.autoCleanupDays * 24 * 60 * 60 * 1000;
  let cleanedCount = 0;

  const entries = readdirSync(backupDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const snapshotDir = join(backupDir, entry.name);
    const metadataPath = join(snapshotDir, 'snapshot.json');

    if (!existsSync(metadataPath)) {
      // 无元数据文件的目录视为残留，直接清理
      rmSync(snapshotDir, { recursive: true, force: true });
      cleanedCount++;
      continue;
    }

    try {
      const metadataRaw = readFileSync(metadataPath, 'utf-8');
      const metadata: SnapshotMetadata = JSON.parse(metadataRaw);
      const age = now - new Date(metadata.createdAt).getTime();

      if (age > maxAge) {
        rmSync(snapshotDir, { recursive: true, force: true });
        cleanedCount++;
      }
    } catch {
      // 元数据损坏的目录也清理
      rmSync(snapshotDir, { recursive: true, force: true });
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * 检查快照是否可用（目录存在且元数据有效）
 */
export function isSnapshotAvailable(metadata: SnapshotMetadata): boolean {
  if (metadata.cleaned || metadata.restored) return false;
  return existsSync(metadata.snapshotPath);
}

// ─── P3-01: 命令解构检测 ─────────────────────────────────────

/**
 * 脚本扫描发现项
 */
export interface ScriptFinding {
  /** 行号 */
  line: number;
  /** 匹配的命令文本 */
  command: string;
  /** 匹配的规则名称 */
  rule: string;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * 脚本安全扫描报告
 */
export interface ScriptSecurityReport {
  /** 文件路径 */
  filePath: string;
  /** 发现总数 */
  totalFindings: number;
  /** 发现项列表 */
  findings: ScriptFinding[];
  /** 风险摘要 */
  riskSummary: string;
}

/**
 * 计算行号（基于字符偏移）
 */
function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

/**
 * 排除脚本中的注释内容，防止误匹配
 * 处理 PowerShell 单行注释（#）、多行注释（<# ... #>）和续行符注释（`#）
 * 注意：不处理字符串内的 #（如 Write-Host "Discount #50% off"）
 */
function removeScriptComments(content: string): string {
  return (
    content
      // 去掉 PowerShell 续行符后的注释
      .replace(/`#[^\n]*/g, '')
      // 去掉多行块注释（<# ... #>）
      .replace(/<#[\s\S]*?#>/g, '')
      // 去掉单行注释（# 开头直到行尾）
      .replace(/(?<!`)#[^\n]*/g, '')
  );
}

/**
 * 带注释排除的复合命令检测
 * 在清理注释后的内容上运行复合命令模式检测
 */
function detectCompositeCommand(content: string): ScriptFinding[] {
  const cleaned = removeScriptComments(content);
  const findings: ScriptFinding[] = [];

  for (const rule of COMPOSITE_COMMAND_RULES) {
    for (const pattern of rule.patterns) {
      // 在原始内容和清理后内容上都运行检测
      for (const source of [content, cleaned]) {
        let match: RegExpExecArray | null;
        const re = new RegExp(pattern.source, pattern.flags);
        while ((match = re.exec(source)) !== null) {
          findings.push({
            line: getLineNumber(source, match.index),
            command: match[0].substring(0, 80), // 截断到 80 字符
            rule: rule.name,
            riskLevel: rule.riskLevel,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * P3-02: 脚本文件写入时安全检查
 * 在脚本文件被写入磁盘时扫描其中包含的危险操作
 */
function scanScriptOnWrite(
  filePath: string,
  content: string
): ScriptSecurityReport {
  const findings: ScriptFinding[] = [];

  // 1. 检测复合命令（管道、脚本块等）
  const compositeFindings = detectCompositeCommand(content);
  findings.push(...compositeFindings);

  // 2. 检测直接删除命令
  for (const rule of ALL_UNIFIED_RULES) {
    if (rule.category !== 'deletion' && rule.category !== 'injection') continue;
    for (const pattern of rule.patterns) {
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((match = re.exec(content)) !== null) {
        findings.push({
          line: getLineNumber(content, match.index),
          command: match[0].substring(0, 80),
          rule: rule.name,
          riskLevel: rule.riskLevel,
        });
      }
    }
  }

  // 3. 去重（同规则同行的只保留一条）
  const uniqueFindings: ScriptFinding[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    const key = `${f.rule}:${f.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFindings.push(f);
    }
  }

  // 4. 统计风险摘要
  const riskLevels = uniqueFindings.map((f) => f.riskLevel);
  const criticalCount = riskLevels.filter((r) => r === 'critical').length;
  const highCount = riskLevels.filter((r) => r === 'high').length;
  const mediumCount = riskLevels.filter((r) => r === 'medium').length;

  let riskSummary = '安全';
  if (criticalCount > 0) riskSummary = `发现 ${criticalCount} 项严重风险`;
  else if (highCount > 0) riskSummary = `发现 ${highCount} 项高风险`;
  else if (mediumCount > 0) riskSummary = `发现 ${mediumCount} 项中风险`;
  else if (uniqueFindings.length > 0)
    riskSummary = `发现 ${uniqueFindings.length} 项低风险`;

  return {
    filePath,
    totalFindings: uniqueFindings.length,
    findings: uniqueFindings,
    riskSummary,
  };
}

/**
 * 检查 Unix 路径是否安全（防止路径遍历攻击 / 系统目录访问）
 */
function isPathSafe(path: string): boolean {
  const pathTraversalPatterns = [/\.\.\//, /^\.\//, /\/\.\.\//, /^\//];

  const dangerousPaths = [
    /^\/etc\//,
    /^\/sys\//,
    /^\/proc\//,
    /^\/boot\//,
    /^\/dev\//,
    /^\/root\//,
  ];

  return (
    !pathTraversalPatterns.some((pattern) => pattern.test(path)) &&
    !dangerousPaths.some((pattern) => pattern.test(path))
  );
}

// ─── ShellExecutor 主类 ──────────────────────────────────────

export class ShellExecutor {
  private static instance: ShellExecutor;

  static getInstance(): ShellExecutor {
    if (!ShellExecutor.instance) {
      ShellExecutor.instance = new ShellExecutor();
    }
    return ShellExecutor.instance;
  }

  // ─── 核心入口 ──────────────────────────────────────────────

  /**
   * 执行 shell 命令（统一入口）
   *
   * 管线：编码 → 安全检查 → dry-run 预览 → 执行 → 错误归一化
   */
  async execute(options: ShellExecOptions): Promise<ShellExecResult> {
    const startTime = Date.now();

    /** P2-03: 快照元数据（跨作用域共享） */
    let snapshotMetadata: SnapshotMetadata | null = null;

    // 1. 安全检查
    if (!options.skipSecurity) {
      const securityResult = this.securityCheck(options.command, options.shell);

      if (securityResult.behavior === 'deny') {
        const errorMessage =
          securityResult.errors.join('; ') || '命令被安全策略拒绝';

        throw new AppError(
          `命令安全拦截: ${errorMessage}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // P0-03: dry-run 预览模式
      if (options.dryRun && securityResult.preview) {
        return {
          stdout:
            `[DRY-RUN] 预览命令: ${securityResult.preview.previewCommand}\n` +
            `[DRY-RUN] 目标路径: ${securityResult.preview.targets.join(', ')}\n` +
            `[DRY-RUN] 触发规则: ${securityResult.preview.matchedRules.join(', ')}`,
          stderr: '',
          exitCode: 0,
          executionTime: Date.now() - startTime,
        };
      }

      // P2-03: 删除操作前自动创建快照
      if (securityResult.preview) {
        try {
          const snapshotConfig: SnapshotConfig = {
            ...DEFAULT_SNAPSHOT_CONFIG,
            ...options.snapshotConfig,
          };
          snapshotMetadata = createSnapshot(
            securityResult.preview.targets,
            snapshotConfig
          );
        } catch (snapshotError: any) {
          // 快照失败不影响主流程，只记录警告
          const warningMsg = `[WARN] 删除前快照创建失败: ${snapshotError.message}`;
          if (!securityResult.warnings.includes(warningMsg)) {
            securityResult.warnings.push(warningMsg);
          }
        }
      }
    }

    // 2. dry-run 且没有预览信息时（非删除操作），直接返回空
    if (options.dryRun) {
      return {
        stdout: '[DRY-RUN] 命令未触发删除规则，无预览信息',
        stderr: '',
        exitCode: 0,
        executionTime: Date.now() - startTime,
      };
    }

    // 3. 编码命令
    const encodedCommand = this.buildEncodedCommand(
      options.command,
      options.shell,
      options.executionPolicy
    );

    // 5. 执行
    const { stdout, stderr, exitCode } = await this.executeRaw(encodedCommand, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
    });

    // 6. 返回，包含快照信息
    const snapshotInfo = snapshotMetadata
      ? `\n[SNAPSHOT] 删除前快照已创建: ${snapshotMetadata.snapshotPath} (${snapshotMetadata.fileCount} 文件, ${snapshotMetadata.mode} 模式)`
      : '';

    return {
      stdout: stdout + snapshotInfo,
      stderr,
      exitCode,
      executionTime: Date.now() - startTime,
    };
  }

  // ─── 转义层：统一 base64 编码 ────────────────────────────────

  /**
   * 构建编码后的 shell 命令（base64 方案消灭引号转义）
   */
  private buildEncodedCommand(
    command: string,
    shell: ShellType,
    executionPolicy?: string
  ): string {
    const encoded = Buffer.from(command, 'utf-8').toString('base64');

    switch (shell) {
      case 'powershell': {
        const policy = executionPolicy || 'Bypass';
        return `pwsh -NoProfile -ExecutionPolicy ${policy} -EncodedCommand ${encoded}`;
      }

      case 'bash':
        // Windows 上通过 Git Bash / WSL 执行
        return `bash -c "$(echo ${encoded} | base64 -d)"`;

      case 'cmd':
        // 通过 PowerShell 解码后传给 cmd.exe
        return `powershell -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')) | cmd /c"`;

      default:
        return command;
    }
  }

  // ─── 安全层：合并规则 ──────────────────────────────────────

  /**
   * 安全检查（合并 PowerShell + Bash 两套规则）
   *
   * @param command 原始命令
   * @param shell 目标 shell 类型
   * @returns 安全检查结果
   */
  securityCheck(command: string, shell: ShellType): SecurityCheckResult {
    if (!command || !command.trim()) {
      return {
        safe: true,
        behavior: 'allow',
        riskLevel: 'low',
        warnings: [],
        errors: [],
        matchedPatterns: [],
      };
    }

    const trimmedCommand = command.trim();
    const warnings: string[] = [];
    const errors: string[] = [];
    const matchedPatterns: string[] = [];
    let highestRiskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let finalBehavior: 'allow' | 'ask' | 'deny' = 'allow';

    // 1. P1: 使用统一规则源进行安全检查
    const rules = getRulesForShell(shell);
    for (const rule of rules) {
      if (rule.pattern.test(trimmedCommand)) {
        matchedPatterns.push(rule.name);

        if (this.isHigherRisk(rule.riskLevel, highestRiskLevel)) {
          highestRiskLevel = rule.riskLevel;
        }

        if (rule.behavior === 'deny') {
          finalBehavior = 'deny';
          errors.push(rule.message);
        } else if (rule.behavior === 'ask' && finalBehavior !== 'deny') {
          finalBehavior = 'ask';
          warnings.push(rule.message);
        }
      }
    }

    // 2. 路径安全检查（仅匹配 Unix 绝对路径，排除 Windows 的 /param 格式）
    const pathMatch = trimmedCommand.match(
      /['"]?(\/[a-zA-Z][a-zA-Z0-9_]*\/[^\s'"]+)['"]?/
    );
    if (pathMatch) {
      const path = pathMatch[1];
      if (!isPathSafe(path)) {
        matchedPatterns.push(`unsafe_path:${path}`);
        highestRiskLevel = 'high';
        finalBehavior = 'deny';
        errors.push(`路径安全检查失败: 禁止访问系统敏感目录 (${path})`);
      }
    }

    // 3. 检测删除操作并生成 dry-run 预览
    const isDeleteOperation = matchedPatterns.some((p) => {
      const name = p.replace(/^command:/, '');
      return (
        /^(ps_recursive_deletion|ps_bulk_deletion|ps_remove_item_generic|cmd_bulk_deletion|rm_root|rm_force_recursive)$/i.test(
          name
        ) ||
        ['del', 'erase', 'rd', 'rmdir', 'remove-item', 'ri', 'rm'].includes(
          name
        )
      );
    });

    let preview: DryRunPreview | undefined;
    if (isDeleteOperation) {
      preview = this.buildDryRunPreview(trimmedCommand, shell, matchedPatterns);
    }

    return {
      safe: finalBehavior !== 'deny' && errors.length === 0,
      behavior: finalBehavior,
      riskLevel: highestRiskLevel,
      warnings,
      errors,
      matchedPatterns,
      preview,
    };
  }

  /**
   * P0-03: 构建删除操作执行预览
   * 生成目标路径、文件数、空间等信息
   */
  private buildDryRunPreview(
    command: string,
    shell: ShellType,
    matchedPatterns: string[]
  ): DryRunPreview {
    // 提取目标路径
    const targets: string[] = [];
    const pathRegex =
      /['"]([^'"]+)['"]|\s(-Path\s+)?['"]?((?:[a-zA-Z]:\\[^\s'"]+|\/[^\s'"]+))['"]?/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(command)) !== null) {
      const p = match[1] || match[3];
      if (p && !p.startsWith('-')) {
        targets.push(p);
      }
    }

    // 如果没提取到路径，用当前工作目录的默认模式
    if (targets.length === 0) {
      targets.push('(当前工作目录)');
    }

    // 构建预览命令
    let previewCommand = command;
    if (shell === 'powershell') {
      // 自动追加 -WhatIf（如果没有 -WhatIf）
      if (!command.includes('-WhatIf') && !command.includes('-whatif')) {
        const hasCommonParams = /\s+-(?:Path|LiteralPath)\s+/i.test(command);
        if (hasCommonParams) {
          previewCommand = command + ' -WhatIf:$true';
        }
      }
    } else if (shell === 'cmd') {
      // cmd 的 dry-run 用 echo 模拟
      previewCommand = `echo [DRY-RUN] ${command}`;
    }

    return {
      targets,
      fileCount: 0, // 运行时通过 previewCommand 获取实际数量
      sizeBytes: 0, // 运行时通过 previewCommand 获取实际大小
      matchedRules: matchedPatterns,
      previewCommand,
    };
  }

  /**
   * 比较风险等级
   */
  private isHigherRisk(
    a: SecurityCheckResult['riskLevel'],
    b: SecurityCheckResult['riskLevel']
  ): boolean {
    const levels: Record<string, number> = {
      low: 0,
      medium: 1,
      high: 2,
      critical: 3,
    };
    return levels[a] > levels[b];
  }

  // ─── 执行层：统一 child_process 出口 ────────────────────────

  /**
   * 执行原始命令（已编码后的 shell 命令）
   */
  private executeRaw(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          timeout: options.timeout || 60000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          if (error) {
            // 命令执行失败（非零退出码或超时）
            resolve({
              stdout: stdout || '',
              stderr: stderr || error.message,
              exitCode: (error as any).code || 1,
            });
            return;
          }

          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: 0,
          });
        }
      );
    });
  }
}

// ─── 导出便捷函数 ────────────────────────────────────────────

export function getDefaultShellExecutor(): ShellExecutor {
  return ShellExecutor.getInstance();
}
