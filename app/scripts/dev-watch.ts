// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * dev-watch —— `bun run dev*` 的**根目录 watch 启动器**（2026-11-20）
 *
 * ## 为什么需要
 * `bun --watch` 的 watch 根 = **启动时的 cwd**。`app/package.json` 的脚本以 `app/` 为 cwd 启动，
 * 而物理拆包后的模块在 `packages/<pkg>/src`（与 `app/` 平级）⇒ 启动即刷屏
 * `warn: File .../packages/... is not in the project directory and will not be watched`，
 * 且改 `packages/**` **不触发热重载**（运行时 `main()` 才 chdir 到仓库根，回补不了 watch 范围）。
 *
 * 实测对照（2026-11-20，本机）：从 `app/` 启动 **1340 条**越界警告；改从仓库根启动 **0 条**，
 * 应用照常启动（`/v1/sessions` 200）。
 *
 * ## 用法
 *   bun run scripts/dev-watch.ts                       # 等价旧 `bun run --watch src/main.ts`
 *   bun run scripts/dev-watch.ts --feature=DROP_CHANNELS_ALL   # 白名单内的 bun 开关放在 entry 之前
 *   bun run scripts/dev-watch.ts daemon --http-port 18990     # 其余参数原样透传给应用
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根 = `app/scripts/` 上两级 */
const REPO_ROOT = resolve(HERE, '..', '..');

const argv = process.argv.slice(2).filter((a) => a !== '--');
/**
 * bun 自身开关的白名单前缀（须放在 entry **之前**）；其余参数原样透传给应用。
 *
 * 为什么不用 `--` 分隔：`bun <script> -- a b` 时 bun 会**吞掉** `--`，脚本收到的是 `['a','b']`
 * ⇒ 无法区分"bun 开关"与"应用参数"（2026-11-20 实测踩中：`daemon` 被当成 bun 脚本名 ⇒
 * `error: Script not found "daemon"`）。
 */
const BUN_FLAG_PREFIXES = ['--feature=', '--hot', '--no-clear-screen'];
const bunFlags = argv.filter((a) => BUN_FLAG_PREFIXES.some((p) => a.startsWith(p)));
const appArgs = argv.filter((a) => !bunFlags.includes(a));

const child = spawn(
  'bun',
  [
    '--watch',
    `--cwd=${REPO_ROOT}`,
    ...bunFlags,
    'app/src/main.ts',
    ...appArgs,
  ],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // Windows 下 bun 为 `.exe`，无需 shell；POSIX 同理
    shell: false,
  }
);

const forward = (signal: NodeJS.Signals): void => {
  try {
    child.kill(signal);
  } catch {
    // @ignore-catch 子进程已退出（竞态）⇒ 无需处理
  }
};
process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('exit', (code, signal) => {
  // 被信号终止 ⇒ 以 0 退出，避免"用户 Ctrl+C"被当成失败
  process.exit(signal ? 0 : (code ?? 0));
});
