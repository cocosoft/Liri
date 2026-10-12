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
 * session-continue-handler.ts — `POST /v1/sessions/:id/continue`（T3-12，2026-10-13）。
 *
 * **独立**「长程继续」入口：对 **guard** 挂起（熵门禁 `schema_entropy` / 轮上限 `turn_limit`）触发续跑，
 * 经协调器 `release` + **既有**续跑通道（`ChatManager.resumeSuspendedSession`）—— **不复用** relief
 * 放行通道（budget 挂起仍走日预算放行）。
 *
 * 归属：与 `daily-budget-handlers.ts` 同纪律 —— service 层经 `await import('@modules/query')` 动态
 * 取用 app 层协调器（避免 service → app 静态倒挂 R00-001）；续跑本体经 `getCoreAPI().chatManager`
 * 的 sanctioned `service → app` 缝触发。
 *
 * 语义（与 `POST /v1/sessions/:id/resume` 边界：后者按显式 `checkpoint_id` 重放流；本端点走协调器
 * 挂起登记 + 既有续跑通道）：
 *  - guard 挂起 + 续跑成功 ⇒ 200 `{ continued: true, chain }`；
 *  - 未挂起 / `GUARD_SUSPEND` 关 ⇒ 404；budget 挂起 ⇒ 409（拒绝，不成为 relief 旁路）；
 *  - 续跑失败 ⇒ 502（保留挂起）。
 */

import type http from 'http';
import { handleError } from '@modules/error';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import { json } from './handler-utils';

/** `ChatManager.resumeSuspendedSession` 的最小结构（避免 service → app 具名类型依赖） */
type ResumeFn = (
  sessionId: string,
  chain: 'stream' | 'taor'
) => Promise<boolean>;

export async function handleContinueSession(
  res: http.ServerResponse,
  sessionId: string
): Promise<void> {
  try {
    const { getBudgetSuspendCoordinator, continueSuspendedSession } =
      await import('@modules/query');

    const chatManager = getCoreAPI().chatManager as
      | { resumeSuspendedSession?: ResumeFn }
      | undefined;

    const outcome = await continueSuspendedSession(
      getBudgetSuspendCoordinator(),
      (sid, chain) => {
        const fn = chatManager?.resumeSuspendedSession;
        return fn ? fn(sid, chain) : Promise.resolve(false);
      },
      sessionId
    );

    if (outcome.ok) {
      json(res, 200, { continued: true, chain: outcome.chain });
      return;
    }

    const status =
      outcome.code === 'budget_kind'
        ? 409
        : outcome.code === 'resume_failed'
          ? 502
          : 404; // disabled / not_suspended
    json(res, status, {
      error: { code: outcome.code, message: outcome.message },
    });
  } catch (err) {
    await handleError(err, { module: 'http:session', action: 'continue' });
    if (!res.headersSent) {
      json(res, 500, { error: { message: '继续长程任务失败' } });
    }
  }
}
