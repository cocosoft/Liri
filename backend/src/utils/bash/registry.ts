/**
 * Bash 命令注册表
 *
 * 维护已知 Bash 命令的规格信息，用于安全分析和智能补全。
 * 无第三方依赖 — 命令规格为内置静态数据。
 */

/**
 * 命令参数定义
 */
export interface Argument {
  name?: string;
  description?: string;
  isDangerous?: boolean;
  isVariadic?: boolean;
  isOptional?: boolean;
  isCommand?: boolean;
  isModule?: string | boolean;
  isScript?: boolean;
}

/**
 * 命令选项定义
 */
export interface Option {
  name: string | string[];
  description?: string;
  args?: Argument | Argument[];
  isRequired?: boolean;
}

/**
 * 命令规格
 */
export interface CommandSpec {
  name: string;
  description?: string;
  subcommands?: CommandSpec[];
  args?: Argument | Argument[];
  options?: Option[];
}

/**
 * 危险命令集合 — 具有破坏性潜力的命令
 */
const DANGEROUS_COMMANDS = new Set([
  'rm',
  'del',
  'deltree',
  'rd',
  'dd',
  'mkfs',
  'fdisk',
  'format',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'kill',
  'killall',
  'pkill',
  'chmod',
  'chown',
  'chattr',
  'sudo',
  'doas',
  'pkexec',
]);

/**
 * 包装命令集合 — 用于运行其他命令的命令
 */
const WRAPPER_COMMANDS = new Set([
  'sudo',
  'doas',
  'timeout',
  'nice',
  'nohup',
  'env',
  'time',
  'numactl',
  'chrt',
  'stdbuf',
  'watch',
  'setsid',
  'taskset',
  'ionice',
]);

/**
 * 内置命令规格
 */
const BUILTIN_SPECS: CommandSpec[] = [
  {
    name: 'git',
    description: '版本控制系统',
    subcommands: [
      'add',
      'commit',
      'push',
      'pull',
      'fetch',
      'merge',
      'rebase',
      'branch',
      'checkout',
      'log',
      'diff',
      'status',
      'clone',
      'init',
      'remote',
      'stash',
    ].map((name) => ({
      name,
    })),
  },
  {
    name: 'npm',
    description: 'Node.js 包管理器',
    subcommands: ['install', 'run', 'test', 'build', 'publish', 'init'].map(
      (name) => ({ name })
    ),
    args: [{ name: 'script', isScript: true }],
  },
  {
    name: 'npx',
    description: 'Node.js 包执行器',
    args: [{ name: 'command', isCommand: true }],
  },
  {
    name: 'sudo',
    description: '以超级用户执行命令',
    args: [{ name: 'command', isCommand: true }],
  },
  {
    name: 'timeout',
    description: '限制命令运行时间',
    args: [{ name: 'duration' }, { name: 'command', isCommand: true }],
  },
  {
    name: 'nohup',
    description: '忽略挂起信号运行命令',
    args: [{ name: 'command', isCommand: true }],
  },
  {
    name: 'docker',
    description: '容器管理工具',
    subcommands: [
      'run',
      'exec',
      'build',
      'pull',
      'push',
      'ps',
      'images',
      'rm',
      'stop',
    ].map((name) => ({ name })),
  },
  {
    name: 'python',
    description: 'Python 解释器',
    args: [{ name: 'script', isScript: true }],
  },
  {
    name: 'node',
    description: 'Node.js 解释器',
    args: [{ name: 'script', isScript: true }],
  },
  {
    name: 'cat',
    description: '连接文件并输出',
    args: [{ name: 'files', isVariadic: true }],
  },
  {
    name: 'echo',
    description: '输出文本',
    args: [{ name: 'text', isVariadic: true }],
  },
];

/**
 * 检查命令是否为危险命令
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMANDS.has(command);
}

/**
 * 检查命令是否为包装命令
 */
export function isWrapperCommand(command: string): boolean {
  return WRAPPER_COMMANDS.has(command);
}

/**
 * 获取命令规格
 *
 * 先查内置规格，未找到时返回 null。
 */
export function getCommandSpec(command: string): CommandSpec | null {
  if (!command || command.includes('/') || command.includes('\\')) return null;
  if (command.startsWith('-') && command !== '-') return null;

  return BUILTIN_SPECS.find((s) => s.name === command) ?? null;
}

/**
 * 获取所有已知命令名
 */
export function getAllCommandNames(): string[] {
  return BUILTIN_SPECS.map((s) => s.name);
}

/**
 * 查找子命令规格
 */
export function findSubcommandSpec(
  parent: CommandSpec,
  name: string
): CommandSpec | undefined {
  return parent.subcommands?.find((s) => s.name === name);
}

/**
 * 检查参数是否为命令包装参数（isCommand）
 */
export function isCommandArgument(arg: Argument): boolean {
  return arg.isCommand === true;
}
