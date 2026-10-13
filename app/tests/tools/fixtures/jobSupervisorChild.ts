/**
 * T1-2② C₁ —— **子进程 oracle**（`.trae/specs/sidecar-async-suspend.md` §8，2026-10-13）。
 *
 * **为什么需要子进程**：见 `tests/tools/sidecarJobE2E.test.ts` 顶部取证注记 —— 「`bun test` × 主管」
 * 组合下**异步完成通知未被兑现**（2×2 矩阵：同一主管 + 同一夹具在**纯脚本**下 3/3 正常、
 * `bun test` 内**裸 spawn** 亦正常 ⇒ 失败仅在「运行器 × 主管」组合，机制未解释、**非产品接线**）。
 *
 * 本夹具与既有 `tests/execution/fixtures/executionCrashChild.ts` **同法**：由父测试
 * `spawnSync(process.execPath, …)` 拉起，在其中用**真实主管**（`ToolSidecarSupervisor`）
 * + **真实侧车**（`fakeJobSidecar.js`）跑一遍，把**事实**以**单行 JSON**（前缀 `ORACLE_RESULT `）
 * 打到 stdout，供父进程断言 ⇒ 产品路径（真实主管 / 真实子进程 / 真实分帧）被**真跑**。
 *
 * **代价（如实）**：断言发生在子进程，父进程核对的是**投影结果**（结果行 + 退出码）；
 * 故本脚本**只报事实**（耗时 / 在飞数 / 结果 / 错误），**判定一律交父进程**。
 *
 * 用法：`bun tests/tools/fixtures/jobSupervisorChild.ts <single-ok|single-fail>`
 */
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor.js';

const SIDE_CAR = resolve(import.meta.dir, 'fakeJobSidecar.js');
const PREFIX = 'ORACLE_RESULT ';

async function main(): Promise<void> {
  const scenario = process.argv[2] ?? 'single-ok';
  const isFail = scenario === 'single-fail';
  const facts: Record<string, unknown> = { scenario };
  let fatal: string | null = null;

  const sup = new ToolSidecarSupervisor({
    scriptPath: SIDE_CAR,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 3_000,
    // 兜底给足 4s：若走**超时兜底**，`elapsedMs` 会 ≈ 4s
    // ⇒ 父进程用 `< 1000ms` 断言即可把「真实兑现」与「超时兜底」在**证据层**区分（不靠猜）
    jobTimeoutMs: 4_000,
    maxRestarts: 0,
  });

  try {
    const t0 = Date.now();
    await sup.start();
    facts.startupMs = Date.now() - t0;

    // **提交即返**：`submitMs` 只计提交本身，不含完成等待
    const t1 = Date.now();
    const { jobId, completion } = await sup.submitJob(
      isFail ? 'fail' : 'slow',
      isFail ? undefined : { delayMs: 30 }
    );
    facts.submitMs = Date.now() - t1;
    facts.jobId = jobId;
    facts.pendingAfterSubmit = sup.pendingJobCount;

    const t2 = Date.now();
    try {
      facts.result = await completion;
      facts.error = null;
    } catch (e) {
      facts.error = e instanceof Error ? e.message : String(e);
    }
    facts.elapsedMs = Date.now() - t2;
    facts.pendingAfter = sup.pendingJobCount;
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      sup.stop();
    } catch {
      // @ignore-catch — 停止失败不影响投影（夹具进程随父进程退出）
    }
  }

  // 与 `fakeJobSidecar.js` 同法：**同步写 fd 1**（不经 stdout 缓冲）⇒ 结果行必须到达父进程
  writeSync(1, PREFIX + JSON.stringify({ facts, fatal }) + '\n');
  if (fatal) process.exitCode = 1;
}

void main();
