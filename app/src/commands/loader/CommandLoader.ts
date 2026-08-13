/**
 * 命令加载器
 * 从不同源加载命令
 */
import type {
  Command,
  CommandLoader,
  LoadResult,
  CommandLoadStatus,
} from '@modules/commands';
import { feature } from '@modules/core';
import { join } from 'path';
import { getLogger } from '@modules/monitoring';

import { LazyCommand } from './LazyCommand.js';
import { resolveProjectRoot } from '@modules/core';

const logger = getLogger('CommandLoader');

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
      { path: '../builtin/command-registry.js', name: 'onboard' },
      // 对话演示
      {
        path: '../builtin/command-registry.js',
        name: 'demo',
        aliases: ['preview', 'example', 'demo-chat'],
      },
      { path: '../builtin/command-registry.js', name: 'status' },
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
      { path: '../builtin/command-registry.js', name: 'permission' },
      { path: '../builtin/security/index.js', name: 'security' },
      { path: '../builtin/vim/index.js', name: 'vim' },
      { path: '../builtin/voice/index.js', name: 'voice' },
      { path: '../builtin/export/index.js', name: 'export' },
      { path: '../builtin/share/index.js', name: 'share' },
      { path: '../builtin/version/index.js', name: 'version' },
      { path: '../builtin/command-registry.js', name: 'activity' },
      { path: '../builtin/command-registry.js', name: 'cost' },
      { path: '../builtin/command-registry.js', name: 'pricing' },
      { path: '../builtin/command-registry.js', name: 'usage' },
      { path: '../builtin/command-registry.js', name: 'doctor' },
      { path: '../builtin/command-registry.js', name: 'fast' },
      { path: '../builtin/command-registry.js', name: 'memory' },
      { path: '../builtin/command-registry.js', name: 'hooks' },
      { path: '../builtin/command-registry.js', name: 'mcp' },
      { path: '../builtin/command-registry.js', name: 'plugins' },
      { path: '../builtin/command-registry.js', name: 'permissions' },
      { path: '../builtin/command-registry.js', name: 'tokens' },
      { path: '../builtin/command-registry.js', name: 'env' },
      { path: '../builtin/command-registry.js', name: 'debug' },
      {
        path: '../agents/index.js',
        name: 'subagent',
        aliases: ['agent', 'agents'],
      },
      { path: '../bridge/index.js', name: 'bridge' },
      { path: '../ide/index.js', name: 'ide' },
      { path: '../builtin/command-registry.js', name: 'tasks' },
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
        path: '../builtin/command-registry.js',
        name: 'add-dir',
        aliases: ['add', 'cd'],
      },
      {
        path: '../builtin/command-registry.js',
        name: 'context',
        aliases: ['ctx'],
      },
      {
        path: '../builtin/command-registry.js',
        name: 'rename',
        aliases: ['rn'],
      },
      {
        path: '../builtin/command-registry.js',
        name: 'rewind',
        aliases: ['undo'],
      },
      {
        path: '../builtin/command-registry.js',
        name: 'init',
        aliases: ['create'],
      },
      { path: '../builtin/command-registry.js', name: 'effort' },
      { path: '../builtin/command-registry.js', name: 'keybindings' },
      {
        path: '../builtin/command-registry.js',
        name: 'privacy-settings',
      },
      { path: '../builtin/command-registry.js', name: 'output-style' },
      { path: '../builtin/command-registry.js', name: 'files' },
      { path: '../builtin/command-registry.js', name: 'sandbox-toggle' },
      { path: '../builtin/command-registry.js', name: 'remote-env' },
      { path: '../builtin/command-registry.js', name: 'insights' },
      { path: '../builtin/command-registry.js', name: 'plan' },
      { path: '../builtin/command-registry.js', name: 'goal' },
      { path: '../builtin/command-registry.js', name: 'upgrade' },
      { path: '../builtin/command-registry.js', name: 'passes' },
      { path: '../builtin/command-registry.js', name: 'reload-plugins' },
      {
        path: '../builtin/command-registry.js',
        name: 'terminalSetup',
        aliases: ['term', 'terminal'],
      },
      { path: '../builtin/command-registry.js', name: 'feedback' },
      { path: '../builtin/command-registry.js', name: 'extra-usage' },
      { path: '../builtin/command-registry.js', name: 'release-notes' },
      { path: '../builtin/command-registry.js', name: 'thinkback' },
      { path: '../builtin/command-registry.js', name: 'statusline' },
      {
        path: '../builtin/command-registry.js',
        name: 'rate-limit-options',
      },
      { path: '../builtin/command-registry.js', name: 'chrome' },
      { path: '../builtin/command-registry.js', name: 'btw' },
      { path: '../builtin/command-registry.js', name: 'tag' },
      { path: '../builtin/command-registry.js', name: 'color' },
      { path: '../builtin/command-registry.js', name: 'desktop' },
      { path: '../builtin/command-registry.js', name: 'mobile' },
      { path: '../builtin/command-registry.js', name: 'login' },
      { path: '../builtin/command-registry.js', name: 'logout' },
      {
        path: '../builtin/command-registry.js',
        name: 'install-github-app',
      },
      {
        path: '../builtin/command-registry.js',
        name: 'install-slack-app',
      },
      { path: '../builtin/command-registry.js', name: 'stickers' },
      { path: '../builtin/command-registry.js', name: 'heapdump' },
      { path: '../builtin/command-registry.js', name: 'pr-comments' },
      { path: '../builtin/command-registry.js', name: 'search' },
      { path: '../builtin/command-registry.js', name: 'restart' },
      { path: '../builtin/command-registry.js', name: 'tutorial' },
      { path: '../builtin/command-registry.js', name: 'theme' },
      { path: '../builtin/command-registry.js', name: 'keyboard' },
      { path: '../builtin/workspace/index.js', name: 'workspace' },
      { path: '../builtin/command-registry.js', name: 'timer' },
      {
        path: '../builtin/command-registry.js',
        name: 'docs',
        aliases: ['doc', 'documentation', 'help-docs'],
      },
      {
        path: '../builtin/command-registry.js',
        name: 'knowledge',
        aliases: ['kb', 'wiki', 'note'],
      },
      // 遗漏命令补充
      { path: '../builtin/diff/index.js', name: 'diff' },
      { path: '../builtin/command-registry.js', name: 'review' },
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
      { path: '../builtin/command-registry.js', name: 'thinkback-play' },
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
          'app',
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
      const { SkillRegistry } = await import('../../skills/SkillRegistry.js');
      const { BundledSkillLoader } =
        await import('../../skills/loaders/sources/BundledSkillLoader.js');
      const registry = new SkillRegistry();
      const loader = new BundledSkillLoader();
      const loadedSkills = await loader.loadSkills();
      registry.registerBatch(loadedSkills);
      const skills = registry.getAll().filter((s) => s.userInvocable !== false);

      // 将技能转换为命令
      for (const skill of skills) {
        const command: Command = {
          type: 'prompt',
          name: skill.name,
          description: skill.description || '',
          hasUserSpecifiedDescription: false,
          aliases: [],
          argumentHint: skill.argumentHint,
          whenToUse: skill.whenToUse,
          version: skill.version,
          disableModelInvocation: skill.disableModelInvocation,
          userInvocable: skill.userInvocable,
          loadedFrom: 'skill',
          isHidden: skill.isHidden,
          load: async () => ({
            getPromptForCommand:
              skill.impl.kind === 'prompt'
                ? (skill.impl as any).getPromptForCommand?.bind(skill.impl)
                : undefined,
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
