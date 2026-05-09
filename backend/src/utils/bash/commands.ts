/**
 * Bash 命令前缀提取
 *
 * 提供命令前缀和子命令前缀的提取工具。
 * 参考 CC源码 cc_code/backend/utils/bash/commands.ts
 */

export interface CommandPrefixResult {
  command: string;
  subcommand?: string;
}

export function createCommandPrefixExtractor(
  knownCommands: Set<string>
): (argv: string[]) => CommandPrefixResult | null {
  return (argv: string[]): CommandPrefixResult | null => {
    if (argv.length === 0) return null;

    const cmd = argv[0]!;
    if (knownCommands.has(cmd)) {
      return { command: cmd };
    }

    return null;
  };
}

export function createSubcommandPrefixExtractor(
  commandPrefixExtractor: (argv: string[]) => CommandPrefixResult | null,
  knownSubcommands: Set<string>
): (argv: string[]) => CommandPrefixResult | null {
  return (argv: string[]): CommandPrefixResult | null => {
    const result = commandPrefixExtractor(argv);
    if (!result) return null;

    if (argv.length > 1 && knownSubcommands.has(argv[1]!)) {
      result.subcommand = argv[1];
    }

    return result;
  };
}
