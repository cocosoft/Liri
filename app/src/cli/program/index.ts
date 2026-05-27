/**
 * CLI Program Framework
 * 对标OpenClaw cli/program/
 * 命令路由/解析/提示框架
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category?: string;
  options?: CommandOption[];
  subcommands?: CommandDefinition[];
  action: (
    args: Record<string, unknown>,
    options: Record<string, unknown>
  ) => Promise<void> | void;
}

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: unknown;
  required?: boolean;
}

export interface CommandContext {
  command: string;
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  raw: string[];
}

export class ProgramFramework {
  private commands: Map<string, CommandDefinition> = new Map();
  private categories: Map<string, string> = new Map();
  private middleware: Array<
    (ctx: CommandContext, next: () => Promise<void>) => Promise<void>
  > = [];

  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);

    if (command.category) {
      this.categories.set(command.name, command.category);
    }

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  unregister(name: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) return false;

    this.commands.delete(name);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.delete(alias);
      }
    }
    return true;
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  list(options?: { category?: string }): CommandDefinition[] {
    let result = Array.from(this.commands.values());

    if (options?.category) {
      result = result.filter((c) => c.category === options.category);
    }

    const seen = new Set<string>();
    result = result.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  getCategories(): string[] {
    return Array.from(new Set(this.categories.values())).sort();
  }

  use(
    fn: (ctx: CommandContext, next: () => Promise<void>) => Promise<void>
  ): void {
    this.middleware.push(fn);
  }

  async run(rawArgs: string[]): Promise<void> {
    const parsed = this.parse(rawArgs);
    const ctx: CommandContext = {
      command: parsed.command,
      args: parsed.args,
      options: parsed.options,
      raw: rawArgs,
    };

    const cmd = this.commands.get(parsed.command);
    if (!cmd) {
      throw new AppError(
        `Unknown command: ${parsed.command}`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { command: parsed.command }
      );
    }

    const dispatch = async (index: number): Promise<void> => {
      if (index < this.middleware.length) {
        await this.middleware[index](ctx, () => dispatch(index + 1));
      } else {
        await cmd.action(ctx.args, ctx.options);
      }
    };

    await dispatch(0);
  }

  parse(rawArgs: string[]): {
    command: string;
    args: Record<string, unknown>;
    options: Record<string, unknown>;
  } {
    const [command, ...rest] = rawArgs;
    const options: Record<string, unknown> = {};
    const args: Record<string, unknown> = {};
    const positional: string[] = [];

    let i = 0;
    while (i < rest.length) {
      const arg = rest[i];

      if (arg.startsWith('--')) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          const key = arg.slice(2, eqIdx);
          options[key] = parseValue(arg.slice(eqIdx + 1));
        } else if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
          options[arg.slice(2)] = parseValue(rest[i + 1]);
          i++;
        } else {
          options[arg.slice(2)] = true;
        }
      } else if (arg.startsWith('-') && !arg.startsWith('--')) {
        const flags = arg.slice(1);
        for (let j = 0; j < flags.length; j++) {
          options[flags[j]] = true;
        }
      } else {
        positional.push(arg);
      }

      i++;
    }

    for (const pos of positional) {
      const key = `_${positional.indexOf(pos)}`;
      args[key] = pos;
    }

    return { command: command ?? '', args, options };
  }

  generateHelpText(command?: string): string {
    if (command) {
      const cmd = this.commands.get(command);
      if (!cmd) return `Unknown command: ${command}`;
      return this.formatCommandHelp(cmd);
    }

    return this.formatFullHelp();
  }

  private formatFullHelp(): string {
    const lines: string[] = ['Available commands:\n'];
    const categories = this.getCategories();

    if (categories.length > 0) {
      for (const cat of categories) {
        lines.push(`  ${cat}:`);
        const cmds = this.list({ category: cat });
        for (const cmd of cmds) {
          lines.push(`    ${cmd.name.padEnd(20)} ${cmd.description}`);
        }
        lines.push('');
      }
    }

    const uncategorized = this.list().filter((c) => !c.category);
    if (uncategorized.length > 0) {
      lines.push('  General:');
      for (const cmd of uncategorized) {
        lines.push(`    ${cmd.name.padEnd(20)} ${cmd.description}`);
      }
    }

    return lines.join('\n');
  }

  private formatCommandHelp(cmd: CommandDefinition): string {
    const lines: string[] = [
      `Command: ${cmd.name}`,
      `Description: ${cmd.description}`,
      cmd.usage ? `Usage: ${cmd.usage}` : `Usage: ${cmd.name} [options]`,
      '',
    ];

    if (cmd.aliases && cmd.aliases.length > 0) {
      lines.push(`Aliases: ${cmd.aliases.join(', ')}`);
      lines.push('');
    }

    if (cmd.options && cmd.options.length > 0) {
      lines.push('Options:');
      for (const opt of cmd.options) {
        const defaultStr =
          opt.defaultValue !== undefined
            ? ` (default: ${opt.defaultValue})`
            : '';
        lines.push(`  ${opt.flags.padEnd(30)} ${opt.description}${defaultStr}`);
      }
      lines.push('');
    }

    if (cmd.subcommands && cmd.subcommands.length > 0) {
      lines.push('Subcommands:');
      for (const sub of cmd.subcommands) {
        lines.push(`  ${sub.name.padEnd(20)} ${sub.description}`);
      }
    }

    return lines.join('\n');
  }
}

function parseValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}
