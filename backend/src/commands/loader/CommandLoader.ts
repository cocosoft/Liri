/**
 * 命令加载器
 * 从不同源加载命令
 */
import type { Command, CommandLoader, LoadResult, CommandLoadStatus } from '../types/index.js';
import { feature } from '@modules/core';

/**
 * 内置命令加载器
 */
export class BuiltinCommandLoader implements CommandLoader {
  private loadedCommands: Map<string, Command> = new Map();
  private loadErrors: Map<string, string> = new Map();

  /**
   * 加载命令
   * @returns 命令列表
   */
  async loadCommands(): Promise<Command[]> {
    const result = await this.loadBuiltInCommands();
    return result.commands;
  }

  /**
   * 加载所有内置命令（带详细状态）
   * @returns 加载结果
   */
  async loadBuiltInCommands(): Promise<LoadResult> {
    const commands: Command[] = [];
    const errors: { name: string; error: string }[] = [];

    const builtinModules = [
      '../builtin/help/index.js',
      '../builtin/status/index.js',
      '../builtin/clear/index.js',
      '../builtin/skill/index.js',
      '../builtin/config/index.js',
      '../builtin/history/index.js',
      '../builtin/tool/index.js',
      '../builtin/compact/index.js',
      '../builtin/session/index.js',
      '../builtin/exit/index.js',
      '../builtin/advisor/index.js',
      '../builtin/brief/index.js',
      '../builtin/cache/index.js',
      '../builtin/chat/index.js',
      '../builtin/commit/index.js',
      '../builtin/complete/index.js',
      '../builtin/parallel/index.js',
      '../builtin/permission/index.js',
      '../builtin/security/index.js',
      '../builtin/vim/index.js',
      '../builtin/voice/index.js',
      '../builtin/export/index.js',
      '../builtin/share/index.js',
      '../builtin/version/index.js',
      '../builtin/stats/index.js',
      '../builtin/cost/index.js',
      '../builtin/usage/index.js',
      '../builtin/doctor/index.js',
      '../builtin/fast/index.js',
      '../builtin/memory/index.js',
      '../builtin/skills/index.js',
      '../builtin/hooks/index.js',
      '../builtin/mcp/index.js',
      '../builtin/plugins/index.js',
      '../builtin/models/index.js',
      '../builtin/permissions/index.js',
      '../builtin/tokens/index.js',
      '../builtin/settings/index.js',
      '../builtin/env/index.js',
      '../builtin/debug/index.js',
      '../agents/index.js',
      '../branch/index.js',
      '../bridge/index.js',
      '../chrome/index.js',
      '../config/index.js',
      '../login/index.js',
      '../logout/index.js',
      '../memory/index.js',
      '../hooks/index.js',
      '../ide/index.js',
      '../mcp/index.js',
      '../tasks/index.js',
      '../model/index.js',
      '../tools/file/write.js',
      '../tools/file/edit.js',
      '../tools/file/glob.js',
      '../tools/system/bash.js',
      '../tools/system/grep.js',
      '../tools/ai/agent.js',
      '../tools/ai/agents.js',
      '../tools/network/mcp.js',
      '../tools/network/fetch.js',
      '../tools/network/websearch.js',
      '../tools/task/todo.js',
      '../tools/task/task.js',
      '../tools/dev/lsp.js',
      '../tools/dev/repl.js',
      '../tools/dev/notebook.js',
    ];

    for (const modulePath of builtinModules) {
      try {
        const module = await import(modulePath);
        if (module.default) {
          const command = module.default;
          commands.push(command);
          this.loadedCommands.set(command.name, command);

          // 注册别名
          if (command.aliases && Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
              this.loadedCommands.set(alias, command);
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const commandName = modulePath.split('/').pop()?.replace('.js', '') || modulePath;
        errors.push({ name: commandName, error: errorMsg });
        this.loadErrors.set(commandName, errorMsg);
        console.warn(`Failed to load builtin command from ${modulePath}: ${errorMsg}`);
      }
    }

    return { commands, errors };
  }

  /**
   * 通过名称或别名获取已加载的命令
   */
  getLoadedCommand(nameOrAlias: string): Command | undefined {
    return this.loadedCommands.get(nameOrAlias);
  }

  /**
   * 获取加载状态
   */
  getLoadStatus(): CommandLoadStatus {
    return {
      loaded: Array.from(this.loadedCommands.keys()),
      failed: Array.from(this.loadErrors.entries()).map(([name, error]) => ({ name, error })),
    };
  }

  /**
   * 检查命令是否已加载
   */
  isCommandLoaded(name: string): boolean {
    return this.loadedCommands.has(name);
  }

  /**
   * 获取已加载的命令
   */
  getLoadedCommands(): Command[] {
    return Array.from(this.loadedCommands.values());
  }

  /**
   * 获取来源
   */
  getSource(): string {
    return 'builtin';
  }
}

/**
 * 技能命令加载器
 */
export class SkillCommandLoader implements CommandLoader {
  /**
   * 加载命令
   * @returns 命令列表
   */
  async loadCommands(): Promise<Command[]> {
    if (!feature('ENABLE_SKILLS')) {
      return [];
    }

    const commands: Command[] = [];

    try {
      const { skillManager } =
        await import('../../skills/managers/SkillManager.js');
      const skills = skillManager.getSkills({ userInvocable: true });

      // 将技能转换为命令
      for (const skill of skills) {
        const command: Command = {
          type: 'prompt',
          name: skill.name,
          description: skill.description,
          hasUserSpecifiedDescription: skill.hasUserSpecifiedDescription,
          aliases: [],
          argumentHint: skill.argumentHint,
          whenToUse: skill.whenToUse,
          version: skill.version,
          disableModelInvocation: skill.disableModelInvocation,
          userInvocable: skill.userInvocable,
          loadedFrom: 'skill',
          isHidden: skill.isHidden,
          load: async () => ({
            getPromptForCommand: skill.getPromptForCommand.bind(skill),
          }),
        };
        commands.push(command);
      }
    } catch (error) {
      console.error('Failed to load skill commands:', error);
    }

    return commands;
  }

  /**
   * 获取来源
   * @returns 来源名称
   */
  getSource(): string {
    return 'skill';
  }
}

/**
 * 插件命令加载器
 */
export class PluginCommandLoader implements CommandLoader {
  /**
   * 加载命令
   * @returns 命令列表
   */
  async loadCommands(): Promise<Command[]> {
    if (!feature('ENABLE_PLUGINS')) {
      return [];
    }

    const commands: Command[] = [];

    try {
      const { pluginManager } = await import('../../plugins/PluginManager.js');
      try {
        // 插件管理器没有getCommands方法，暂时不加载插件命令
        console.log('Plugin commands loading not implemented');
      } catch (error) {
        // 插件管理器未初始化，忽略错误
        console.debug(
          'Plugin manager not initialized, skipping plugin commands'
        );
      }
    } catch (error) {
      console.error('Failed to load plugin commands:', error);
    }

    return commands;
  }

  /**
   * 获取来源
   * @returns 来源名称
   */
  getSource(): string {
    return 'plugin';
  }
}

/**
 * MCP命令加载器
 */
export class MCPCommandLoader implements CommandLoader {
  /**
   * 加载命令
   * @returns 命令列表
   */
  async loadCommands(): Promise<Command[]> {
    if (!feature('ENABLE_MCP')) {
      return [];
    }

    const commands: Command[] = [];

    try {
      const { mcpManager } = await import('../../mcp/managers/MCPManager.js');
      const mcpCommands = await mcpManager.getCommands();
      commands.push(...mcpCommands);
    } catch (error) {
      console.error('Failed to load MCP commands:', error);
    }

    return commands;
  }

  /**
   * 获取来源
   * @returns 来源名称
   */
  getSource(): string {
    return 'mcp';
  }
}

/**
 * 命令加载器注册表
 */
export class CommandLoaderRegistry {
  private loaders: CommandLoader[] = [];
  private loadErrors: Map<string, string> = new Map();

  registerLoader(loader: CommandLoader): void {
    this.loaders.push(loader);
  }

  async loadAllCommands(): Promise<Command[]> {
    const result = await this.loadAllCommandsWithResult();
    return result.commands;
  }

  async loadAllCommandsWithResult(): Promise<LoadResult> {
    const allCommands: Command[] = [];
    const allErrors: { name: string; error: string }[] = [];

    const loaderPromises = this.loaders.map(async (loader) => {
      try {
        const commands = await loader.loadCommands();
        return { loader: loader.getSource(), commands, error: null };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.loadErrors.set(loader.getSource(), errorMsg);
        return { loader: loader.getSource(), commands: [], error: errorMsg };
      }
    });

    const results = await Promise.all(loaderPromises);

    for (const result of results) {
      allCommands.push(...result.commands);
      if (result.error) {
        allErrors.push({ name: result.loader, error: result.error });
      }
    }

    return { commands: allCommands, errors: allErrors };
  }

  getLoaderCount(): number {
    return this.loaders.length;
  }

  getLoadStatus(): CommandLoadStatus {
    return {
      loaded: [],
      failed: Array.from(this.loadErrors.entries()).map(([name, error]) => ({ name, error })),
    };
  }
}

/**
 * 命令加载器注册表实例
 */
export const commandLoaderRegistry = new CommandLoaderRegistry();

// 注册加载器
commandLoaderRegistry.registerLoader(new BuiltinCommandLoader());
commandLoaderRegistry.registerLoader(new SkillCommandLoader());
commandLoaderRegistry.registerLoader(new PluginCommandLoader());
commandLoaderRegistry.registerLoader(new MCPCommandLoader());
