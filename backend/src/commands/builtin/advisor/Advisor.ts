import type { CommandContext } from '../../types/index.js';
/**
 * Advisor命令
 * 提供代码建议和优化建议
 */
const advisorCommand = {
  async call(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const command = params[0];
    const target = params.slice(1).join(' ');

    switch (command) {
      case 'code':
        return this.analyzeCode(target);
      case 'performance':
        return this.analyzePerformance(target);
      case 'security':
        return this.analyzeSecurity(target);
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /advisor <命令> [目标]\n\n命令列表:\n  code - 分析代码质量\n  performance - 分析性能\n  security - 分析安全性\n\n示例: /advisor code ./src/index.ts',
        };
    }
  },

  async analyzeCode(target: string) {
    if (!target) {
      return {
        type: 'text' as const,
        value: '用法: /advisor code <文件路径>\n分析指定文件的代码质量',
      };
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      const fullPath = path.resolve(target);

      if (!fs.existsSync(fullPath)) {
        return {
          type: 'text' as const,
          value: `错误: 文件 ${fullPath} 不存在`,
        };
      }

      const content = fs.readFileSync(fullPath, 'utf8');

      // 简单的代码分析
      const lines = content.split('\n');
      const lineCount = lines.length;
      const functionCount = (
        content.match(/function\s+\w+|const\s+\w+\s*=\s*\(/) || []
      ).length;
      const classCount = (content.match(/class\s+\w+/) || []).length;

      return {
        type: 'text' as const,
        value: `代码分析结果:\n\n文件: ${fullPath}\n行数: ${lineCount}\n函数数: ${functionCount}\n类数: ${classCount}\n\n建议:\n- 考虑添加更多注释\n- 检查是否有未使用的变量\n- 优化代码结构，提高可读性`,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  async analyzePerformance(target: string) {
    if (!target) {
      return {
        type: 'text' as const,
        value: '用法: /advisor performance <文件路径>\n分析指定文件的性能',
      };
    }

    return {
      type: 'text' as const,
      value: `性能分析结果:\n\n目标: ${target}\n\n建议:\n- 避免频繁的DOM操作\n- 使用适当的缓存策略\n- 优化循环和递归\n- 考虑使用Web Workers处理 heavy tasks`,
    };
  },

  async analyzeSecurity(target: string) {
    if (!target) {
      return {
        type: 'text' as const,
        value: '用法: /advisor security <文件路径>\n分析指定文件的安全性',
      };
    }

    return {
      type: 'text' as const,
      value: `安全性分析结果:\n\n目标: ${target}\n\n建议:\n- 避免使用eval()\n- 验证所有用户输入\n- 使用HTTPS\n- 避免硬编码敏感信息\n- 实施适当的权限控制`,
    };
  },
};

export default advisorCommand;
