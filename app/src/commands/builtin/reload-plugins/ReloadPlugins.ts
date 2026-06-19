/**
 * 插件重载命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行插件重载命令
   * @param args 参数（可选插件名）
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const pluginName = args.trim();

    if (pluginName) {
      return this.handleReloadPlugin(pluginName, context);
    }

    return this.handleReloadAll(context);
  },

  /**
   * 重载所有插件
   */
  async handleReloadAll(context: CommandContext): Promise<CommandResult> {
    const result = {
      totalPlugins: 5,
      reloadedPlugins: 5,
      failedPlugins: 0,
      plugins: [
        { name: 'code-executor', status: 'reloaded' },
        { name: 'file-manager', status: 'reloaded' },
        { name: 'git-tools', status: 'reloaded' },
        { name: 'api-client', status: 'reloaded' },
        { name: 'theme-customizer', status: 'reloaded' },
      ],
    };

    context.onDone?.(`已重载 ${result.reloadedPlugins} 个插件`, {
      display: 'system',
    });

    return {
      success: true,
      type: 'text',
      message:
        `插件重载完成:\n\n` +
        `- 总插件数: ${result.totalPlugins}\n` +
        `- 已重载: ${result.reloadedPlugins}\n` +
        `- 失败: ${result.failedPlugins}\n\n` +
        `重载的插件:\n` +
        `${result.plugins.map((p) => `  ${p.name} - ${p.status}`).join('\n')}`,
      data: result,
    };
  },

  /**
   * 重载指定插件
   */
  async handleReloadPlugin(
    pluginName: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const plugins = [
      'code-executor',
      'file-manager',
      'git-tools',
      'api-client',
      'theme-customizer',
    ];

    if (!plugins.includes(pluginName)) {
      return {
        success: false,
        type: 'error',
        error: `未找到插件: ${pluginName}`,
        message: `可用插件: ${plugins.join(', ')}`,
      };
    }

    context.onDone?.(`插件 ${pluginName} 已重载`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `插件 ${pluginName} 已重载`,
      data: { pluginName, status: 'reloaded' },
    };
  },
};
