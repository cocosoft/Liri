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
 * Sidecar / 子进程 IPC —— **单一契约**（① P1，2026-10-10）。
 *
 * 方案：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P1）——
 * "单一 sidecar IPC 契约（类型 + 版本 + 就绪握手 + 心跳）……复用 `ai/python/JsonRpcBridge`，
 * **禁止第三套**"。
 *
 * 选型（如实）：**stdio + 换行分隔 JSON**（与既有 `JsonRpcBridge` 同口径）——跨平台稳定
 * （Windows 无 unix socket）；`daemon/IPCService`（http/unix）属**守护进程控制面**，非本契约。
 *
 * 本模块是仓内**唯一**的 sidecar IPC 分帧 / 版本 / 握手 / 心跳定义（CS01）；`JsonRpcBridge`
 * 已收敛消费它（分帧 + `BRIDGE_PROTOCOL_VERSION`）。P2/P3 的 sidecar 进程将复用同一契约。
 */

/** 协议版本（single source；major 相等即兼容） */
export const SIDECAR_IPC_PROTOCOL_VERSION = 1;

/** 帧类型（闭合集合） */
export type SidecarFrameType =
  | 'request'
  | 'response'
  | 'notify'
  | 'startup'
  | 'heartbeat';

/** 就绪握手帧（子进程 → 主进程；`protocolVersion` 缺省视为 legacy 兼容） */
export interface SidecarStartupFrame {
  type: 'startup';
  pid?: number;
  protocolVersion?: number;
}

/** 心跳帧（双向；`at` = 发送时刻毫秒） */
export interface SidecarHeartbeatFrame {
  type: 'heartbeat';
  at?: number;
}

/** 通知帧（无 id 单向推送） */
export interface SidecarNotifyFrame {
  type: 'notify';
  event?: string;
  data?: unknown;
  [key: string]: unknown;
}

export const SIDECAR_STARTUP_TYPE = 'startup' as const;
export const SIDECAR_HEARTBEAT_TYPE = 'heartbeat' as const;

/** 单行分帧（换行分隔，无粘包）——**唯一的编码入口** */
export function encodeFrame(frame: Record<string, unknown>): string {
  return JSON.stringify(frame) + '\n';
}

/** 解码一行；非 JSON / 非对象（如子进程调试输出）⇒ `null`（调用方忽略该行） */
export function decodeFrame(line: string): Record<string, unknown> | null {
  if (!line || !line.trim()) return null;
  try {
    const v: unknown = JSON.parse(line);
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 版本兼容判定：**未声明**（legacy worker）⇒ 兼容；已声明 ⇒ 要求 **major 相等**。
 * （对齐 `PythonPluginAdapter` 的应用层校验，并下沉到契约层。）
 */
export function isCompatibleVersion(remote?: unknown): boolean {
  if (typeof remote !== 'number' || !Number.isFinite(remote)) return true;
  return Math.floor(remote) === Math.floor(SIDECAR_IPC_PROTOCOL_VERSION);
}

export function isStartupFrame(frame: Record<string, unknown>): boolean {
  return frame.type === SIDECAR_STARTUP_TYPE;
}

export function isHeartbeatFrame(frame: Record<string, unknown>): boolean {
  return frame.type === SIDECAR_HEARTBEAT_TYPE;
}

/** 构造心跳帧 */
export function buildHeartbeat(
  now: number = Date.now()
): SidecarHeartbeatFrame {
  return { type: SIDECAR_HEARTBEAT_TYPE, at: now };
}

// ─── 侧车「作业化」协议（T1-2② / TG-2+TG-6 · B 片，2026-10-13）───────────────
//
// 目标（`工具治理方案-20261012.md` 阶段 1.2 ②）：「长耗时侧车工具**不得同步阻塞** ——
// 提交后须能向内核投影 `SUSPENDED`，完成后通知解冻续跑」。
//
// **零新帧型（关键选型）**：复用本文件**既有**三类帧 ——
// - **提交** = `request`（`method = SIDECAR_JOB_SUBMIT_METHOD`）→ 对端回 `response`（`{ jobId }`）；
// - **完成** = 侧车 → 宿主 **`notify`**（`event = SIDECAR_JOB_COMPLETED_EVENT`）。
// ⇒ 不新增帧类型、不新增传输、**不建第三套 IPC**（D10 GR02）。
// 本层只定义**协议常量 + 载荷形状 + 纯构造/解析**；主管接线（notify → 作业完成处理器）见 B₂ 片。

/** 作业提交方法名（`request.method`；宿主 → 侧车） */
export const SIDECAR_JOB_SUBMIT_METHOD = 'job.submit' as const;

/** 作业完成事件名（`notify.event`；侧车 → 宿主） */
export const SIDECAR_JOB_COMPLETED_EVENT = 'job.completed' as const;

/** 作业提交参数（宿主 → 侧车；`params` 形状由具体 worker 约定，此处只承载**不透明**负载） */
export interface SidecarJobSubmitParams {
  /** 作业标识（宿主生成；用于完成通知回关联） */
  jobId: string;
  /** 具体动作（worker 内方法名） */
  action: string;
  /** 动作参数（**不透明**：本层不解释，原样透传） */
  payload?: unknown;
}

/** 作业完成通知载荷（侧车 → 宿主） */
export interface SidecarJobCompletedPayload {
  /** 与提交时的 `jobId` 回关联 */
  jobId: string;
  /** 成功与否（**必填**：成功/失败均须通知，避免宿主永久挂起） */
  ok: boolean;
  /** 成功时的结果（**不透明**；失败时省略） */
  result?: unknown;
  /** 失败时的原因（**仅文本**；成功时省略） */
  error?: string;
}

/** 构造作业提交参数（纯函数） */
export function buildJobSubmit(
  jobId: string,
  action: string,
  payload?: unknown
): SidecarJobSubmitParams {
  return payload === undefined ? { jobId, action } : { jobId, action, payload };
}

/** 构造作业完成**通知帧**（worker 侧使用；纯函数） */
export function buildJobCompleted(
  payload: SidecarJobCompletedPayload
): SidecarNotifyFrame {
  return {
    type: 'notify',
    event: SIDECAR_JOB_COMPLETED_EVENT,
    data: payload,
  };
}

/**
 * 解析「作业完成」通知帧（纯函数）。
 *
 * 非 notify / 事件名不符 / `data` 非对象 / 缺 `jobId` / **`ok` 非布尔** ⇒ `null`
 * （**不臆造**：无法判定成败的通知一律丢弃，交由超时兜底，而不是猜成功）。
 */
export function parseJobCompleted(
  frame: Record<string, unknown> | null | undefined
): SidecarJobCompletedPayload | null {
  if (!frame || frame.type !== 'notify') return null;
  if (frame.event !== SIDECAR_JOB_COMPLETED_EVENT) return null;
  const data = frame.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.jobId !== 'string' || d.jobId.length === 0) return null;
  if (typeof d.ok !== 'boolean') return null;
  const out: SidecarJobCompletedPayload = { jobId: d.jobId, ok: d.ok };
  if (d.ok && 'result' in d) out.result = d.result;
  if (!d.ok && typeof d.error === 'string') out.error = d.error;
  return out;
}
