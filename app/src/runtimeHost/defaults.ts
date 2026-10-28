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
 * runtimeHost 默认阈值（**B 类裸字面量归一化落点**，`lint:consts` D-2 口径）
 *
 * 为什么单独一个文件：`IdleScaleMonitor` 从内核迁入后，`app/src` 首次被 D-2 扫描到
 * （内核目录不在其扫描面内）。这三条 `*_MS` 常量按口径不得以裸数字声明在业务文件里，
 * 而 `defaults.ts` 正是「模块内默认值」的**允许位置**（`scripts/lint-consts.ts` §D-2）。
 *
 * ⚠️ 取值**一字未改**（迁出前后同一事实）：`IDLE_SCALE_TIMEOUT_MS` 与
 * `acp/session.ts` 的 `ACP_SESSION_IDLE_TIMEOUT_MS` 同名同值但**异事实**，
 * 已按域消歧（守卫：`app/tests/constants/sameNameConstsB2.test.ts` B5-2⑫）。
 */

/** 空闲判定阈值：30 分钟无活动视为空闲（P3-5 空闲降载） */
export const IDLE_SCALE_TIMEOUT_MS = 30 * 60_000;

/** 采样间隔：每分钟一次 */
export const DEFAULT_POLL_MS = 60_000;

/** 过期临时文件阈值：24 小时后清理 */
export const DEFAULT_TEMP_MAX_AGE_MS = 24 * 3600_000;
