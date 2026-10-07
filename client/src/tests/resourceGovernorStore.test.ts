// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * resourceGovernorStore 单测（PC-2 前端相位，2026-10-07）
 *
 * 锁三件事：
 *   ① `preempted`/`queued` ⇒ 记录该**会话**的提示；
 *   ② `released` ⇒ **清除**（名额移交 / 排队超时放行后不残留"排队中"）；
 *   ③ 非法载荷（缺 sessionId / 未知 state）**忽略**，不污染 store。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useResourceGovernorStore } from "../stores/resourceGovernorStore";

const get = () => useResourceGovernorStore.getState();

beforeEach(() => {
  useResourceGovernorStore.setState({ notices: {} });
});

describe("resourceGovernorStore", () => {
  it("preempted/queued ⇒ 按会话记录提示", () => {
    get().applyEvent({ sessionId: "s1", state: "preempted" });
    get().applyEvent({ sessionId: "s2", state: "queued", queuePosition: 3 });

    expect(get().notices.s1?.state).toBe("preempted");
    expect(get().notices.s2?.state).toBe("queued");
    expect(get().notices.s2?.queuePosition).toBe(3);
  });

  it("released ⇒ 清除该会话条目", () => {
    get().applyEvent({ sessionId: "s1", state: "queued", queuePosition: 1 });
    get().applyEvent({ sessionId: "s1", state: "released" });

    expect(get().notices.s1).toBeUndefined();
  });

  it("非法载荷 ⇒ 忽略（缺 sessionId / 未知 state / 非对象）", () => {
    get().applyEvent({ state: "preempted" });
    get().applyEvent({ sessionId: "s1", state: "bogus" });
    get().applyEvent(null);
    get().applyEvent(undefined);

    expect(get().notices).toEqual({});
  });

  it("clear ⇒ 手动关闭指定会话提示（缺省无操作）", () => {
    get().applyEvent({ sessionId: "s1", state: "preempted" });
    get().clear("s1");
    get().clear("not-exist"); // 幂等

    expect(get().notices).toEqual({});
  });
});
