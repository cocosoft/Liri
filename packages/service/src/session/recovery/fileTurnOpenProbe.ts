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
 * 崩溃恢复的**默认轮次探针**：直接读该会话 `events.jsonl` 尾部，判定"最后一轮是否未闭合"。
 *
 * 2026-11-25（真机 `sess-goal-start-1794938528619` / `session_mwpj4amge75a67ec4f`）：
 * 此前探针只由 `ChatManager` 注入，`SessionsTool` / `CombinedSessionGateway` / CLI /
 * `init.ts` 各自 `new SessionGateway()` 的实例仍走旧口径（ACTIVE + 空闲即判定"上次崩溃时
 * 这轮还在跑"）⇒ 这些实例一初始化就把**轮次早已闭合**的会话标成 `failed_stale` /
 * `recovered_paused`（实测把人工复位的会话又标回 ERROR）。
 *
 * 口径与 `readTurnTailFromLog` 同一实现（合成 closer 视为未闭合）；事件日志缺失
 * （分区不同 / 已清理）⇒ `tailSeq=0` ⇒ 判"已闭合" ⇒ **不**产出假失败徽标。
 */
import path from 'path';

import { resolveSessionsDir } from '@openliri/infra/environment';

import { EventLogStorage } from '../storage/EventLogStorage';
import { readTurnTailFromLog } from './turnTail';

export interface FileTurnOpenProbeOptions {
  /** 分区根（`<sessions>/<worktreeHash>` 的父目录） */
  sessionsRoot: string;
  /** 分区键（`<sessions>/<worktreeHash>` 的末段） */
  worktreeHash: string;
}

/**
 * 网关构造期用：由 `storageConfig.basePath`（`<sessions>/<worktreeHash>`）派生探针分区；
 * 未配置时回退 `resolveSessionsDir()`（同样含 hash 段）。
 *
 * 2026-11-25（真机 `sess-goal-start-1794938528619` / `session_mwpj4amge75a67ec4f`）：
 * 此前探针只由 `ChatManager` 注入，`SessionsTool` / `CombinedSessionGateway` / CLI /
 * `init.ts` 的网关实例仍走旧口径 ⇒ 把轮次早已闭合的会话标成 `failed_stale` /
 * `recovered_paused`（实测把人工复位的会话又标回 ERROR）。
 */
export function createGatewayTurnOpenProbe(
  configuredBasePath?: string
): (sessionId: string) => Promise<boolean> {
  const sessionsDir = configuredBasePath?.trim() || resolveSessionsDir();
  return createFileTurnOpenProbe({
    sessionsRoot: path.dirname(sessionsDir),
    worktreeHash: path.basename(sessionsDir),
  });
}

/**
 * 构造探针（每个实例内部按 sessionId 缓存事件日志实例：一次恢复扫描会重复询问同一会话）。
 */
export function createFileTurnOpenProbe(
  options: FileTurnOpenProbeOptions
): (sessionId: string) => Promise<boolean> {
  const logs = new Map<string, EventLogStorage>();
  return async (sessionId: string) => {
    let log = logs.get(sessionId);
    if (!log) {
      log = new EventLogStorage(
        sessionId,
        options.worktreeHash,
        options.sessionsRoot
      );
      logs.set(sessionId, log);
    }
    return (await readTurnTailFromLog(log)).open;
  };
}
