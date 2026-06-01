/**
 * 命令加载器
 * 从不同源加载命令
 */
import type {
  Command,
  CommandLoader,
  LoadResult,
  CommandLoadStatus,
} from '@modules/commands/types';
import { feature } from '@modules/core';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

import { LazyCommand } from './LazyCommand.js';
import { resolveProjectRoot } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

// 获取项目根目录（通过统一路径解析）
const projectRoot = resolveProjectRoot();

interface BuiltinModuleEntry {
  path: string;
  name: string;
  aliases?: string[];
}

/**
 * 内置命令加载器（懒加载模式）
 * 仅在首次通过 getLoadedCommand() 或 load() 调用时导入模块
 */
export class BuiltinCommandLoader implements CommandLoader {
  private loadedCommands: Map<string, Command> = new Map();
  private loadErrors: Map<string, string> = new Map();
  private moduleEntries: BuiltinModuleEntry[] = [];

  /**
   * 加载命令（首次仅注册元数据，不导入模块）
   */
  async loadCommands(): Promise<Command[]> {
    const result = await this.loadBuiltInCommands();
    return result.commands;
  }

  /**
   * 注册所有内置命令为懒加载代理
   */
  async loadBuiltInCommands(): Promise<LoadResult> {
    this.moduleEntries = [
      { path: '../builtin/help/index.js', name: 'help' },
      { path: '../builtin/onboard/index.js', name: 'onboard' },
      // 对话演示
      {
        path: '../builtin/demo/index.js',
        name: 'demo',
        aliases: ['preview', 'example', 'demo-chat'],
      },
      { path: '../builtin/status/index.js', name: 'status' },
      { path: '../builtin/clear/index.js', name: 'clear' },
      { path: '../builtin/skill/index.js', name: 'skill' },
      { path: '../builtin/config/index.js', name: 'config' },
      { path: '../builtin/history/index.js', name: 'history' },
      { path: '../builtin/tool/index.js', name: 'tool' },
      { path: '../builtin/compact/index.js', name: 'compact' },
      { path: '../builtin/session/index.js', name: 'session' },
      { path: '../builtin/exit/index.js', name: 'exit' },
      { path: '../builtin/advisor/index.js', name: 'advisor' },
      { path: '../builtin/brief/index.js', name: 'brief' },
      { path: '../builtin/cache/index.js', name: 'cache' },
      { path: '../builtin/chat/index.js', name: 'chat' },
      { path: '../builtin/commit/index.js', name: 'commit' },
      { path: '../builtin/git/index.js', name: 'git' },
      { path: '../builtin/complete/index.js', name: 'complete' },
      { path: '../builtin/parallel/index.js', name: 'parallel' },
      { path: '../builtin/permissions/index.js', name: 'permission' },
      { path: '../builtin/security/index.js', name: 'security' },
      { path: '../builtin/vim/index.js', name: 'vim' },
      { path: '../builtin/voice/index.js', name: 'voice' },
      { path: '../builtin/export/index.js', name: 'export' },
      { path: '../builtin/share/index.js', name: 'share' },
      { path: '../builtin/version/index.js', name: 'version' },
      { path: '../builtin/activity/index.js', name: 'activity' },
      { path: '../builtin/cost/index.js', name: 'cost' },
      { path: '../builtin/pricing/index.js', name: 'pricing' },
      { path: '../builtin/usage/index.js', name: 'usage' },
      { path: '../builtin/doctor/index.js', name: 'doctor' },
      { path: '../builtin/fast/index.js', name: 'fast' },
      { path: '../builtin/memory/index.js', name: 'memory' },
      { path: '../builtin/hooks/index.js', name: 'hooks' },
      { path: '../builtin/mcp/index.js', name: 'mcp' },
      { path: '../builtin/plugins/index.js', name: 'plugins' },
      { path: '../builtin/permissions/index.js', name: 'permissions' },
      { path: '../builtin/tokens/index.js', name: 'tokens' },
      { path: '../builtin/env/index.js', name: 'env' },
      { path: '../builtin/debug/index.js', name: 'debug' },
      {
        path: '../agents/index.js',
        name: 'subagent',
        aliases: ['agent', 'agents'],
      },
      { path: '../bridge/index.js', name: 'bridge' },
      { path: '../ide/index.js', name: 'ide' },
      { path: '../tasks/index.js', name: 'tasks' },
      { path: '../model/index.js', name: 'model' },
      { path: '../tools/file/write.js', name: 'write' },
      { path: '../tools/file/edit.js', name: 'edit' },
      { path: '../tools/file/glob.js', name: 'glob' },
      { path: '../tools/file/convert.js', name: 'convert' },
      { path: '../tools/system/bash.js', name: 'bash' },
      { path: '../tools/system/grep.js', name: 'grep' },
      {
        path: '../tools/ai/agent.js',
        name: 'subagent-run',
        aliases: ['agent_tool'],
      },
      {
        path: '../tools/ai/agents.js',
        name: 'agent-instance',
        aliases: ['agents_tool'],
      },
      { path: '../tools/network/fetch.js', name: 'fetch' },
      { path: '../tools/network/websearch.js', name: 'websearch' },
      { path: '../tools/task/todo.js', name: 'todo' },
      { path: '../tools/task/task.js', name: 'task' },
      { path: '../tools/dev/lsp.js', name: 'lsp' },
      { path: '../tools/dev/notebook.js', name: 'notebook' },
      // 基础命令（从 builtin/index.ts 补充）
      { path: '../builtin/copy/index.js', name: 'copy', aliases: ['cp'] },
      { path: '../builtin/branch/index.js', name: 'branch' },
      {
        path: '../builtin/add-dir/index.js',
        name: 'add-dir',
        aliases: ['add', 'cd'],
      },
      {
        path: '../builtin/context/index.js',
        name: 'context',
        aliases: ['ctx'],
      },
      { path: '../builtin/rename/index.js', name: 'rename', aliases: ['rn'] },
      { path: '../builtin/rewind/index.js', name: 'rewind', aliases: ['undo'] },
      { path: '../builtin/init/index.js', name: 'init', aliases: ['create'] },
      { path: '../builtin/effort/index.js', name: 'effort' },
      { path: '../builtin/keybindings/index.js', name: 'keybindings' },
      {
        path: '../builtin/privacy-settings/index.js',
        name: 'privacy-settings',
      },
      { path: '../builtin/output-style/index.js', name: 'output-style' },
      { path: '../builtin/files/index.js', name: 'files' },
      { path: '../builtin/sandbox-toggle/index.js', name: 'sandbox-toggle' },
      { path: '../builtin/remote-env/index.js', name: 'remote-env' },
      { path: '../builtin/insights/index.js', name: 'insights' },
      { path: '../builtin/plan/index.js', name: 'plan' },
      { path: '../builtin/upgrade/index.js', name: 'upgrade' },
      { path: '../builtin/passes/index.js', name: 'passes' },
      { path: '../builtin/reload-plugins/index.js', name: 'reload-plugins' },
      {
        path: '../builtin/terminalSetup/index.js',
        name: 'terminalSetup',
        aliases: ['term', 'terminal'],
      },
      { path: '../builtin/feedback/index.js', name: 'feedback' },
      { path: '../builtin/extra-usage/index.js', name: 'extra-usage' },
      { path: '../builtin/release-notes/index.js', name: 'release-notes' },
      { path: '../builtin/thinkback/index.js', name: 'thinkback' },
      { path: '../builtin/statusline/index.js', name: 'statusline' },
      {
        path: '../builtin/rate-limit-options/index.js',
        name: 'rate-limit-options',
      },
      { path: '../builtin/chrome/index.js', name: 'chrome' },
      { path: '../builtin/btw/index.js', name: 'btw' },
      { path: '../builtin/tag/index.js', name: 'tag' },
      { path: '../builtin/color/index.js', name: 'color' },
      { path: '../builtin/desktop/index.js', name: 'desktop' },
      { path: '../builtin/mobile/index.js', name: 'mobile' },
      { path: '../builtin/login/index.js', name: 'login' },
      { path: '../builtin/logout/index.js', name: 'logout' },
      {
        path: '../builtin/install-github-app/index.js',
        name: 'install-github-app',
      },
      {
        path: '../builtin/install-slack-app/index.js',
        name: 'install-slack-app',
      },
      { path: '../builtin/stickers/index.js', name: 'stickers' },
      { path: '../builtin/heapdump/index.js', name: 'heapdump' },
      { path: '../builtin/pr-comments/index.js', name: 'pr-comments' },
      { path: '../builtin/search/index.js', name: 'search' },
      { path: '../builtin/restart/index.js', name: 'restart' },
      { path: '../builtin/tutorial/index.js', name: 'tutorial' },
      { path: '../builtin/theme/index.js', name: 'theme' },
      { path: '../builtin/keyboard/index.js', name: 'keyboard' },
      { path: '../builtin/workspace/index.js', name: 'workspace' },
      { path: '../builtin/timer/index.js', name: 'timer' },
      {
        path: '../builtin/docs/index.js',
        name: 'docs',
        aliases: ['doc', 'documentation', 'help-docs'],
      },
      {
        path: '../builtin/knowledge/index.js',
        name: 'knowledge',
        aliases: ['kb', 'wiki', 'note'],
      },
      // 遗漏命令补充
      { path: '../builtin/diff/index.js', name: 'diff' },
      { path: '../builtin/review/index.js', name: 'review' },
      { path: '../builtin/resume/index.js', name: 'resume' },
      {
        path: '../builtin/modules/index.js',
        name: 'modules',
        aliases: ['mod', 'module'],
      },
      {
        path: '../builtin/checkpoint/index.js',
        name: 'checkpoint',
        aliases: ['cp'],
      },
      // AI Trace 录制模块命令
      {
        path: '../builtin/trace-recording/index.js',
        name: 'trace',
        aliases: ['ai-trace', 'tracer'],
      },
      // CC 对标补充命令
      {
        path: '../builtin/commit-push-pr/index.js',
        name: 'commit-push-pr',
        aliases: ['pr-create', 'commit-pr'],
      },
      { path: '../builtin/thinkback-play/index.js', name: 'thinkback-play' },
      {
        path: '../builtin/security-review/index.js',
        name: 'security-review',
        aliases: ['sec-review'],
      },
      // Cron 定时作业管理命令
      {
        path: '../cron/index.js',
        name: 'cron',
        aliases: ['scheduler', 'scheduled'],
      },
    ];

    const commands: Command[] = [];
    const errors: { name: string; error: string }[] = [];

    for (const entry of this.moduleEntries) {
      try {
        // 移除路径开头的 ../ 前缀
        const normalizedPath = entry.path.replace(/^\.\.\//, '');
        // 构建完整的绝对路径
        const absolutePath = join(
          projectRoot,
          'src',
          'commands',
          normalizedPath
        );
        const lazyCmd = new LazyCommand({
          type: 'prompt',
          name: entry.name,
          description: `${entry.name} command`,
          modulePath: absolutePath,
          aliases: entry.aliases,
          loadedFrom: 'builtin',
        });

        commands.push(lazyCmd);
        this.loadedCommands.set(entry.name, lazyCmd);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ name: entry.name, error: errorMsg });
        this.loadErrors.set(entry.name, errorMsg);
      }
    }

