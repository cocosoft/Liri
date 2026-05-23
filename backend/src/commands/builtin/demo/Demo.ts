/**
 * Demo 命令实现
 * 离线模式下展示模拟对话预览，让新用户体验 PY_APP 的对话能力
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

const DEMO_CONVERSATION = `
╔══════════════════════════════════════════════════════╗
║                  PY_APP 对话演示                      ║
║   以下是一个模拟对话示例，展示 PY_APP 的能力           ║
╚══════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💬 输入: "用 Python 写一个斐波那契数列函数"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🤖 PY_APP:
  以下是 Python 实现的斐波那契数列函数：

  def fibonacci(n: int) -> int:
      if n <= 0:
          return 0
      elif n == 1:
          return 1
      else:
          a, b = 0, 1
          for _ in range(2, n + 1):
              a, b = b, a + b
          return b

  # 使用示例
  for i in range(10):
      print(f"fibonacci({i}) = {fibonacci(i)}")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💬 输入: "总结一下今天的待办事项"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🤖 PY_APP:
  好的，我来看一下你的当前任务列表：

  1. 📌 完成项目报告          — 截止: 今天 18:00
  2. 📌 回复客户邮件          — 截止: 明天 10:00
  3. 📌 代码审查 (PR #42)     — 待处理

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  💬 输入: "/help"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🖥️ PY_APP:
  可用命令:
    /chat      开始对话
    /config    管理配置
    /help      查看帮助
    /onboard   配置向导
    /docs      浏览文档
    ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

const demoCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const cleanArgs = args.trim().toLowerCase();

    if (cleanArgs === 'help' || cleanArgs === '--help' || cleanArgs === '-h') {
      return this.showHelp();
    }

    return {
      success: true,
      type: 'text',
      message:
        DEMO_CONVERSATION +
        '\n💡 配置 API 密钥后即可体验真实对话。运行 /onboard 开始配置。',
    };
  },

  showHelp(): CommandResult {
    const help = [
      'Demo 对话演示命令',
      '',
      '用法:',
      '  /demo  — 展示模拟对话预览',
      '',
      '说明:',
      '  在离线模式下展示 PY_APP 的对话能力示例。',
      '  配置 API 密钥后可体验真实 AI 对话。',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },
};

export default demoCommand;
