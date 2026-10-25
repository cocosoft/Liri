import { describe, expect, it } from "vitest";
import {
  buildCapabilityOptions,
  toggleCapabilityGrant,
} from "../utils/pluginCapabilityOptions";

describe("buildCapabilityOptions（能力勾选面板的选项构造）", () => {
  it("顺序：先按声明、再补可授权、最后未实现；且去重", () => {
    const options = buildCapabilityOptions({
      declared: ["tools", "config"],
      granted: ["tools"],
      available: ["tools", "config"],
      unimplemented: ["events"],
    });
    expect(options.map((o) => o.name)).toEqual(["tools", "config", "events"]);
    expect(options.map((o) => o.checked)).toEqual([true, false, false]);
    expect(options.map((o) => o.selectable)).toEqual([true, true, false]);
  });

  it("未声明但可授权的能力也出现在面板里（允许用户主动开启）", () => {
    const options = buildCapabilityOptions({
      declared: ["tools"],
      granted: [],
      available: ["tools", "config"],
      unimplemented: [],
    });
    expect(options.map((o) => o.name)).toEqual(["tools", "config"]);
  });

  it("未实现即使被误放进 available 也不可勾选（防 UI 绕过）", () => {
    const options = buildCapabilityOptions({
      declared: ["events"],
      granted: ["events"],
      available: ["events"],
      unimplemented: ["events"],
    });
    expect(options[0]).toEqual({
      name: "events",
      checked: true,
      selectable: false,
    });
  });
});

describe("toggleCapabilityGrant（勾选后的授权集合）", () => {
  const available = ["tools", "config"];

  it("勾选 / 取消按 available 顺序归一化", () => {
    expect(toggleCapabilityGrant([], "config", true, available)).toEqual([
      "config",
    ]);
    expect(
      toggleCapabilityGrant(["config", "tools"], "config", false, available),
    ).toEqual(["tools"]);
    expect(toggleCapabilityGrant(["tools"], "tools", false, available)).toEqual(
      [],
    );
  });

  it("不可勾选的名字 ⇒ 原样返回（不写入未实现能力）", () => {
    expect(toggleCapabilityGrant(["tools"], "events", true, available)).toEqual([
      "tools",
    ]);
  });

  it("结果只含 available：历史遗留的 events 不会带上去（否则 PUT 会 400）", () => {
    expect(
      toggleCapabilityGrant(["tools", "events"], "config", true, available),
    ).toEqual(["tools", "config"]);
  });
});
