/**
 * B3（2026-10-30）：轮次摘要**唯一实现**的单测。
 *
 * 背景：左右两侧（`ChatInspector/ContextTab` 与 `ChatArea/RoundNavigator`）原先各写一份摘要算法，
 * 截断长度/换行处理/兜底文案口径不一。本用例锁定抽出来的公共实现的行为。
 */
import { describe, expect, it } from "vitest";

import {
  ROUND_SUMMARY_MAX_CHARS,
  buildRoundSummaries,
  summarizeRoundText,
} from "../roundSummaries";
import type { Message } from "../../types";

/** 文案键直通：断言"用了哪个键"，不绑定具体文案 */
const t = ((key: string) => key) as never;

const msg = (over: Partial<Message> & { role: Message["role"] }): Message =>
  ({
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: 1_700_000_000_000,
    ...over,
  }) as Message;

describe("summarizeRoundText：归一与截断", () => {
  it("换行转空格并去掉首尾空白", () => {
    expect(summarizeRoundText("第一行\n\n  第二行 ")).toBe("第一行 第二行");
  });

  it("超长补省略号，未超长原样返回", () => {
    expect(summarizeRoundText("abc", 5)).toBe("abc");
    expect(summarizeRoundText("abcdef", 5)).toBe("abcde…");
  });

  it("空/未定义 ⇒ 空串（兜底由调用方决定）", () => {
    expect(summarizeRoundText(undefined)).toBe("");
    expect(summarizeRoundText("   \n ")).toBe("");
  });

  it("默认截断长度即 ROUND_SUMMARY_MAX_CHARS", () => {
    const long = "字".repeat(ROUND_SUMMARY_MAX_CHARS + 5);
    expect(summarizeRoundText(long)).toHaveLength(ROUND_SUMMARY_MAX_CHARS + 1);
  });
});

describe("buildRoundSummaries：user + assistant 合并为一轮", () => {
  it("一轮 = 一条 user + 其后 assistant（blocks 文本优先于 content）", () => {
    const rounds = buildRoundSummaries(
      [
        msg({
          role: "user",
          id: "u1",
          content: "第一个问题\n带换行",
          timestamp: 10,
        }),
        msg({
          role: "assistant",
          content: "整段正文（不应优先）",
          blocks: [
            { type: "text", content: "正文块A" },
            { type: "text", content: "正文块B" },
          ] as Message["blocks"],
        }),
        msg({ role: "user", id: "u2", content: "第二个问题", timestamp: 20 }),
      ],
      t,
    );

    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({
      roundIndex: 1,
      userMsgId: "u1",
      userMsg: "第一个问题 带换行",
      assistantMsg: "正文块A 正文块B",
      timestamp: 10,
    });
    // 第二轮尚无 assistant ⇒ 空串
    expect(rounds[1].assistantMsg).toBe("");
  });

  it("空 user 内容 / 空 AI 回复 ⇒ 走既有兜底键（不产出空串给 UI）", () => {
    const rounds = buildRoundSummaries(
      [
        msg({ role: "user", content: "   " }),
        msg({ role: "assistant", content: "" }),
      ],
      t,
    );
    expect(rounds[0].userMsg).toBe("chatInspector.userMessageFallback");
    expect(rounds[0].assistantMsg).toBe("chatInspector.aiReplyFallback");
  });

  it("maxRounds 只处理尾部窗口（大会话不整段扫描）", () => {
    const many: Message[] = [];
    for (let i = 1; i <= 10; i++) {
      many.push(msg({ role: "user", id: `u${i}`, content: `问题${i}` }));
      many.push(msg({ role: "assistant", content: `回答${i}` }));
    }
    const rounds = buildRoundSummaries(many, t, { maxRounds: 3 });
    // 每轮 2 条 ⇒ 只取尾部 3 轮（u8/u9/u10），轮号在**窗口内**从 1 重新计
    expect(rounds.map((r) => r.userMsgId)).toEqual(["u8", "u9", "u10"]);
    expect(rounds.map((r) => r.roundIndex)).toEqual([1, 2, 3]);
  });
});
