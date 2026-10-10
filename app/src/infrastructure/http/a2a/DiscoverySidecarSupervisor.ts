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
 * A2A 发现面 sidecar **监督器**（① P2，2026-10-10）。
 *
 * 方案：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P2）。
 *
 * 职责：按开关拉起 `discoverySidecar.ts`（独立进程），完成 **P1 契约**的**就绪握手**
 * （读 `startup` 帧，含实际端口）、推送卡片快照、心跳看护、崩溃**有界重启**、干净停止。
 *
 * 开关：`A2A_DISCOVERY_SIDECAR==='true'`（**默认 false** ⇒ 零行为变更，发现面仍由主进程路由提供）。
 * 回滚：关闭开关（或 `stop()`）即回到主进程路由。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
  decodeFrame,
  isCompatibleVersion,
  isHeartbeatFrame,
} from '@modules/utils/sidecarIpc';
import type { A2ADiscoverySnapshot } from './discoverySurface';

const logger = getLogger('infra:http:a2a:discoverySupervisor');

/** 开关：是否由主进程监督一个独立的发现面 sidecar（默认关） */
export const ENV_DISCOVERY_SIDECAR = 'A2A_DISCOVERY_SIDECAR';

export function isDiscoverySidecarEnabled(): boolean {
  return configManager.env(ENV_DISCOVERY_SIDECAR) === 'true';
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>
) => ChildProcess;

export interface SupervisorDeps {
  /** spawn 注入（测试用；缺省 `node:child_process.spawn`） */
  spawnFn?: SpawnFn;
  /** sidecar 脚本路径（缺省本模块同级 `discoverySidecar.ts`） */
  scriptPath?: string;
  /** 运行时（缺省 `process.execPath`，即 Bun/Node 自身） */
  runtimePath?: string;
  startupTimeoutMs?: number;
  /** 有界重启上限（默认 3） */
  maxRestarts?: number;
  /**
   * ① P3（2026-10-10）：**委派执行器**（跑在**主进程内核**）。sidecar 收到
   * `POST /v1/a2a/tasks` 后经 IPC 回调用它 ⇒ sidecar **不**自建 CoreAPI。
   * 未注入 ⇒ 反向请求回 `success:false`（如实"未就绪"）。
   */
  delegate?: (
    message: string,
    agentId: string | undefined,
    waitMs?: number
  ) => Promise<{ completed: boolean; task: unknown }>;
}

/** 发现面 sidecar 的单例监督器 */
export class DiscoverySidecarSupervisor {
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private stopping = false;
  private restarts = 0;
  private lastSnapshot: A2ADiscoverySnapshot | null = null;
  private readonly deps: SupervisorDeps;

  constructor(deps: SupervisorDeps = {}) {
    this.deps = deps;
  }

  /** 当前 sidecar 端口（未就绪 ⇒ null） */
  getPort(): number | null {
    return this.port;
  }

  /** 拉起 sidecar 并等待**就绪握手**（P1 契约）；失败/超时 ⇒ 抛错（调用方回退主进程路由） */
  async start(): Promise<number> {
    if (this.child) return this.port ?? 0;
    this.stopping = false;
    const runtime = this.deps.runtimePath ?? process.execPath;
    const script =
      this.deps.scriptPath ??
      fileURLToPath(new URL('./discoverySidecar.ts', import.meta.url));
    const spawnFn = this.deps.spawnFn ?? spawn;
    const child = spawnFn(runtime, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.child = child;

    const timeoutMs = this.deps.startupTimeoutMs ?? 10_000;
    const port = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('A2A 发现面 sidecar 就绪超时'));
      }, timeoutMs);
      const rl = readline.createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        const frame = decodeFrame(line);
        if (!frame) return;
        if (frame.type === SIDECAR_STARTUP_TYPE && !settled) {
          if (!isCompatibleVersion(frame.protocolVersion)) {
            settled = true;
            clearTimeout(timer);
            reject(
              new Error(
                `sidecar 协议版本不兼容：${String(frame.protocolVersion)} vs ${SIDECAR_IPC_PROTOCOL_VERSION}`
              )
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(typeof frame.port === 'number' ? frame.port : 0);
          return;
        }
        this.handleChildFrame(frame);
      });
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });

    this.port = port;
    child.on('exit', (code) => this.onExit(code));
    // 就绪后立即推送最近快照（重启场景）
    if (this.lastSnapshot) this.pushSnapshot(this.lastSnapshot);
    logger.info('A2A 发现面 sidecar 已就绪', { port });
    return port;
  }

  /** 推送只读快照（卡片 / etag / delegatorReady） */
  pushSnapshot(snapshot: A2ADiscoverySnapshot): void {
    this.lastSnapshot = snapshot;
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(
      encodeFrame({ type: 'notify', event: 'snapshot', data: snapshot })
    );
  }

  /** 子进程帧分派（就绪后由同一 readline 监听器调用） */
  private handleChildFrame(frame: Record<string, unknown>): void {
    if (isHeartbeatFrame(frame)) return;
    // ① P3：反向 RPC（sidecar → 主进程）——委派执行
    if (typeof frame.id === 'string' && frame.method === 'a2a.delegate') {
      void this.handleDelegateRequest(
        frame.id,
        (frame.params ?? {}) as Record<string, unknown>
      );
    }
  }

  /** 处理 sidecar 的委派请求：在**主进程内核**执行并回帧 */
  private async handleDelegateRequest(
    id: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const message = typeof params.message === 'string' ? params.message : '';
    const agentId =
      typeof params.agentId === 'string' ? params.agentId : undefined;
    const waitMs =
      typeof params.waitMs === 'number' ? params.waitMs : undefined;
    let out: Record<string, unknown>;
    try {
      if (!this.deps.delegate) throw new Error('委派执行器未注入');
      if (!message) throw new Error('message 必填且不能为空');
      const result = await this.deps.delegate(message, agentId, waitMs);
      out = { id, success: true, result };
    } catch (err) {
      out = {
        id,
        success: false,
        error: { code: 'DELEGATE_FAILED', message: String(err) },
      };
    }
    if (this.child?.stdin?.writable) this.child.stdin.write(encodeFrame(out));
  }

  /** 停止 sidecar（清理子进程；不再重启） */
  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      // @ignore-catch — 进程可能已退出
    }
  }

  private onExit(code: number | null): void {
    this.port = null;
    this.child = null;
    if (this.stopping) return;
    const maxRestarts = this.deps.maxRestarts ?? 3;
    if (this.restarts >= maxRestarts) {
      logger.warn('A2A 发现面 sidecar 反复退出 ⇒ 停止重启（回退主进程路由）', {
        code,
        restarts: this.restarts,
      });
      return;
    }
    this.restarts += 1;
    logger.warn('A2A 发现面 sidecar 意外退出 ⇒ 重启', {
      code,
      attempt: this.restarts,
    });
    void this.start().catch((err: unknown) => {
      logger.warn('A2A 发现面 sidecar 重启失败', { error: String(err) });
    });
  }
}
