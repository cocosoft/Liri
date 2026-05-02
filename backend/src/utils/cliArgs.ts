/**
 * CLI参数解析工具
 * 负责早期参数解析和快速路径处理
 */

import type { ThinkingEffort } from '@modules/ai';
import { parseEffortArg } from '@modules/ai';

/**
 * 早期解析CLI标志值，在Commander.js处理参数之前
 * 支持空格分隔（--flag value）和等号分隔（--flag=value）语法
 *
 * 此函数用于必须在init()运行前解析的标志，例如影响配置加载的--settings
 * 对于普通标志解析，依赖Commander.js自动处理
 *
 * @param flagName 标志名称包括破折号（例如 '--settings'）
 * @param argv 可选的argv数组（默认为process.argv）
 * @returns 如果找到则返回值，否则返回undefined
 */
export function eagerParseCliFlag(
  flagName: string,
  argv: string[] = process.argv
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // 处理 --flag=value 语法
    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
    // 处理 --flag value 语法
    if (arg === flagName && i + 1 < argv.length) {
      return argv[i + 1];
    }
  }
  return undefined;
}

/**
 * 处理CLI参数中的标准Unix `--` 分隔符约定
 *
 * 当使用Commander.js与`.passThroughOptions()`时，`--`分隔符
 * 作为位置参数传递而不是被消耗。这意味着当用户运行：
 *   `cmd --opt value name -- subcmd --flag arg`
 *
 * Commander解析为：
 *   positional1 = "name", positional2 = "--", rest = ["subcmd", "--flag", "arg"]
 *
 * 此函数通过从rest数组中提取实际命令来纠正解析，当位置参数是`--`时
 *
 * @param commandOrValue 可能是"--"的解析位置参数
 * @param args 剩余参数数组
 * @returns 包含纠正命令和参数的对象
 */
export function extractArgsAfterDoubleDash(
  commandOrValue: string,
  args: string[] = []
): { command: string; args: string[] } {
  if (commandOrValue === '--' && args.length > 0) {
    return {
      command: args[0]!,
      args: args.slice(1),
    };
  }
  return { command: commandOrValue, args };
}

/**
 * 解析运行模式
 * 根据命令行参数确定运行模式
 */
export function parseRunMode(argv: string[] = process.argv): string {
  const args = argv.slice(2);

  // 检查MCP模式
  if (args.includes('--mcp') || args.includes('--mcp-mode')) {
    return 'mcp';
  }

  // 检查单次执行模式
  if (args.includes('-p') || args.includes('--print')) {
    return 'print';
  }

  // 检查后台会话模式
  if (args.includes('--bg') || args.includes('--background')) {
    return 'background';
  }

  // 检查管道模式（通过检查是否有管道输入）
  if (process.stdin.isTTY === false || args.includes('--pipe')) {
    return 'pipe';
  }

  // 默认为REPL模式
  return 'repl';
}

/**
 * 验证参数
 * 检查参数的有效性
 */
export function validateArgs(args: string[]): {
  valid: boolean;
  error?: string;
} {
  // 检查是否有冲突的参数
  const exclusiveFlags = ['--mcp', '--print', '--background'];
  const foundFlags = exclusiveFlags.filter((flag) => args.includes(flag));

  if (foundFlags.length > 1) {
    return {
      valid: false,
      error: `冲突的参数: ${foundFlags.join(', ')}，只能使用一个运行模式参数`,
    };
  }

  return { valid: true };
}

/**
 * 转换参数
 * 将参数转换为标准格式
 */
export function normalizeArgs(args: string[]): string[] {
  const normalized: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // 转换短参数为长参数
    if (arg === '-v') {
      normalized.push('--version');
    } else if (arg === '-h') {
      normalized.push('--help');
    } else if (arg === '-p') {
      normalized.push('--print');
    } else {
      normalized.push(arg);
    }
  }

  return normalized;
}

export default {
  eagerParseCliFlag,
  extractArgsAfterDoubleDash,
  parseRunMode,
  validateArgs,
  normalizeArgs,
  parseEffortCliArg,
  parseVCRCliArg,
    parseManagedCliArg,
  };

export function parseEffortCliArg(argv: string[] = process.argv): {
  effort?: ThinkingEffort;
  thinkingEnabled?: boolean;
} {
  const effortArg = eagerParseCliFlag('--effort', argv);
  const thinkingArg = eagerParseCliFlag('--thinking', argv);

  const result: { effort?: ThinkingEffort; thinkingEnabled?: boolean } = {};

  if (effortArg) {
    const parsed = parseEffortArg(effortArg);
    if (parsed) {
      result.effort = parsed;
    }
  }

  if (thinkingArg !== undefined) {
    const normalized = thinkingArg.toLowerCase().trim();
    if (normalized === 'on' || normalized === 'true' || normalized === '1') {
      result.thinkingEnabled = true;
    } else if (normalized === 'off' || normalized === 'false' || normalized === '0') {
      result.thinkingEnabled = false;
    }
  }

  return result;
}

export function parseVCRCliArg(argv: string[] = process.argv): {
  vcrRecord?: string;
  vcrPlay?: string;
  vcrSpeed?: number;
} {
  const record = eagerParseCliFlag('--vcr-record', argv);
  const play = eagerParseCliFlag('--vcr-play', argv);
  const speedArg = eagerParseCliFlag('--vcr-speed', argv);

  let vcrSpeed: number | undefined
  if (speedArg) {
    const parsed = parseFloat(speedArg)
    if (!isNaN(parsed) && parsed > 0) {
      vcrSpeed = parsed
    }
  }

  return {
    vcrRecord: record,
    vcrPlay: play,
    vcrSpeed,
  }
}

export function parseManagedCliArg(argv: string[] = process.argv): {
  managed: boolean
  managedEndpoint?: string
} {
  const managed = eagerParseCliFlag('--managed', argv)
  const endpoint = eagerParseCliFlag('--managed-endpoint', argv)

  if (managed !== undefined) {
    if (managed === 'true' || managed === '1' || managed === 'on' || managed === '') {
      return { managed: true, managedEndpoint: endpoint }
    }
  }

  return { managed: !!eagerParseCliFlag('--managed', argv), managedEndpoint: endpoint }
}
