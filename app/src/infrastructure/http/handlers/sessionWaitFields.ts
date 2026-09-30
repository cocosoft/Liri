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
 * sessionWaitFields — 会话"等待态"只读字段构造（等待态可见性，2026-09-27）
 *
 * Spec：`.trae/specs/wait-state-visibility.md`（D1/D3）。
 *
 * 背景：`sleep_for` / `sleep_until` / `wake_on_job` / `wake_on_event` 登记的长等待
 * **不进 `YieldRegistry`**（`ChatManager` 只对 `sessions_yield` 写 `finishReason='yielded'`），
 * 故 `deriveYieldState` 在这些等待期间返回 `undefined` ⇒ 前端没有任何"仍在等"的依据，
 * 界面看起来"答完了"。本模块把该事实（`WakeStore` 是唯一事实源）以只读字段暴露给
 * `GET /v1/sessions/{id}/streaming`。
 */
// C1（2026-09-30 D-104，`tasks` 域 P4）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { handleError } from '@modules/error';

/** `pendingWake` 响应字段（多条待触发时取 `triggerAt` 最早的一条） */
export interface PendingWakeField {
  kind: string;
  /** 仅 `kind='timer'`（`sleep_for` / `sleep_until`）才有：Unix ms */
  triggerAt?: number;
  createdAt: number;
}

/**
 * 取本会话**最早一条**待触发唤醒（只读；`undefined` = 无）。
 *
 * 成本 = 读该会话 1 个 JSON 文件（`WakeStore.load`）。
 * CG3 未启动或读取异常 ⇒ 返回 `undefined`（省略字段，不阻断主响应；异常仍上报 ErrorTracker）。
 */
export async function resolvePendingWake(
  sessionId: string
): Promise<PendingWakeField | undefined> {
  try {
    const pending = await (
      await getCoreAPI().getTaskOpsPort()
    ).listPendingWakes(sessionId);
    // CG3 未启动 ⇒ `null`（等价于改动前 `if (!selfWake) return undefined`）
    if (!pending) return undefined;
    const first = pending[0];
    if (!first) return undefined;
    return {
      kind: first.kind,
      ...(typeof first.triggerAt === 'number'
        ? { triggerAt: first.triggerAt }
        : {}),
      createdAt: first.createdAt,
    };
  } catch (err) {
    await handleError(err, {
      module: 'infra:http',
      action: 'session_streaming_status:pendingWake',
    });
    return undefined;
  }
}
