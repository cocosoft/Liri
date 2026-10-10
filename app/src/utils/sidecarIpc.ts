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
