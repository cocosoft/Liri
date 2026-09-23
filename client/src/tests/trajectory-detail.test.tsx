// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 轨迹检查器增强（P1-3，2026-09-22）
 *
 * 锁定四项中的三项（schema 因事件流无数据源**刻意未做**）：
 * ① Markdown 正文渲染 + 「查看原文/渲染 Markdown」切换（复用既有 MarkdownRenderer）；
 * ② `metric/timing` 事件 ⇒ 展示计时（stage / ttft / duration / tokens）；
 * ③ `context/compaction` 事件 ⇒ 展示压缩前后用量与减少比例（+ 摘要信封 usage 若有）；
 * ④ 无关事件**不**展示上述块（避免"无条件塞满面板"——只展示真实存在的数据）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import i18n from "../i18n";
import { TrajectoryDetail } from "../components/Trajectory/TrajectoryDetail";
import type { LiriEvent } from "../types";

// 测试环境 i18n：setup.ts 将 react-i18next 的 t() mock 为"返回裸 key"（其余用例依赖该行为），
// 而本文件断言的是组件渲染出的中文文案 ⇒ 覆盖为委托真实 i18n 实例（默认 zh）。
// 断言里的中文与 src/i18n/locales/zh.ts 的 trajectory.* 逐字一致。
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(i18n.t(key, opts as never)),
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function mkEvent(
  type: LiriEvent["type"],
  data: Record<string, unknown>,
  seq = 7,
): LiriEvent {
  return {
    type,
    seq,
    time: 1700000000000,
    sessionId: "s1",
    data,
  } as unknown as LiriEvent;
}

const noop = (): void => {};

