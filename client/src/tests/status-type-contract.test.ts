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
 * CS02 守卫 —— 状态块 `statusType` 契约（`.trae/specs/chat-status-type-contract.md`）
 *
 * 锁三件事：
 *  1. **契约一致性**：瞬态集合恰好是 5 个内部过渡值，且不含任何可见值；
 *  2. **判据已脱离文案**：旧文案（`❌ Tool … failed` 等）即便无 `statusType` 也**不再被丢弃**
 *     ——证明字符串回退确已删除；
 *  3. **不变性守卫（D8）**：`工具执行中 N%` / `执行 N 个工具调用` / 思考过长截断三条**必须保持可见**
 *     ——防止后人"为凑完备性"给它们补标记而误借 `tool_running` ⇒ 被误判丢弃（BUG-10 回归）。
 */
import { describe, expect, it } from "vitest";
import {
  STATUS_TYPE,
  TRANSIENT_STATUS_TYPES,
  isTransientStatusType,
} from "@shared/types";
import { isInternalTransitionStatus } from "../stores/chat/chat-toolcall.slice";

describe("statusType 契约：瞬态集合", () => {
  it("恰好包含 5 个内部过渡值", () => {
    expect([...TRANSIENT_STATUS_TYPES].sort()).toEqual(
      [
        STATUS_TYPE.AI_THINKING,
        STATUS_TYPE.TOOL_RUNNING,
        STATUS_TYPE.TOOL_STARTED,
        STATUS_TYPE.TOOL_COMPLETED,
        STATUS_TYPE.TOOL_FAILED,
      ].sort(),
    );
  });

  it("不含任何用户可见值（尤其 tool_retry / truncated / compaction）", () => {
    for (const visible of [
      STATUS_TYPE.TOOL_RETRY,
      STATUS_TYPE.TRUNCATED,
      STATUS_TYPE.COMPACTION,
      STATUS_TYPE.WATERMARK,
      STATUS_TYPE.RETRY,
      STATUS_TYPE.RECONNECT,
      STATUS_TYPE.TASK_ALL_DONE,
      STATUS_TYPE.RESUME,
      STATUS_TYPE.ERROR,
      STATUS_TYPE.SUSPENSION_SETTLED,
    ]) {
      expect(TRANSIENT_STATUS_TYPES.has(visible)).toBe(false);
    }
  });

  it("未知 / 缺失值一律判为可见（fail-visible）", () => {
    expect(isTransientStatusType(undefined)).toBe(false);
    expect(isTransientStatusType("")).toBe(false);
    expect(isTransientStatusType("some_future_type")).toBe(false);
  });
});

describe("判据已脱离 content 文案（字符串回退已删除）", () => {
  it("旧文案 + 无 statusType ⇒ 不再被丢弃", () => {
    for (const legacy of [
      "🔧 Running tool: file_read",
      "✅ Tool file_read completed",
      "❌ Tool file_read failed — boom",
      "AI is thinking...",
      "AI is analyzing your request...",
      "AI is preparing context...",
      "AI is waiting for response...",
      "🎨 AI is generating an image...",
      "🔍 AI is analyzing the image...",
    ]) {
      expect(isInternalTransitionStatus(legacy, undefined)).toBe(false);
    }
  });

  it("同文案 + 正确 statusType ⇒ 被丢弃（结构化生效）", () => {
    expect(
      isInternalTransitionStatus(
        "🔧 Running tool: file_read",
        STATUS_TYPE.TOOL_RUNNING,
      ),
    ).toBe(true);
    expect(
      isInternalTransitionStatus(
        "❌ Tool file_read failed — boom",
        STATUS_TYPE.TOOL_FAILED,
      ),
    ).toBe(true);
    expect(
      isInternalTransitionStatus(
        "AI is analyzing your request...",
        STATUS_TYPE.AI_THINKING,
      ),
    ).toBe(true);
  });

  it("取值不匹配的历史缺陷已消除：tool_running 走通结构化通路、tool_started 为死值", () => {
    // 修复前：白名单只认 tool_started（无生产者），tool_running 靠字符串回退
    expect(isTransientStatusType(STATUS_TYPE.TOOL_RUNNING)).toBe(true);
    expect(isTransientStatusType(STATUS_TYPE.TOOL_STARTED)).toBe(true);
  });
});

describe("不变性守卫（D8）：可见状态必须保持可见", () => {
  it("工具中间进度不被丢弃（BUG-10 行为不变）", () => {
    expect(isInternalTransitionStatus("工具执行中 50%", undefined)).toBe(false);
  });

  it("工具批量执行提示不被丢弃", () => {
    expect(isInternalTransitionStatus("执行 3 个工具调用", undefined)).toBe(
      false,
    );
  });

  it("思考过长截断提示不被丢弃", () => {
    expect(
      isInternalTransitionStatus(
        "模型思考过长被输出上限截断，未生成正文。建议增大 maxTokens、减小上下文，或更换输出能力更强的模型后重试。",
        undefined,
      ),
    ).toBe(false);
  });

  it("compaction / truncated 标记不被丢弃", () => {
    expect(
      isInternalTransitionStatus("上下文水位 92%，正在压缩历史...", undefined),
    ).toBe(false);
    expect(
      isInternalTransitionStatus("已达最大工具轮次限制", "truncated"),
    ).toBe(false);
  });
});
