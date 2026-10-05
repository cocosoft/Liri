// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * WorkflowRunCard 渲染冒烟（P1-3 §12 D14，2026-10-05 实建）
 *
 * 走真实会话渲染路径（`ChatMessage` → `BlockRenderer` → `WorkflowRunCard`），
 * 覆盖完成 / 失败 / 中断 / 最小数据四态；断言卡片文案来自传入的**真实数据**
 * （CS04：无 mock 数据；缺字段即省略，不编造 —— CS06）。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ChatMessage from "../components/ChatArea/ChatMessage";
import type { Message, MessageBlock, WorkflowRunData } from "../types/message";

/** 卡片只在"有实质内容块"的消息里渲染 ⇒ 每个用例补一个 text 块 */
const TEXT_BLOCK: MessageBlock = {
  id: "b-text",
  type: "text",
  content: "正文",
};

function wfBlock(id: string, data: WorkflowRunData): MessageBlock {
  return {
    id,
    type: "workflow_run",
    content: data.workflow,
    workflowData: data,
  };
}

function makeMessage(blocks: MessageBlock[]): Message {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    session_id: "s-1",
    blocks,
  };
}

const bodyText = () => document.body.textContent ?? "";

describe("WorkflowRunCard 渲染（P1-3 §12 D14）", () => {
  it("完成态：工作流名 / 已完成 / 步骤描述 / 总耗时 / 步骤计数", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          wfBlock("b-wf", {
            runId: "wf_1",
            workflow: "send-report",
            status: "completed",
            stopReason: "completed",
            durationMs: 2100,
            steps: [
              {
                stepId: "doc:create-docx",
                tool: "doc:create-docx",
                description: "生成文档",
                status: "completed",
                durationMs: 600,
              },
              {
                stepId: "mail:send",
                tool: "mail:send",
                description: "发送邮件",
                status: "completed",
                durationMs: 1300,
              },
            ],
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("send-report");
    expect(bodyText()).toContain("已完成");
    expect(bodyText()).toContain("生成文档");
    expect(bodyText()).toContain("发送邮件");
    expect(bodyText()).toContain("2.1s");
    expect(bodyText()).toContain("2/2");
  });

  it("失败态：显示失败 + 失败步骤与原因 + 根因摘要", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          wfBlock("b-wf", {
            runId: "wf_2",
            workflow: "send-report",
            status: "failed",
            stopReason: "error",
            durationMs: 800,
            failedStep: "mail:send",
            error: "smtp down",
            rootCauseSummary: "上游可疑：doc:create-docx",
            steps: [
              {
                stepId: "doc:create-docx",
                tool: "doc:create-docx",
                description: "生成文档",
                status: "completed",
                durationMs: 600,
              },
              {
                stepId: "mail:send",
                tool: "mail:send",
                description: "发送邮件",
                status: "failed",
                durationMs: 200,
                error: "smtp down",
              },
            ],
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("失败");
    expect(bodyText()).toContain("失败于步骤 mail:send");
    expect(bodyText()).toContain("smtp down");
    expect(bodyText()).toContain("上游可疑：doc:create-docx");
  });

  it("中断态：显示已中断 + 后端合成的指导文案（前端不自行判定）", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          wfBlock("b-wf", {
            runId: "wf_3",
            workflow: "send-report",
            status: "interrupted",
            interruptedHint: "工作流执行中断，运行结果未知。",
            steps: [
              {
                stepId: "doc:create-docx",
                tool: "doc:create-docx",
                description: "生成文档",
                status: "completed",
                durationMs: 600,
              },
              {
                stepId: "mail:send",
                tool: "mail:send",
                description: "发送邮件",
                status: "interrupted",
              },
            ],
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("已中断");
    expect(bodyText()).toContain("工作流执行中断，运行结果未知。");
  });

  it("最小数据（运行中、无步骤）不抛错：显示运行中与「无步骤记录」", () => {
    render(
      <ChatMessage
        message={makeMessage([
          TEXT_BLOCK,
          wfBlock("b-wf", {
            runId: "wf_4",
            workflow: "send-report",
            status: "running",
            steps: [],
          }),
        ])}
      />,
    );

    expect(bodyText()).toContain("运行中");
    expect(bodyText()).toContain("无步骤记录");
  });
});
