import { describe, expect, it } from "vitest";
import type { LogEntry } from "../types";
import { extractInternalSource } from "../components/common/logSourceUtils";

/**
 * extractInternalSource 解析分支测试
 * 验证：details 为 null/undefined/空串 时安全返回 null（不进入 JSON.parse）；
 * 非法 JSON 回退 unknown；缺 source 字段回退 unknown；正常解析返回 source。
 */

const BREAKPOINT_MESSAGE =
  "[内部调用断点] _fromInternal=true，本轮不计入 userSessions";

function makeLog(partial: Partial<LogEntry>): LogEntry {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    level: "info",
    message: BREAKPOINT_MESSAGE,
    timestamp: Date.now(),
    source: "logger",
    ...partial,
  };
}

describe("extractInternalSource — §14.3 P1 来源徽章解析分支", () => {
  it("非断点日志（message 前缀不匹配）返回 null", () => {
    expect(extractInternalSource(makeLog({ message: "普通日志" }))).toBeNull();
  });

  it("details 为 null 时安全返回 null，不抛错", () => {
    // 类型层面 LogEntry.details 为 string | undefined，null 仅能通过数据源边界注入，
    // 此处用 as unknown 模拟后端返回 null 的防御性场景
    expect(
      extractInternalSource(makeLog({ details: null as unknown as undefined })),
    ).toBeNull();
  });

  it("details 为 undefined 时安全返回 null，不抛错", () => {
    expect(extractInternalSource(makeLog({ details: undefined }))).toBeNull();
  });

  it("details 为空字符串时安全返回 null，不抛错", () => {
    expect(extractInternalSource(makeLog({ details: "" }))).toBeNull();
  });

  it("details 为非法 JSON 时回退 unknown", () => {
    expect(
      extractInternalSource(makeLog({ details: "{ not valid json" })),
    ).toBe("unknown");
  });

  it("details 合法 JSON 但缺 source 字段时回退 unknown", () => {
    expect(
      extractInternalSource(makeLog({ details: '{"sessionId":"s1"}' })),
    ).toBe("unknown");
  });

  it("details 合法 JSON 且含 source 时返回 source 值", () => {
    expect(
      extractInternalSource(
        makeLog({
          details: '{"sessionId":"s1","source":"executeStepPrompt"}',
        }),
      ),
    ).toBe("executeStepPrompt");
  });

  it("details 为字符串 'null'（JSON 字面量）时回退 unknown 不崩溃", () => {
    // JSON.parse('null') 返回 null 而非对象 → 安全回退 unknown，不抛 TypeError
    expect(extractInternalSource(makeLog({ details: "null" }))).toBe("unknown");
  });

  it("details 为 JSON 数组字面量时回退 unknown 不崩溃", () => {
    expect(extractInternalSource(makeLog({ details: "[1,2,3]" }))).toBe(
      "unknown",
    );
  });
});
