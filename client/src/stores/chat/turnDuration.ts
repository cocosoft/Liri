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
 * 每轮助手回复耗时（`durationMs`）——写入判据的**纯函数**单一事实源。
 *
 * 拆出为独立模块（而非内联在 `chat-message-stream.ts`）：该判据是**产品口径**的承载体，
 * 需要被单测直接锁定；独立模块让测试无需加载整个流式 store（及其 i18n / service 依赖）。
 *
 * 口径（用户裁定）：**仅"正常完成"的轮次**写入耗时；被停止（abort）、出错（error）、
 * 异常结束（连接中断 / 无内容兜底）的轮次**不写** —— 否则会把"未完成"误读为"已完成耗时"。
 *
 * 展示侧：`components/ChatArea/ChatMessage.tsx` 仅在 `message.durationMs !== undefined`
 * 时渲染 `⏱ …`（`formatDuration` 同文件内）。
 */

/**
 * 本轮流是否应写入整轮耗时。
 *
 * @param input.streamStartTime 本轮流起始时间（`Date.now()`；未记录为 0）
 * @param input.abnormallyEnded 异常结束（连接中断 / 无内容兜底等）
 * @param input.aborted 用户/系统中止
 * @param input.receivedError 已收到 error chunk
 */
export function shouldRecordTurnDuration(input: {
  streamStartTime: number;
  abnormallyEnded: boolean;
  aborted: boolean;
  receivedError: boolean;
}): boolean {
  return (
    input.streamStartTime > 0 &&
    !input.abnormallyEnded &&
    !input.aborted &&
    !input.receivedError
  );
}
