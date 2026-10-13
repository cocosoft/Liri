// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 工具侧车 **监督器**（S1 骨架，Tool Sidecar Isolation）。
 *
 * 方案：`.trae/specs/tool-sidecar-isolation.md` §3-D4/D5 + §11 切片 `S1`。
 *
 * 职责：按开关拉起**独立工具侧车进程**（缺省 `./lspSidecar.ts`），完成 **P1 契约**
 * （`@modules/utils/sidecarIpc`）的**就绪握手**（读 `startup` 帧，含 `protocolVersion` / `pid`）、
 * `request/response` 分帧、心跳看护、崩溃**有界重启**与干净停止。
 *
 * **选型（如实）**：**新写**（而非复用 `daemon/ProcessManager`）—— 理由：① 复用既有
 * `DiscoverySidecarSupervisor` 的**进程形态**（`spawnFn` 可注入 ⇒ 单测不真 spawn；`maxRestarts`
 * 有界重启；`stop()`），且它是本仓**唯一**的 sidecar 监督器模板（CS01 单一来源）；② `daemon/ProcessManager`
 * 面向**守护进程控制面**（unix socket/http 生命周期），与本契约"stdio + 换行 JSON"选型不同，**不并入**
 * （对齐 D10 §8.5）。
 *
 * 崩溃隔离（D5）：侧车退出/僵死 ⇒ ① 所有在飞请求（`pending`）**全部 reject**（主进程收普通错误、**不倒**）；
 * ② 有界重启（`maxRestarts` 默认 3），超限 **fail-closed 停止重启**（不伪造成功，CS03）。
 * 崩溃的请求**不自动重试**（避免重复执行副作用）—— 仅重启进程，不重放 pending。
 *
 * 取消下传（D5/T3.2）：`request(..., signal)` 中止 ⇒ ① **本地结算**该 pending（明确"已取消"错误）；
 * ② 经 `notify` 帧下传 `{type:'notify', event:'cancel', data:{id}}` 给侧车（best-effort）。
 * 开关：`TOOL_SIDECAR_LSP`（默认关 ⇒ 本类**根本不被启动**，见 `toolSidecarLifecycle.ts`）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getLogger } from '@modules/monitoring';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_JOB_SUBMIT_METHOD,
  SIDECAR_STARTUP_TYPE,
  buildJobSubmit,
  encodeFrame,
  decodeFrame,
  isCompatibleVersion,
  isHeartbeatFrame,
} from '@modules/utils/sidecarIpc';
// T1-2② / B₂（2026-10-13）：异步作业登记表（宿主侧；协议常量仍取自唯一基座 `utils/sidecarIpc`）
import { SidecarJobRegistry } from './sidecarJobs.js';

const logger = getLogger('tools:sidecar:supervisor');

export interface ToolSidecarDeps {
  /**
   * spawn 注入（测试用；缺省 `node:child_process.spawn`）。
   *
   * ⚠️ 内联签名（**不新增**导出类型别名）：与 `DiscoverySidecarSupervisor` 同形态，
   * 但避免 R02-002「同一类型名多模块定义」（`utils/spawnPort.ts` 的 `SpawnFn = typeof nodeSpawn`
   * 含重载，不适用于本可注入端口的窄签名，故各自内联）。
   */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>
  ) => ChildProcess;
  /** 侧车脚本路径（缺省本模块同级 `lspSidecar.ts`） */
  scriptPath?: string;
  /** 运行时（缺省 `process.execPath`，即 Bun/Node 自身） */
  runtimePath?: string;
  /** 就绪握手超时（默认 10s） */
  startupTimeoutMs?: number;
  /** 有界重启上限（默认 3） */
  maxRestarts?: number;
  /** 请求超时（默认 30s，对齐 `tools/lsp` 的 LSP 请求超时口径） */
  requestTimeoutMs?: number;
  /**
   * T1-2② / B₂（2026-10-13）：异步作业**完成**超时兜底（默认 10 分钟）。
   * 到期 ⇒ 该作业 `completion` reject（**绝不永久悬挂**）。
   */
  jobTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (frame: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 清理副作用（如移除 abort 监听）；结算时必调 */
  cleanup?: () => void;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (reason: Error) => void;
}

