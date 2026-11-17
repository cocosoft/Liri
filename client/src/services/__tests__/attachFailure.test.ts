/**
 * attach 失败状态映射（2026-11-18，Spec `.trae/specs/stream-attach.md` §4.3）
 *
 * 只按 HTTP 状态码映射（CS02）：不解析响应文案，也不把 500/网络错误误判为
 * "本轮已结束"。
 */
import { describe, expect, it } from "vitest";

import { attachFailureForStatus } from "../chatService";

describe("attachFailureForStatus", () => {
  it("404 ⇒ no_active_run", () => {
    expect(attachFailureForStatus(404)).toBe("no_active_run");
  });

  it("409 ⇒ cursor_gap（游标越界/本轮已更换）", () => {
    expect(attachFailureForStatus(409)).toBe("cursor_gap");
  });

  it("429 ⇒ too_many_attachments", () => {
    expect(attachFailureForStatus(429)).toBe("too_many_attachments");
  });

  it("其他状态与缺失状态 ⇒ null（按普通请求失败处理）", () => {
    expect(attachFailureForStatus(500)).toBeNull();
    expect(attachFailureForStatus(400)).toBeNull();
    expect(attachFailureForStatus(undefined)).toBeNull();
  });
});
