import type { CommandContext } from '@modules/commands/types';
import { createSecurityScanner } from '../../../security/scanners/SecurityScanner.js';
import { inputValidator } from '../../../security/validators/InputValidator.js';

/**
 * Security命令
 * 管理安全相关功能
 */
const securityCommand = {
  async execute(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const command = params[0];

    switch (command) {
      case 'scan':
        return this.runScan(params.slice(1));
      case 'validate':
        return this.validateInput(params.slice(1));
      case 'sanitize':
        return this.sanitizeInput(params.slice(1));
      default:
        return {
          success: true,
          message:
            '用法: /security <命令> [参数]\n\n命令列表:\n  scan - 运行安全扫描\n  validate - 验证输入安全性\n  sanitize - 清理输入\n\n示例: /security scan ./src',
        };
    }
  },

  async runScan(params: string[]) {
    const scanPath = params[0] || './';

    try {
      const scanner = createSecurityScanner(
        [scanPath],
        ['./node_modules', './dist', './build']
      );
      const vulnerabilities = await scanner.scan();
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

  async validateInput(params: string[]) {
    if (params.length < 2) {
      return {
        success: true,
        message:
          '用法: /security validate <类型> <输入>\n\n类型: safeString, safeFileName, noCommandInjection, noSqlInjection\n\n示例: /security validate safeString "<script>alert(1)</script>"',
      };
    }

    const [type, ...inputParts] = params;
    const input = inputParts.join(' ');

    try {
      const result = inputValidator.validate(input, [{ name: type }]);

      if (result.valid) {
        return {
          success: true,
          message: '输入验证通过',
        };
      } else {
        return {
          success: false,
          message: `输入验证失败: ${result.error}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async sanitizeInput(params: string[]) {
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
};

export default securityCommand;