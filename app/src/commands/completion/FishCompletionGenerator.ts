/**
 * Fish Shell 自动补全脚本生成器
 * 为所有注册的命令生成 Fish Shell 兼容的 complete 脚本
 */

import { commandRegistry } from '@modules/commands/registry/CommandRegistry.js';
import type { Command } from '@modules/commands/types/index';

/**
 * Fish Shell 补全脚本生成器
 */
export class FishCompletionGenerator {
  /**
   * 生成完整 Fish Shell 补全脚本
   * @returns Fish 格式的补全脚本字符串
   */
  generate(): string {
    const lines: string[] = [];

    lines.push('# Liri Fish Shell completions');
    lines.push(`# Generated at ${new Date().toISOString()}`);
    lines.push('');

    const commands = commandRegistry.getVisible();
    const processed = new Set<string>();

    for (const cmd of commands) {
      const names = [cmd.name, ...(cmd.aliases || [])];

      for (const name of names) {
        if (processed.has(name)) continue;
        processed.add(name);

        const completions = this.buildCompletions(cmd, name);
        lines.push(...completions);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * 为单个命令构建 Fish 补全条目
   * @param cmd 命令对象
   * @param name 命令名称（可能是别名）
   * @returns Fish complete 指令行
   */
  private buildCompletions(cmd: Command, name: string): string[] {
    const lines: string[] = [];
    const escapedDesc = (cmd.description || '').replace(/['"]/g, '');

    lines.push(
      `complete -c py -n '__fish_Liri_using_command' -f -a '${name}' -d '${escapedDesc}'`
    );

    return lines;
  }

  /**
   * 生成 Fish 辅助函数
   * @returns Fish 辅助函数脚本
   */
  generateHelperFunctions(): string {
    return [
      'function __fish_Liri_using_command',
      '  set -l cmd (commandline -opc)',
      '  if [ (count $cmd) -eq 1 ]',
      '    return 0',
      '  end',
      '  return 1',
      'end',
      '',
    ].join('\n');
  }

  /**
   * 将补全脚本写入 Fish 配置目录
   * @param fishDir Fish 配置目录（默认 ~/.config/fish/completions/）
   * @returns 写入路径
   */
  getInstallPath(fishDir: string = ''): string {
    const { homedir } = require('os');
    const { join } = require('path');

    const targetDir =
      fishDir || join(homedir(), '.config', 'fish', 'completions');

    return join(targetDir, 'Liri.fish');
  }
}

/** 全局 Fish 补全生成器实例 */
export const fishCompletionGenerator = new FishCompletionGenerator();
