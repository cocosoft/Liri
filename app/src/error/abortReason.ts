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
 * 「预期中断」判据 —— **单一事实源**（2026-09-25，
 * `.trae/specs/system-abort-reason-hardening.md` §6.8）。
 *
 * **为什么放在 `error/`（判据下沉）**：本判据需要在**所有层**使用，而其中最需要它的三层 ——
 * `error/handleError`（§1.9 的唯一错误入口）、`ai/providers/*`（把流失败包装为 `AppError` 的点）、
 * `core/exit/ExitRecorder`（退出记录）—— **都低于**原驻地 `query/ReActLoop`，向上 import 属反向依赖。
 * 原位置使得低层只能各自为政（实测后果：provider 把预期中止升格为 `severity:"high"` 并触发
 * `[ALERT] [P2]`；exit recorder 无条件把它记成「异常退出」）。`error/` 已被 `ai/`、`core/` 顺向依赖
 * ⇒ 判据下沉到此。`query/ReActLoop` 保留 **re-export**，`@modules/query` 对外出口逐字不变。
 *
 * ❌ 禁止在各层就地重写一份（例如 `err.name === 'AbortError'`）—— 那会重新分裂判据（CS01/CS02）。
 */

/** 系统侧中止的**标记值/消息文本锚点**（值不变，**非用户可见文案**） */
export const SYSTEM_ABORT_REASON = 'liri:system-abort';

/**
 * 「预期中断」的**品牌键**（显式标记）。
 *
 * 存在的意义：错误被上层**包装**（如 provider 包装为 `AppError`）后，`name` / `message` 都会变，
 * 只有"品牌属性"能原样穿过包装 ⇒ 低层统一收口（`handleError` 降噪、`ExitRecorder` 不记异常退出）
 * 才不会因为"包了一层"而失效。用显式标记而非字符串推断（CS02）。
 */
export const SYSTEM_ABORT_BRAND: unique symbol = Symbol.for('liri.systemAbort');

/**
 * 给**已包装的**异常携带"预期中断"标记（非枚举属性 ⇒ 不污染 JSON 序列化与日志）。
 *
 * 用法：provider 在把中止包装成 `AppError` 时调用本函数，使包装结果仍被 `isAbortReason()` 命中。
 */
export function markAsExpectedAbort<T extends object>(err: T): T {
  Object.defineProperty(err, SYSTEM_ABORT_BRAND, {
    value: true,
    enumerable: false,
  });
  return err;
}

/**
 * 「预期中断」判据（**广义**，**单一事实源**）。
 *
 * 为什么需要收敛：中止在两条链路上出现，判据必须一致 ——
 * ① **循环侧**：判 system/user 用 `isSystemAbortReason()`（**狭义**，见 `state.abortSource`）；
 * ② **进程/错误侧**：全局 `unhandledRejection` 处理器与 `handleError`（唯一错误入口）需判定
 *    "这是预期中断（降级 warn、不计入错误统计、不告警）"还是"真异常"—— 用**本函数**（**广义**）。
 *
 * **修复的缺口（2026-09-25 实证）**：进程侧原判据只认 `DOMException` / `Error` 形态的 AbortError
 * ⇒ **裸字符串** `SYSTEM_ABORT_REASON`（`abort(reason)` 传字符串时，未被 catch 的 promise 链会以
 * **该字符串本体**作为 rejection reason 外泄）**两条都不满足**，被误判为真异常：写崩溃转储 +
 * `UNHANDLED_ERROR/severity:medium` + error 级日志（即使它源自"删除正在运行的会话"这类系统侧
 * 预期中止）。完整溯源见 `dev_docs/error_repairs/last-exit-20260925-0154Z.md`。
 *
 * **刻意收窄**：字符串形态只精确匹配 `SYSTEM_ABORT_REASON`，不放过"任意含 abort 的字符串"
 * —— 后者会把真实错误当成预期中断（与本次修复方向相反的漏判）。
 */
export function isAbortReason(reason: unknown): boolean {
  if (reason === SYSTEM_ABORT_REASON) return true;
  // 品牌分支（2026-09-25 §6.8）：被包装/跨边界传递后仍可识别（显式标记，非字符串推断）
  if (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { [SYSTEM_ABORT_BRAND]?: boolean })[SYSTEM_ABORT_BRAND] === true
  ) {
    return true;
  }
  if (reason instanceof DOMException && reason.name === 'AbortError')
    return true;
  if (reason instanceof Error) {
    return (
      reason.name === 'AbortError' ||
      reason.message?.includes('aborted') === true
    );
  }
  return false;
}
