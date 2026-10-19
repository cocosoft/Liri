/**
 * 维护类子命令的 argv 分发（C-5 生产入口补齐，2026-10-18）。
 *
 * 背景：`LaunchMode.CLI` 已在 D-229 删除（`entrypoints/cli.tsx` 为死代码），
 * `PromptHandler` 自此**没有生产入口**（仅测试直达）⇒ `liri prompt validate` 会被
 * 当作未知启动模式落入 REPL（连带启动 HTTP 服务与通道），维护命令实际不可用。
 *
 * 本模块只做两件事，不重建通用 CLI 框架：
 *   ① 从 argv 识别维护命令（**白名单**，避免把任意词当命令）；
 *   ② 调用既有单一实现（`PromptHandler`），返回显式退出码。
 *
 * 新增维护命令：在 `MAINTENANCE_COMMANDS` 登记 + `runMaintenanceCommand` 分支即可。
 */

export type MaintenanceCommandName = 'prompt' | 'pairing';

export interface MaintenanceCommand {
  name: MaintenanceCommandName;
  /** 子命令（缺省为空串 —— 由 handler 打印帮助并以非零退出） */
  subcommand: string;
  /** 子命令之后的参数（已剔除启动器内部旗标） */
  args: string[];
}

/** 启动器内部旗标：不属于维护命令语义，识别时剔除 */
const INTERNAL_FLAGS = new Set(['--legacy-repl', '--no-legacy-repl']);

const MAINTENANCE_COMMANDS: readonly MaintenanceCommandName[] = [
  'prompt',
  'pairing',
];

/**
 * 从 argv（已剔除 `--project-dir`）识别维护命令；非维护命令返回 `null`。
 */
export function parseMaintenanceCommand(
  argv: readonly string[]
): MaintenanceCommand | null {
  const tokens = argv.filter((arg) => !INTERNAL_FLAGS.has(arg));
  const name = tokens[0];
  if (!name || !(MAINTENANCE_COMMANDS as readonly string[]).includes(name)) {
    return null;
  }
  return {
    name: name as MaintenanceCommandName,
    subcommand: tokens[1] ?? '',
    args: tokens.slice(2),
  };
}

/**
 * 执行维护命令，返回**显式退出码**（0 成功 / 1 未识别子命令或业务失败）。
 * 动态导入 handler：避免把维护面拉进正常启动路径。
 */
export async function runMaintenanceCommand(
  command: MaintenanceCommand
): Promise<number> {
  if (command.name === 'pairing') {
    const { createPairingHandler } = await import('./handlers/pairingHandler');
    const handler = createPairingHandler();
    const handled = await handler.handle(command.subcommand, command.args);
    if (!handled) {
      handler.showHelp();
      return 1;
    }
    return 0;
  }

  const { createPromptHandler } = await import('./handlers/promptHandler');
  const handler = createPromptHandler();
  const handled = await handler.handle(command.subcommand, command.args);
  if (!handled) {
    handler.showHelp();
    return 1;
  }
  return 0;
}
