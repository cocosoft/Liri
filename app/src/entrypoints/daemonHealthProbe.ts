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
 * daemonHealthProbe — DAEMON 常驻期的运行时探针接线
 *
 * 背景（真机实证，2026-11-08）：daemon 多次静默退出——app.log 无 fatal/uncaught、
 * `last-exit.json` 不更新（无任何 JS 退出事件），只能靠残留锁被下次启动记为
 * `last-abnormal.json` 才发现。故在 DAEMON 就绪点接两件事：
 * ① 周期心跳探针（`RuntimeHealthProbe`）—— 退出后「心跳停在何时 / 死前 RSS / 事件循环延迟」可回溯；
 * ② 自身健康端点的指数退避探测 —— `listen` 成功 ≠ 业务路由可用，确认真正就绪后再宣告。
 *
 * 从 `main.ts` 拆出（R04-001 行数上限），行为等价于内联实现。
 */

import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('main:daemonProbe');

/** 启动 DAEMON 运行时探针并做一次就绪探测（失败只告警，不阻塞常驻） */
export async function installDaemonHealthProbe(
  host: string,
  port: number
): Promise<void> {
  try {
    const { startRuntimeHealthProbe, probeHealthWithBackoff } =
      await import('@openliri/infra/runtimeHost/RuntimeHealthProbe');
    startRuntimeHealthProbe();
    const readiness = await probeHealthWithBackoff(`http://${host}:${port}`);
    if (readiness.ok) {
      logger.info('DAEMON 健康探测通过', {
        attempts: readiness.attempts,
        elapsedMs: readiness.elapsedMs,
        httpStatus: readiness.httpStatus,
      });
    } else {
      logger.warning('DAEMON 健康探测未通过（退避耗尽）', {
        attempts: readiness.attempts,
        elapsedMs: readiness.elapsedMs,
        error: readiness.error,
      });
    }
  } catch (err) {
    // @ignore-catch — 探针接线失败不阻塞 DAEMON 常驻
    logger.warning('运行时健康探针启动失败', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