/** 工具侧车监督器（缺省监督常驻 LSP 侧车） */
export class ToolSidecarSupervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private ready = false;
  private restarts = 0;
  private seq = 0;
  /** 持久降级态（有界重启超限）：后续请求 fail-closed，不再等待 */
  private fatal: Error | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  /** T1-2② / B₂（2026-10-13）：侧车**异步作业**登记表（`job.submit` ↔ `job.completed`） */
  private readonly jobs = new SidecarJobRegistry();
  private readonly readyWaiters: ReadyWaiter[] = [];
  private readonly deps: ToolSidecarDeps;

  constructor(deps: ToolSidecarDeps = {}) {
    this.deps = deps;
  }

  /** 侧车是否就绪（已握手且进程在） */
  isRunning(): boolean {
    return this.child !== null && this.ready;
  }

  /** 已发生的重启次数（观测/测试用） */
  getRestarts(): number {
    return this.restarts;
  }

  /** 拉起侧车并等待**就绪握手**（P1 契约）；失败/超时/版本不兼容 ⇒ 抛错（调用方 fail-closed） */
  async start(): Promise<{ pid?: number }> {
    if (this.child) return { pid: this.child.pid };
    this.stopping = false;
    const runtime = this.deps.runtimePath ?? process.execPath;
    const script =
      this.deps.scriptPath ??
      fileURLToPath(new URL('./lspSidecar.ts', import.meta.url));
    const spawnFn = this.deps.spawnFn ?? spawn;
    const child = spawnFn(runtime, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child = child;

    const timeoutMs = this.deps.startupTimeoutMs ?? 10_000;
    const pid = await new Promise<number | undefined>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('工具侧车就绪超时'));
      }, timeoutMs);
      const rl = readline.createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        const frame = decodeFrame(line);
        if (!frame) return;
        if (frame.type === SIDECAR_STARTUP_TYPE) {
          if (settled) return;
          if (!isCompatibleVersion(frame.protocolVersion)) {
            settled = true;
            clearTimeout(timer);
            reject(
              new Error(
                `工具侧车协议版本不兼容：${String(frame.protocolVersion)} vs ${SIDECAR_IPC_PROTOCOL_VERSION}`
              )
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(typeof frame.pid === 'number' ? frame.pid : child.pid);
          return;
        }
        this.handleFrame(frame);
      });
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });

    this.ready = true;
    this.fatal = null;
    child.on('exit', (code) => this.onExit(code));
    this.flushReady();
    logger.info('工具侧车已就绪', { pid });
    return { pid };
  }

  /**
   * 发起一次请求（写 `request` 帧），等待匹配 id 的 `response` 帧（失败帧 ⇒ reject）。
   *
   * D5 取消下传（T3.2）：传入 `signal` ⇒ 中止时**本地结算**该 pending（明确错误）并经
   * `notify{cancel}` 帧**下传**侧车（best-effort；`data.id` 为本请求 id）。
   *
   * T3.1：崩溃后有界重启期间，请求**等待就绪**（不早写），超限降级 ⇒ fail-closed。
   */
  async request(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (!this.isRunning()) {
      await this.waitUntilReady(this.deps.startupTimeoutMs ?? 10_000);
    }
    const stdin = this.child?.stdin;
    if (!stdin?.writable) {
      throw new Error('工具侧车未就绪');
    }
    const id = `toolsidecar_${++this.seq}`;
    const timeoutMs = this.deps.requestTimeoutMs ?? 30_000;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(`工具侧车请求已取消：${method}`));
        return;
      }
      const timer = setTimeout(
        () =>
          this.settle(id, (p) =>
            p.reject(new Error(`工具侧车请求超时：${method}`))
          ),
        timeoutMs
      );
      const onAbort = (): void => {
        this.notify('cancel', { id }); // 取消下传帧（best-effort）
        this.settle(id, (p) =>
          p.reject(new Error(`工具侧车请求已取消：${method}`))
        );
      };
      const cleanup = signal
        ? () => signal.removeEventListener('abort', onAbort)
        : undefined;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { resolve, reject, timer, cleanup });
      stdin.write(encodeFrame({ id, method, params }));
    });
  }

  /** 单向推送（`notify` 帧；S3 取消下传复用：`event:'cancel'`） */
  notify(event: string, data?: unknown): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(encodeFrame({ type: 'notify', event, data }));
  }

  /**
   * T1-2② / B₂（2026-10-13）：**提交一次异步作业**（长耗时侧车工具"不得同步阻塞"的宿主侧入口）。
   *
   * 语义：立即返回 `{ jobId, completion }` —— `completion` 在侧车回推
   * `notify{event:'job.completed'}` 时结算，**超时兜底**（`deps.jobTimeoutMs`，缺省 10 分钟）
   * 或侧车崩溃（`rejectAllPending` 同口结算）时 reject ⇒ **绝不悬挂**。
   * 提交本身失败 ⇒ **本地结算**后抛出（不留悬挂 Promise）。
   */
  async submitJob(
    action: string,
    payload?: unknown,
    opts?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<{ jobId: string; completion: Promise<unknown> }> {
    const jobId = `job_${++this.seq}`;
    const timeoutMs = opts?.timeoutMs ?? this.deps.jobTimeoutMs ?? 600_000;
    const completion = this.jobs.register(jobId, timeoutMs, action);
    try {
      await this.request(
        SIDECAR_JOB_SUBMIT_METHOD,
        buildJobSubmit(jobId, action, payload) as unknown as Record<
          string,
          unknown
        >,
        opts?.signal
      );
    } catch (e) {
      this.jobs.fail(jobId, e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
    return { jobId, completion };
  }

  /** 在飞作业数（观测用；不阻塞） */
  get pendingJobCount(): number {
    return this.jobs.size;
  }

  /** 停止侧车（清理子进程；不再重启） */
  stop(): void {
    this.stopping = true;
    this.ready = false;
    const child = this.child;
    this.child = null;
    this.rejectAllPending(new Error('工具侧车已停止'));
    this.settleReady(new Error('工具侧车已停止'));
    if (!child) return;
    try {
      child.kill();
    } catch {
      // @ignore-catch — 进程可能已退出
    }
  }

  /** T3.1：等待侧车就绪（崩溃后有界重启期间）——超时 / 降级 ⇒ reject（fail-closed） */
  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.isRunning()) return Promise.resolve();
    if (this.fatal) return Promise.reject(this.fatal);
    return new Promise<void>((resolve, reject) => {
      const waiter: ReadyWaiter = { resolve: () => {}, reject: () => {} };
      const timer = setTimeout(() => {
        const i = this.readyWaiters.indexOf(waiter);
        if (i >= 0) this.readyWaiters.splice(i, 1);
        reject(new Error('工具侧车就绪超时'));
      }, timeoutMs);
      waiter.resolve = () => {
        clearTimeout(timer);
        resolve();
      };
      waiter.reject = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };
      this.readyWaiters.push(waiter);
      if (this.isRunning()) waiter.resolve(); // 竞态兜底
    });
  }

  private flushReady(): void {
    for (const w of this.readyWaiters.splice(0)) w.resolve();
  }

  private settleReady(reason: Error): void {
    for (const w of this.readyWaiters.splice(0)) w.reject(reason);
  }

  /** 子进程帧分派（就绪后由同一 readline 监听器调用） */
  private handleFrame(frame: Record<string, unknown>): void {
    if (isHeartbeatFrame(frame)) return;
    // T1-2② / B₂（2026-10-13）：**作业完成通知**（`notify{event:'job.completed'}`，**无 `id`**）
    // ⇒ 派发作业登记表。**必须在 `id` 校验之前**，否则该帧会被当作"无 id 帧"丢弃。
    // 非作业通知 ⇒ `false` ⇒ 落回原有分派（不改既有语义）。
    if (this.jobs.completeFromFrame(frame)) return;
    const id = frame.id;
    if (typeof id !== 'string') return;
    if (!this.pending.has(id)) return;
    if (frame.success === false) {
      const err = (frame.error ?? {}) as Record<string, unknown>;
      this.settle(id, (p) =>
        p.reject(new Error(String(err.message ?? '工具侧车请求失败')))
      );
      return;
    }
    this.settle(id, (p) => p.resolve(frame));
  }

  /** 统一结算：移除 pending + 清计时器 + 清副作用，再执行 resolve/reject */
  private settle(id: string, action: (p: PendingRequest) => void): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.cleanup?.();
    action(pending);
  }

  /** D5：所有在飞请求**全部结算**（reject）—— 崩溃/停止路径统一入口 */
  private rejectAllPending(reason: Error): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id, (p) => p.reject(reason));
    }
    // T1-2② / B₂（2026-10-13）：在飞**作业**同口结算（同因同果 ⇒ 一条原因、两本账都不悬挂）
    this.jobs.rejectAll(reason);
  }

  private onExit(code: number | null): void {
    this.ready = false;
    this.child = null;
    // D5：侧车崩溃 ⇒ pending 全部 reject（主内核收到普通错误，主进程存活）
    this.rejectAllPending(new Error(`工具侧车已退出（code=${String(code)}）`));
    if (this.stopping) return;
    const maxRestarts = this.deps.maxRestarts ?? 3;
    if (this.restarts >= maxRestarts) {
      this.fatal = new Error('工具侧车不可用（重启超限，fail-closed）');
      this.settleReady(this.fatal);
      logger.warn('工具侧车反复退出 ⇒ 停止重启（fail-closed）', {
        code,
        restarts: this.restarts,
      });
      return;
    }
    this.restarts += 1;
    logger.warn('工具侧车意外退出 ⇒ 重启', {
      code,
      attempt: this.restarts,
    });
    // 崩溃的请求**不自动重试**（避免重复执行副作用）：仅重启进程，不重放 pending
    void this.start().catch((err: unknown) => {
      logger.warn('工具侧车重启失败', { error: String(err) });
      this.settleReady(new Error(`工具侧车重启失败：${String(err)}`));
    });
  }
}
