/**
 * P2-9（2026-11-05）：顶栏只允许**一行**
 *
 * 现场：`/chat` 原先上方是全局 `Header`（品牌 + 搜索/帮助/通知），下方再渲染
 * `SessionHeader`（会话标题 / 轮次 / 导出）⇒ 两行 ~96px，窄屏尤其挤。
 *
 * 口径（本轮裁定）：三者都**不迁移**，只合并行高 ——
 *  - 品牌保留在最左；
 *  - 全局搜索 / 帮助 / 通知保留在右；
 *  - 会话标题 / 轮次 / 导出内联进同一条 56px 顶栏（仅 `/chat`）。
 *
 * 手法：源码扫描（同 `navigationBoundary.test.ts` 的既有做法）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");

const headerSrc = read("../components/common/Header.tsx");
const chatLayoutSrc = read("../components/layout/ChatPageLayout.tsx");
const sessionHeaderSrc = read("../components/ChatArea/SessionHeader.tsx");

describe("P2-9：/chat 只有一行顶栏", () => {
  it("聊天页不再渲染第二行 SessionHeader", () => {
    expect(chatLayoutSrc).not.toContain("<SessionHeader");
  });

  it("全局顶栏在 /chat 内联会话信息", () => {
    expect(headerSrc).toContain('pathname === "/chat"');
    expect(headerSrc).toContain("<SessionHeader inline />");
  });

  it("全局动作仍常驻右侧（搜索 / 帮助 / 通知未被合并掉）", () => {
    expect(headerSrc).toContain("APP_EVENTS.openGlobalSearch");
    expect(headerSrc).toContain('navigate("/help")');
    expect(headerSrc).toContain("openPanel");
  });

  it("内联形态不带背景/边框（避免出现第二条视觉分隔）", () => {
    expect(sessionHeaderSrc).toContain('inline ? "div" : "header"');
    expect(sessionHeaderSrc).toContain(
      "relative flex flex-1 items-center justify-between gap-3 min-w-0",
    );
  });
});
