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
 * 工作流 run 聚合卡片 —— 前端派生守卫（P1-3 §12 D14，2026-10-05）
 *
 * 与后端 `EventMessageDeriver` 逐字段同形：4 类事件**原地聚合**为一张 `workflow_run`
 * 卡片（不再各产 status 提示行）；缺 `run_start` 的孤儿事件不建卡（CS06 不编造）。
 * 前端**不做**中断合成（D15：实时流中"运行中"才是准确语义）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { LiriEvent } from "@/types";
import { clearToolResultCache } from "../chat-message-shared";
import { deriveConversationBlocks } from "../deriveConversationBlocks";

const SID = "sid-test";
const RUN_ID = "wf_test_1";

function ev(
  seq: number,
  type: LiriEvent["type"],
  data: Record<string, unknown> = {},
  time = 1000 + seq,
): LiriEvent {
  return {
    type,
    seq,
    time,
    sessionId: SID,
    data: data as never,
  };
}

// 清理工具结果缓存，避免测试间互相污染
beforeEach(() => {
  clearToolResultCache();
});

describe("deriveConversationBlocks — 工作流 run 聚合卡片（P1-3 §12 D14，2026-10-05）", () => {
  it("4 类事件聚合为单张 workflow_run 卡片（不再各产 status 提示行）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "开始", messageId: "asst-1" }),
      ev(3, "assistant/workflow_run_start", {
        runId: RUN_ID,
        workflow: "send-report",
        providerId: "doc-orchestrator",
        steps: ["doc:create-docx", "mail:send"],
        startedAt: 1000,
      }),
      ev(4, "assistant/workflow_step_start", {
        runId: RUN_ID,
        stepId: "doc:create-docx",
        tool: "doc:create-docx",
        description: "生成文档",
        startedAt: 1001,
      }),
      ev(5, "assistant/workflow_step_end", {
        runId: RUN_ID,
        stepId: "doc:create-docx",
        tool: "doc:create-docx",
        description: "生成文档",
        outcome: "completed",
        durationMs: 5,
      }),
      ev(6, "assistant/workflow_step_start", {
        runId: RUN_ID,
        stepId: "mail:send",
        tool: "mail:send",
        description: "发送邮件",
        startedAt: 1002,
      }),
      ev(7, "assistant/workflow_step_end", {
        runId: RUN_ID,
        stepId: "mail:send",
        tool: "mail:send",
        description: "发送邮件",
        outcome: "completed",
        durationMs: 7,
      }),
      ev(8, "assistant/workflow_run_end", {
        runId: RUN_ID,
        workflow: "send-report",
        providerId: "doc-orchestrator",
        stopReason: "completed",
        completedSteps: ["doc:create-docx", "mail:send"],
        durationMs: 12,
      }),
      ev(9, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    const asst = msgs.find((m) => m.id === "asst-1");
    expect(asst).toBeDefined();
    const blocks = asst!.blocks!;

    const cardBlocks = blocks.filter((b) => b.type === "workflow_run");
    expect(cardBlocks).toHaveLength(1);
    // 聚合后不再产生 status 提示行
    expect(blocks.filter((b) => b.type === "status")).toHaveLength(0);

    const data = cardBlocks[0].workflowData!;
    expect(data.runId).toBe(RUN_ID);
    expect(data.status).toBe("completed");
    expect(data.stopReason).toBe("completed");
    expect(data.durationMs).toBe(12);
    expect(data.steps.map((s) => s.stepId)).toEqual([
      "doc:create-docx",
      "mail:send",
    ]);
    expect(data.steps.every((s) => s.status === "completed")).toBe(true);
    expect(data.steps[0].description).toBe("生成文档");
    expect(data.steps[0].durationMs).toBe(5);
    // 前端不合成中断（D15）
    expect(data.interruptedHint).toBeUndefined();
  });

  it("缺 run_start 的孤儿 step/run_end → 不建卡（CS06：如实丢弃，不编造）", () => {
    const events: LiriEvent[] = [
      ev(1, "turn/start", { turn: 1 }),
      ev(2, "assistant/text", { content: "开始", messageId: "asst-1" }),
      ev(3, "assistant/workflow_step_start", {
        runId: "wf_orphan",
        stepId: "a",
        tool: "a",
        description: "步骤 a",
        startedAt: 1001,
      }),
      ev(4, "assistant/workflow_run_end", {
        runId: "wf_orphan",
        workflow: "send-report",
        providerId: "doc-orchestrator",
        stopReason: "completed",
        completedSteps: [],
        durationMs: 1,
      }),
      ev(5, "turn/end", { turn: 1 }),
    ];
    const msgs = deriveConversationBlocks(events);
    expect(msgs[0].blocks!.some((b) => b.type === "workflow_run")).toBe(false);
  });
});