    return { commands, errors };
  }

  getLoadedCommand(nameOrAlias: string): Command | undefined {
    return this.loadedCommands.get(nameOrAlias);
  }

  getLoadStatus(): CommandLoadStatus {
    return {
      loaded: Array.from(this.loadedCommands.keys()),
      failed: Array.from(this.loadErrors.entries()).map(([name, error]) => ({
        name,
        error,
      })),
    };
  }

  isCommandLoaded(name: string): boolean {
    return this.loadedCommands.has(name);
  }

  getLoadedCommands(): Command[] {
    return Array.from(this.loadedCommands.values());
  }

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
      logger.error('Failed to load skill commands:', { error });
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
      const pluginCommands = await pluginManager.getCommands();
      commands.push(...pluginCommands);
    } catch (error) {
      logger.error('Failed to load plugin commands:', { error });
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
    if (!feature('MCP_SYSTEM')) {
      return [];
    }

    const commands: Command[] = [];

    try {
      const { mcpManager } = await import('../../mcp/managers/MCPManager.js');
      const mcpCommands = await mcpManager.getCommands();
      commands.push(...(mcpCommands as Command[]));
    } catch (error) {
      logger.error('Failed to load MCP commands:', { error });
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
      failed: Array.from(this.loadErrors.entries()).map(([name, error]) => ({
        name,
        error,
      })),
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