/** 覆盖 navigator.clipboard（jsdom 默认无此 API ⇒ 需要显式注入才能覆盖两条分支） */
function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("TrajectoryDetail 检查器增强（P1-3）", () => {
  it("含正文的事件：默认 Markdown 渲染，可切「查看原文」并切回", () => {
    render(
      <TrajectoryDetail
        event={mkEvent("assistant/text", { content: "标题与正文" })}
        onClose={noop}
      />,
    );

    expect(screen.getByText("正文")).toBeDefined();
    // 默认走 Markdown 渲染 ⇒ 按钮提示可查看原文
    const toggle = screen.getByRole("button", { name: "查看原文" });
    fireEvent.click(toggle);
    // 切换后按钮语义反转（当前为原文视图）
    expect(screen.getByRole("button", { name: "渲染 Markdown" })).toBeDefined();
  });

  it("metric/timing：展示 stage / ttft / duration / tokens", () => {
    render(
      <TrajectoryDetail
        event={mkEvent("metric/timing", {
          stage: "reason",
          ttft: 420,
          duration: 3100,
          tokens: 980,
        })}
        onClose={noop}
      />,
    );

    expect(screen.getByText("计时")).toBeDefined();
    // P2-3（2026-09-22）后：`data` 改为 JSON 树渲染 ⇒ **同一数值会同时出现在
    // 「计时」区块与 JSON 树中** ⇒ 不再唯一。断言意图不变（区块确实渲染了这些值），
    // 故改为"至少一处"。
    expect(screen.getAllByText("420 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3100 ms").length).toBeGreaterThan(0);
    expect(screen.getAllByText("980").length).toBeGreaterThan(0);
  });

  it("context/compaction：展示压缩前后用量与减少比例（含摘要信封 usage）", () => {
    render(
      <TrajectoryDetail
        event={mkEvent("context/compaction", {
          phase: "done",
          beforeTokens: 40000,
          afterTokens: 10000,
          summaryEnvelope: { model: "m1", usage: { input: 1200, output: 300 } },
        })}
        onClose={noop}
      />,
    );

    expect(screen.getByText("用量（压缩前后）")).toBeDefined();
    // P2-3 后：同值也会出现在 JSON 树 ⇒ 改为"至少一处"（见上方 metric/timing 用例说明）
    expect(screen.getAllByText("40000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10000").length).toBeGreaterThan(0);
    // (1 - 10000/40000) = 75%
    expect(screen.getByText(/75\s*%/)).toBeDefined();
    expect(screen.getByText(/input=1200/)).toBeDefined();
  });

  it("无关事件（工具结果）：不展示计时/用量块（不做无条件填充）", () => {
    render(
      <TrajectoryDetail
        event={mkEvent("tool/result", { toolCallId: "c1", result: "ok" })}
        onClose={noop}
      />,
    );

    expect(screen.queryByText("计时")).toBeNull();
    expect(screen.queryByText("用量（压缩前后）")).toBeNull();
    expect(screen.queryByText("正文")).toBeNull();
    // 仍保留既有的工具字段分区块
    expect(screen.getByText("result")).toBeDefined();
  });

  // TC-1（2026-09-23）：补齐「复制 JSON」两条分支 + JSON.stringify 失败兜底
  // 注：按钮的**可访问名固定为 aria-label「复制 JSON」**（不随 copied 变），故按**文案**断言。
  it("复制 JSON：写入成功 ⇒ 文案切到「已复制 ✓」", async () => {
    stubClipboard(() => Promise.resolve());
    render(
      <TrajectoryDetail
        event={mkEvent("assistant/text", { content: "x" })}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制 JSON" }));
    await screen.findByText("已复制 ✓");
  });

  it("复制 JSON：剪贴板不可用 ⇒ 静默（文案不变、不崩）", async () => {
    // 用**同步抛错**（而非 rejected promise）以命中 catch 且不产生未处理拒绝噪音
    stubClipboard(() => {
      throw new Error("denied");
    });
    render(
      <TrajectoryDetail
        event={mkEvent("assistant/text", { content: "x" })}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制 JSON" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("已复制 ✓")).toBeNull();
  });

  it("data 含循环引用 ⇒ JSON.stringify 抛错时回退 String(data)，不崩溃", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    render(
      <TrajectoryDetail
        event={mkEvent("system/info", circular)}
        onClose={noop}
      />,
    );
    // 头部仍渲染（未因序列化失败而崩溃）
    expect(screen.getByText("#7")).toBeDefined();
  });
});

/**
 * TR-12-B（2026-09-22）：模型输入快照分区 —— 组件级验证
 * （补 Spec §5「前端渲染无组件级验证」的边界）
 *
 * 断言以**精确 textContent** 匹配：`<li>` 由「段名 + " · " + 字符数/引用」多个文本节点组成，
 * 用正则会同时命中祖先元素（多重匹配）。中文与 zh.ts 的 trajectory.detail.* 逐字一致。
 */
describe("TrajectoryDetail 模型输入快照（TR-12-B）", () => {
  // 注：只有一段时 `<ul>` 与 `<li>` 的 textContent 相同 ⇒ 必然多重命中 ⇒ 取首个即可
  const byExactText = (s: string) =>
    screen.getAllByText((_, el) => el?.textContent === s)[0];

  const fullPayload = {
    tools: { hash: "h1", count: 2, schemas: [{ name: "a" }, { name: "b" }] },
    sections: [
      { name: "identity", hash: "x", content: "0123456789" },
      { name: "toolUse", hash: "y", content: "abc" },
    ],
  };

  it("首轮含全量：展示工具数量与逐段字符数", () => {
    const ev = mkEvent("context/model-input", fullPayload, 10);
    render(<TrajectoryDetail event={ev} onClose={noop} allEvents={[ev]} />);

    expect(screen.getByText("模型输入（本轮）")).toBeDefined();
    expect(screen.getByText("工具清单")).toBeDefined();
    expect(screen.getByText("2 个（本轮含全量）")).toBeDefined();
    expect(byExactText("identity · 10 字符")).toBeDefined();
    expect(byExactText("toolUse · 3 字符")).toBeDefined();
  });

  it("引用式（内容未变）：如实展示引用 seq，不谎称含全量", () => {
    const first = mkEvent("context/model-input", fullPayload, 10);
    const second = mkEvent(
      "context/model-input",
      {
        tools: { hash: "h1", count: 2 },
        toolsRefSeq: 10,
        sections: [{ name: "identity", hash: "x", refSeq: 10 }],
      },
      20,
    );
    render(
      <TrajectoryDetail
        event={second}
        onClose={noop}
        allEvents={[first, second]}
      />,
    );

    // 工具行：即便引用已被一跳还原，UI 仍按 refSeq 如实标注"引用"
    expect(screen.getByText("引用 seq=10（内容未变）")).toBeDefined();
    expect(byExactText("identity · 引用 seq=10（未变）")).toBeDefined();
    expect(screen.queryByText(/本轮含全量/)).toBeNull();
  });

  it("引用超出当前窗口：仍如实展示引用，不伪造正文", () => {
    const ev = mkEvent(
      "context/model-input",
      {
        tools: { hash: "h1", count: 2 },
        toolsRefSeq: 1,
        sections: [{ name: "identity", hash: "x", refSeq: 1 }],
      },
      20,
    );
    render(<TrajectoryDetail event={ev} onClose={noop} allEvents={[ev]} />);

    expect(screen.getByText("引用 seq=1（内容未变）")).toBeDefined();
    expect(byExactText("identity · 引用 seq=1（未变）")).toBeDefined();
    expect(screen.queryByText(/字符/)).toBeNull();
  });

  it("未传 allEvents：不展示该分区（无法解析引用，不做半截展示）", () => {
    const ev = mkEvent("context/model-input", fullPayload, 10);
    render(<TrajectoryDetail event={ev} onClose={noop} />);
    expect(screen.queryByText("模型输入（本轮）")).toBeNull();
  });

  it("非该类型事件：不展示模型输入分区", () => {
    const ev = mkEvent("assistant/text", { content: "正文" }, 10);
    render(<TrajectoryDetail event={ev} onClose={noop} allEvents={[ev]} />);
    expect(screen.queryByText("模型输入（本轮）")).toBeNull();
  });
});
