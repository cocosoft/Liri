/**
 * 回归（Spec `daily-budget-over-limit-ux.md` §10-4：errorCode **端到端保真**）。
 *
 * 背景（非流式路径，office/文档生成走 `sendMessage`）：后端撞限返回
 * `429 { error: { message, type: 'budget_exceeded', code: 'DAILY_BUDGET_EXCEEDED' } }`。
 * 此前 `fetchJSON` 只取 `body.message`（实际嵌套在 `body.error.message`）⇒ 既丢文案
 * 也丢业务码；`sendMessageImpl` 的 catch 又无条件写 `UNKNOWN` ⇒ 前端限额卡片分流失效
 * （撞限只出红色异常条）。本测试锁定「透出 ⇒ 保留」这条链。
 */
import { describe, it, expect, afterEach } from "vitest";
import { chatService } from "@/services/chatService";
import { resolveClientErrorCode } from "@/stores/chat/chat-message-send";

const prevFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = prevFetch;
});

describe("fetchJSON：后端业务错误码透出（非流式路径）", () => {
  it("429 {error:{message,code}} ⇒ 抛出的 Error 带 errorCode 与真实文案", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 429,
      json: async () => ({
        error: {
          message: "今日 Token 预算已用完：为避免超额，本次未调用模型。",
          type: "budget_exceeded",
          code: "DAILY_BUDGET_EXCEEDED",
        },
      }),
    })) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await chatService.sendMessage("hi");
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { errorCode?: string })?.errorCode).toBe(
      "DAILY_BUDGET_EXCEEDED",
    );
    expect((thrown as Error).message).toContain("今日 Token 预算已用完");
    // 与 catch 的兜底解析串起来：真实业务码不得被降级为 UNKNOWN
    expect(resolveClientErrorCode(thrown)).toBe("DAILY_BUDGET_EXCEEDED");
  });

  it("无 code 的通用 500 ⇒ 不伪造 errorCode（走兜底）", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "boom", type: "server_error" } }),
    })) as unknown as typeof fetch;

    let thrown: unknown;
    try {
      await chatService.sendMessage("hi");
    } catch (e) {
      thrown = e;
    }

    expect((thrown as { errorCode?: string })?.errorCode).toBeUndefined();
    expect(resolveClientErrorCode(thrown)).toBe("UNKNOWN");
  });
});

describe("resolveClientErrorCode：优先保留后端业务码（§10-4）", () => {
  it("业务码 ⇒ 原样保留", () => {
    const err = new Error("今日 Token 预算已用完");
    (err as { errorCode?: string }).errorCode = "DAILY_BUDGET_EXCEEDED";
    expect(resolveClientErrorCode(err)).toBe("DAILY_BUDGET_EXCEEDED");
  });

  it("无业务码 + 网络语义 ⇒ BACKEND_UNREACHABLE（兜底不回归）", () => {
    expect(resolveClientErrorCode(new Error("Failed to fetch"))).toBe(
      "BACKEND_UNREACHABLE",
    );
    expect(resolveClientErrorCode(new Error("connect ECONNREFUSED"))).toBe(
      "BACKEND_UNREACHABLE",
    );
  });

  it("无业务码 + 其它 / 非法值 ⇒ UNKNOWN", () => {
    expect(resolveClientErrorCode(new Error("boom"))).toBe("UNKNOWN");
    expect(resolveClientErrorCode(undefined)).toBe("UNKNOWN");
    const empty = new Error("boom");
    (empty as { errorCode?: unknown }).errorCode = "";
    expect(resolveClientErrorCode(empty)).toBe("UNKNOWN");
  });
});
