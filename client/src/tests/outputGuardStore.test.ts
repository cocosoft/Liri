// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * outputGuardStore 单测（PC-1 前端相位，2026-10-07）
 *
 * 锁三件事：
 *   ① `blocked` / `redacted` ⇒ 按 **messageId** 记录标注；
 *   ② 非法载荷（缺 messageId / 未知 action / 非对象）**忽略**，不污染 store；
 *   ③ `blocked` 覆盖同消息既有标注（重复事件幂等收敛到最新动作）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useOutputGuardStore } from "../stores/outputGuardStore";

const get = () => useOutputGuardStore.getState();

beforeEach(() => {
  useOutputGuardStore.setState({ notices: {} });
});

describe("outputGuardStore", () => {
  it("blocked / redacted ⇒ 按消息 id 记录", () => {
    get().applyEvent({ sessionId: "s1", messageId: "m1", action: "blocked" });
    get().applyEvent({ sessionId: "s1", messageId: "m2", action: "redacted" });

    expect(get().notices.m1?.action).toBe("blocked");
    expect(get().notices.m2?.action).toBe("redacted");
  });

  it("非法载荷 ⇒ 忽略（缺 messageId / 未知 action / 非对象）", () => {
    get().applyEvent({ action: "blocked" });
    get().applyEvent({ messageId: "m1", action: "bogus" });
    get().applyEvent(null);
    get().applyEvent(undefined);

    expect(get().notices).toEqual({});
  });

  it("同消息重复事件 ⇒ 收敛为最新动作", () => {
    get().applyEvent({ messageId: "m1", action: "redacted" });
    get().applyEvent({ messageId: "m1", action: "blocked" });

    expect(Object.keys(get().notices)).toHaveLength(1);
    expect(get().notices.m1?.action).toBe("blocked");
  });
});
