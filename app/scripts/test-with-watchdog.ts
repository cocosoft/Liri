/**
 * 测试看门狗（P0-8③，2026-10-04）—— 为 `bun test` 增加"外层停滞即杀并重跑"兜底。
 *
 * **背景**：全量 `bun test` 偶发**测试级死锁**（输出冻结、零/低 CPU、无子进程、不失败也不退出）。
 * 已排除：并发 / 固定文件 / 资源累积 / WIP / 单目录 / `--smol`；上游 [bun #39709] 为**同症状类**
 * 但触发条件不同（该 issue 仅 `--isolate`、macOS；本仓 bunfig 仅 `preload`）。根因短期无法从业务代码消除
 * ⇒ 门禁加本兜底（详见 `dev_docs/error_repairs/预存错误与待处理问题.md` 的 P0-8 条目与 `debug-bun-test-hang.md`）。
 *
 * **策略**：
 * - **停滞检测**：连续 `TEST_STALL_MS`（默认 120s）无任何 stdout/stderr 输出 ⇒ 判卡死 → 杀**进程树** → 重跑；
 * - **单次总时长上限**：`TEST_ATTEMPT_TIMEOUT_MS`（默认 900s）到点即杀并重跑（防"极慢"永久阻塞）；
 * - **重跑上限**：`TEST_MAX_RETRIES`（默认 1）；用尽仍卡 ⇒ **非零退出并明确报错**（不静默放过）；
 * - **测试真实失败不重跑**：直接透传退出码，避免掩盖红灯。
 *
 * 用法：`bun run test:guarded`（可透传 `bun test` 参数，如 `bun run test:guarded --coverage`）。
 */
import { spawn, spawnSync } from 'child_process';

const STALL_MS = Number(process.env.TEST_STALL_MS ?? 120_000);
const ATTEMPT_TIMEOUT_MS = Number(
  process.env.TEST_ATTEMPT_TIMEOUT_MS ?? 900_000
);
const MAX_RETRIES = Number(process.env.TEST_MAX_RETRIES ?? 1);
const CHECK_INTERVAL_MS = 5_000;
const passthrough = process.argv.slice(2);

type AttemptResult = 'ok' | 'failed' | 'stalled';

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

/** 杀**整棵进程树**（bun test 会派生 worker；仅 kill 直接子进程不够） */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // @ignore-catch 进程组可能已消失；退化为单进程 kill
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // @ignore-catch 进程可能已退出
    }
  }
}

function runOnce(attempt: number, maxAttempts: number): Promise<AttemptResult> {
  return new Promise<AttemptResult>((resolve) => {
    const startedAt = Date.now();
    let lastOutputAt = Date.now();
    let settled = false;
    // 看门狗主动杀进程的标记：**Windows 的 taskkill 不置 `signal`**（退出码非 0）⇒ 不能只靠 signal 判定
    let killedByWatchdog = false;

    console.log(
      `[test-watchdog] attempt ${attempt}/${maxAttempts} start ${clock()} ` +
        `(stall=${STALL_MS}ms, attemptTimeout=${ATTEMPT_TIMEOUT_MS}ms)`
    );

    const child = spawn(process.execPath, ['test', ...passthrough], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const noteOutput = (): void => {
      lastOutputAt = Date.now();
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      noteOutput();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      noteOutput();
      process.stderr.write(chunk);
    });

    const timer = setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastOutputAt;
      if (idleFor >= STALL_MS && !killedByWatchdog) {
        killedByWatchdog = true;
        console.error(
          `\n[test-watchdog] ⏱ 连续 ${Math.round(idleFor / 1000)}s 无输出 ⇒ 判为卡死（P0-8③），杀进程树并重跑`
        );
        killTree(child.pid);
      } else if (now - startedAt >= ATTEMPT_TIMEOUT_MS && !killedByWatchdog) {
        killedByWatchdog = true;
        console.error(
          `\n[test-watchdog] ⏱ 单次运行超过 ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)}s ⇒ 超时，杀进程树并重跑`
        );
        killTree(child.pid);
      }
    }, CHECK_INTERVAL_MS);

    child.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      console.error(`[test-watchdog] 启动失败：${error.message}`);
      resolve('failed');
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (killedByWatchdog || signal !== null) {
        resolve('stalled');
        return;
      }
      resolve(code === 0 ? 'ok' : 'failed');
    });
  });
}

async function main(): Promise<void> {
  const maxAttempts = Math.max(1, MAX_RETRIES + 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runOnce(attempt, maxAttempts);
    if (result === 'ok') {
      console.log(`[test-watchdog] ✅ 通过（attempt ${attempt}）`);
      process.exit(0);
    }
    if (result === 'failed') {
      console.error(
        `[test-watchdog] ❌ 测试失败（attempt ${attempt}）—— 直接失败，不重跑（避免掩盖红灯）`
      );
      process.exit(1);
    }
    console.error(`[test-watchdog] ⚠️ attempt ${attempt} 卡死/超时`);
  }
  console.error(
    `[test-watchdog] ❌ ${maxAttempts} 次尝试均卡死/超时 ⇒ 非零退出（问题未消除，见 P0-8③）`
  );
  process.exit(1);
}

void main();
