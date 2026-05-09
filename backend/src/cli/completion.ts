/**
 * 命令补全模块
 * 提供命令行自动补全功能
 */

import { commandHistory } from './history';

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export class CommandCompleter {
  private commands: CompletionItem[] = [];
  private subcommands: Record<string, CompletionItem[]> = {};

  constructor() {
    this.initializeCommands();
  }

  /**
   * 初始化命令列表
   */
  private initializeCommands(): void {
    this.commands = [
      { value: 'login', label: 'login', description: 'Login to PY_APP' },
      { value: 'logout', label: 'logout', description: 'Logout from PY_APP' },
      { value: 'status', label: 'status', description: 'Show project status' },
      { value: 'help', label: 'help', description: 'Show help information' },
      { value: 'version', label: 'version', description: 'Show version' },
      { value: 'read', label: 'read', description: 'Read file content' },
      { value: 'write', label: 'write', description: 'Write content to file' },
      { value: 'list', label: 'list', description: 'List directory contents' },
      {
        value: 'search',
        label: 'search',
        description: 'Search content in files',
      },
      { value: 'exec', label: 'exec', description: 'Execute shell command' },
      { value: 'edit', label: 'edit', description: 'Edit file content' },
      {
        value: 'glob',
        label: 'glob',
        description: 'Match files using glob pattern',
      },
      {
        value: 'tools',
        label: 'tools',
        description: 'List all available tools',
      },
      { value: 'tool', label: 'tool', description: 'Show tool details' },
      { value: 'skill', label: 'skill', description: 'Manage skills' },
      { value: 'mcp', label: 'mcp', description: 'Manage MCP connections' },
      { value: 'lsp', label: 'lsp', description: 'Manage LSP services' },
      {
        value: 'performance',
        label: 'performance',
        description: 'Manage performance analysis',
      },
      { value: 'theme', label: 'theme', description: 'Manage themes' },
      { value: 'agent', label: 'agent', description: 'Manage agents' },
      { value: 'plugins', label: 'plugins', description: 'Manage plugins' },
      { value: 'auto', label: 'auto', description: 'Auto mode' },
      {
        value: 'config',
        label: 'config',
        description: 'Manage configuration (get/set/list)',
      },
      {
        value: 'clear',
        label: 'clear',
        description: 'Clear terminal screen',
      },
      {
        value: 'memory',
        label: 'memory',
        description: 'Memory file management (list/create/show/edit/delete)',
      },
    ];

    this.subcommands = {
      agent: [
        { value: 'list', label: 'list', description: 'List all agents' },
        { value: 'start', label: 'start', description: 'Start an agent' },
        { value: 'stop', label: 'stop', description: 'Stop an agent' },
        { value: 'restart', label: 'restart', description: 'Restart an agent' },
        { value: 'create', label: 'create', description: 'Create a new agent' },
      ],
      mcp: [
        { value: 'list', label: 'list', description: 'List MCP servers' },
        {
          value: 'connect',
          label: 'connect',
          description: 'Connect to MCP server',
        },
        {
          value: 'disconnect',
          label: 'disconnect',
          description: 'Disconnect from MCP server',
        },
      ],
      plugins: [
        { value: 'list', label: 'list', description: 'List plugins' },
        { value: 'install', label: 'install', description: 'Install plugin' },
        {
          value: 'uninstall',
          label: 'uninstall',
          description: 'Uninstall plugin',
        },
        { value: 'enable', label: 'enable', description: 'Enable plugin' },
        { value: 'disable', label: 'disable', description: 'Disable plugin' },
      ],
      auto: [
        { value: 'start', label: 'start', description: 'Start auto mode' },
        { value: 'stop', label: 'stop', description: 'Stop auto mode' },
        {
          value: 'status',
          label: 'status',
          description: 'Check auto mode status',
        },
        {
          value: 'config',
          label: 'config',
          description: 'Configure auto mode',
        },
      ],
      theme: [
        { value: 'list', label: 'list', description: 'List themes' },
        { value: 'set', label: 'set', description: 'Set theme' },
        { value: 'info', label: 'info', description: 'Show theme info' },
        { value: 'toggle', label: 'toggle', description: 'Toggle theme' },
      ],
      performance: [
        {
          value: 'report',
          label: 'report',
          description: 'Generate performance report',
        },
        {
          value: 'snapshot',
          label: 'snapshot',
          description: 'Get performance snapshot',
        },
        {
          value: 'clear',
          label: 'clear',
          description: 'Clear performance history',
        },
      ],
      config: [
        { value: 'get', label: 'get', description: 'Get a config value' },
        { value: 'set', label: 'set', description: 'Set a config value' },
        { value: 'list', label: 'list', description: 'List all config values' },
      ],
      clear: [
        { value: '--help', label: '--help', description: 'Show clear command help' },
      ],
      memory: [
        { value: '--list', label: '--list', description: 'List all memory files' },
        { value: '-l', label: '-l', description: 'List all memory files' },
        { value: '--create', label: '--create', description: 'Create a new memory file' },
        { value: '-c', label: '-c', description: 'Create a new memory file' },
        { value: '--show', label: '--show', description: 'Show a memory file' },
        { value: '-s', label: '-s', description: 'Show a memory file' },
        { value: '--edit', label: '--edit', description: 'Edit a memory file' },
        { value: '-e', label: '-e', description: 'Edit a memory file' },
        { value: '--delete', label: '--delete', description: 'Delete a memory file' },
        { value: '-d', label: '-d', description: 'Delete a memory file' },
        { value: 'status', label: 'status', description: 'Show memory status' },
        { value: 'help', label: 'help', description: 'Show memory command help' },
      ],
    };
  }

  /**
   * 获取命令补全建议
   */
  complete(input: string): CompletionItem[] {
    const parts = input.trim().split(' ');
    const command = parts[0];
    const subcommand = parts[1];

    // 如果只有一个单词，补全命令
    if (parts.length === 1) {
      return this.completeCommand(command);
    }

    // 如果有两个单词，补全子命令
    if (parts.length === 2) {
      return this.completeSubcommand(command, subcommand);
    }

    // 如果有更多单词，尝试历史补全
    return this.completeFromHistory(input);
  }

  /**
   * 补全命令
   */
  private completeCommand(prefix: string): CompletionItem[] {
    const matched = this.commands.filter((cmd) =>
      cmd.value.toLowerCase().startsWith(prefix.toLowerCase())
    );

    // 同时从历史记录中获取建议
    const historySuggestions = commandHistory.getSuggestions(prefix);
    const historyItems = historySuggestions.map((cmd) => ({
      value: cmd,
      label: cmd,
      description: '(history)',
    }));

    // 合并去重
    const seen = new Set<string>();
    const result: CompletionItem[] = [];

    [...matched, ...historyItems].forEach((item) => {
      if (!seen.has(item.value)) {
        seen.add(item.value);
        result.push(item);
      }
    });

    return result.slice(0, 10);
  }

  /**
   * 补全子命令
   */
  private completeSubcommand(
    command: string,
    prefix: string
  ): CompletionItem[] {
    const subs = this.subcommands[command] || [];
    return subs.filter((sub) =>
      sub.value.toLowerCase().startsWith(prefix.toLowerCase())
    );
  }

  /**
   * 从历史记录补全
   */
  private completeFromHistory(input: string): CompletionItem[] {
    const suggestions = commandHistory.getSuggestions(input);
    return suggestions.map((cmd) => ({
      value: cmd,
      label: cmd,
      description: '(history)',
    }));
  }

  /**
   * 获取所有命令
   */
  getAllCommands(): CompletionItem[] {
    return this.commands;
  }

  /**
   * 获取指定命令的子命令
   */
  getSubcommands(command: string): CompletionItem[] {
    return this.subcommands[command] || [];
  }

  /**
   * 添加自定义命令
   */
  addCommand(item: CompletionItem): void {
    if (!this.commands.find((c) => c.value === item.value)) {
      this.commands.push(item);
    }
  }

  /**
   * 添加子命令
   */
  addSubcommand(command: string, item: CompletionItem): void {
    if (!this.subcommands[command]) {
      this.subcommands[command] = [];
    }
    if (!this.subcommands[command].find((c) => c.value === item.value)) {
      this.subcommands[command].push(item);
    }
  }
}

/**
 * 创建命令补全器实例
 */
export function createCommandCompleter(): CommandCompleter {
  return new CommandCompleter();
}

/**
 * 全局命令补全器实例
 */
export const commandCompleter = createCommandCompleter();
