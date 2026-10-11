// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 回归（真机 bug，2026-10-11）：日预算撞限仍以**红色异常面板**呈现、卡片不渲染。
 *
 * 取证（真机浏览器 + curl 抓帧）：
 *   1. 后端**结构化错误帧**：`{"__pyapp_type":"error","__pyapp_error_code":"DAILY_BUDGET_EXCEEDED",
 *      "choices":[{"delta":{"content":"今日 Token 预算已用完…"},"finish_reason":"error"}]}`
 *   2. 后端紧随一帧**通用终止帧**：`{"choices":[{"delta":{},"finish_reason":"error"}]}`
 *      ——无 `__pyapp_type`、无 `__pyapp_error_code`。
 *   客户端把第 2 帧解析为**无 errorCode** 的 error chunk；`processChunk` 的"错误去重"
 *   分支用 `chunk.errorCode || "UNKNOWN"` 覆盖已有码 ⇒ `DAILY_BUDGET_EXCEEDED` 被降级为
 *   `UNKNOWN` ⇒ `ChatArea` 的 `isDailyLimitErrorCode` 分流失败（卡片不渲染、误走红条）。
 *
 * 本测试锁定去重语义：**已记录的业务码不得被后续"无码/UNKNOWN"的错误降级**；
 * 而真实码到达时仍可更新（不反向锁死）。
 */
import { describe, it, expect } from "vitest";
import {
  processChunk,
  type ProcessChunkContext,
} from "@/stores/chat/chat-stream-chunk";
import { EventBasedStreamAggregator } from "@/stores/chat/streaming/EventBasedStreamAggregator";
import type { Message } from "@/types";

/** 构建携带 error/errorCode 追踪的 processChunk 上下文（渲染链复用真实聚合器） */
function buildContext(): {
  ctx: ProcessChunkContext;
  read: () => { error: string | null; errorCode: string | null };
} {
  const assistantId = "assistant_test";
  let messages: Message[] = [
    {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      session_id: "session_test",
    },
  ];
  let error: string | null = null;
  let errorCode: string | null = null;

  const aggregator = new EventBasedStreamAggregator();
  aggregator.init([], "session_test", { assistantMessageId: assistantId });

  const ctx: ProcessChunkContext = {
    sid: "session_test",
    sessionId: "session_test",
    assistantId,
    controller: new AbortController(),
    saveQueue: {
      enqueue: () => {},
      flush: () => Promise.resolve(),
    } as unknown as ProcessChunkContext["saveQueue"],
    lastChunkTimeRef: { current: Date.now() },
    batch: { version: 0, pending: false, latestMessages: null },
    flushSet: () => {},
    set: (partial: unknown) => {
      const p = partial as {
        messages?: Message[];
        error?: string | null;
        errorCode?: string | null;
      };
      if (p.messages) messages = p.messages;
      if ("error" in p) error = p.error ?? null;
      if ("errorCode" in p) errorCode = p.errorCode ?? null;
    },
    get: () => ({ messages, error, errorCode }) as never,
    thinkingCharsRef: { current: 0, truncated: false },
    aggregator,
  };
  return { ctx, read: () => ({ error, errorCode }) };
}

describe("processChunk 错误码保真（日预算撞限卡片分流的前提）", () => {
  it("业务码不会被后端补发的『无码』通用错误降级为 UNKNOWN", async () => {
    const { ctx, read } = buildContext();

    // 第 1 帧：结构化错误（带业务码）
    await processChunk(ctx, {
      type: "error",
      content: "今日 Token 预算已用完（已用 901200 / 上限 500000）",
      errorCode: "DAILY_BUDGET_EXCEEDED",
    });
    expect(read().errorCode).toBe("DAILY_BUDGET_EXCEEDED");

    // 第 2 帧：通用终止帧（无 errorCode）
    await processChunk(ctx, {
      type: "error",
      content: "AI 服务返回错误，请检查 API 密钥和模型配置",
    });

    expect(read().errorCode).toBe("DAILY_BUDGET_EXCEEDED");
    // 首帧的原始文案保留（去重分支不覆盖 error 文本）
    expect(read().error).toContain("今日 Token 预算已用完");
  });

  it("UNKNOWN 之后到达的真实码仍可覆盖（不反向锁死）", async () => {
    const { ctx, read } = buildContext();

    await processChunk(ctx, {
      type: "error",
      content: "请求已取消",
      errorCode: "UNKNOWN",
    });
    expect(read().errorCode).toBe("UNKNOWN");

    await processChunk(ctx, {
      type: "error",
      content: "连接已断开，请刷新页面重试",
      errorCode: "CONNECTION_RESET",
    });
    expect(read().errorCode).toBe("CONNECTION_RESET");
  });
});
