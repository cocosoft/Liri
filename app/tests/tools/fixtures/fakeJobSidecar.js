#!/usr/bin/env node
/**
 * 作业型侧车**夹具**（T1-2② / TG-2+TG-6 · C₁ 片，2026-10-13）。
 *
 * 与既有 `tests/tools/fixtures/fakeLspServer.js` **同法**（真实子进程 + 换行分隔 JSON 帧），
 * 用于跨进程验证「**提交即返 → 完成回推**」链路（`job.submit` → `notify{job.completed}`）。
 *
 * 支持的动作（`params.action`）：
 * - `slow`  ⇒ 受理后 `payload.delayMs`（默认 10ms）回推 `ok=true`，`result={echo, n}`；
 * - `fail`  ⇒ 回推 `ok=false` + `error`；
 * - `never` ⇒ 只受理、**永不回推**（用于验证宿主侧**超时兜底**）。
 *
 * 协议版本 1（与 `utils/sidecarIpc.SIDECAR_IPC_PROTOCOL_VERSION` 一致）。
 */
const readline = require('node:readline');
const fs = require('node:fs');

const rl = readline.createInterface({ input: process.stdin });

/**
 * 输出一帧（**同步写 fd 1**）。
 *
 * ⚠️ 取证结论（2026-10-13）：在 bun + Windows 管道的组合下，`process.stdout.write` 若发生在
 * **定时器回调**（进程此刻空闲、无待处理 I/O）时会被**缓冲而不冲刷** ⇒ 宿主 readline 收不到
 * （实测：夹具 `notify` 已写、宿主仅收到 `startup`/`response` 两行，直至作业超时）。
 * 故夹具对**异步路径**输出一律用 `fs.writeSync(1, …)`（同步、不缓冲）⇒ 可确定性验证协议。
 */
function send(obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n');
}

// ① 就绪握手（宿主 `start()` 等待此帧）
send({ type: 'startup', pid: process.pid, protocolVersion: 1 });

let completed = 0;

rl.on('line', (line) => {
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return; // 非 JSON（调试输出等）⇒ 忽略
  }
  if (!frame || typeof frame !== 'object') return;

  // 宿主下传的单向通知（如取消下传）—— 夹具无需处理，仅确认不崩
  if (frame.type === 'notify') return;

  const { id, method, params } = frame;
  if (method !== 'job.submit') {
    send({
      id,
      success: false,
      error: { message: `unknown method: ${String(method)}` },
    });
    return;
  }

  // ② 受理（**提交即返**）：先回 response，再**异步**回推完成
  send({ id, success: true, result: { jobId: params.jobId, accepted: true } });

  const jobId = params.jobId;
  const action = params.action;
  if (action === 'never') return; // 永不回推 ⇒ 宿主侧超时兜底
  if (action === 'fail') {
    setTimeout(
      () =>
        send({
          type: 'notify',
          event: 'job.completed',
          data: { jobId, ok: false, error: 'fixture failure' },
        }),
      10
    );
    return;
  }
  const delayMs = Number((params.payload && params.payload.delayMs) || 10);
  setTimeout(
    () => {
      send({
        type: 'notify',
        event: 'job.completed',
        data: {
          jobId,
          ok: true,
          result: { echo: action, n: ++completed },
        },
      });
    },
    Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 10
  );
});
