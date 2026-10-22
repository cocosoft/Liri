/**
 * 窄屏状态栏布局（2026-10-22，768 平板巡检发现）
 *
 * **缺陷现场**：移动端底部导航是 `fixed bottom-0 z-50`（脱离文档流），而 `<Footer />`
 * 是 flex 列布局的最后一项 ⇒ 768×1024 实测 Footer y=992..1024、底栏 y=975..1024，
 * 状态栏**完全被压住**；同时状态栏内容宽 823px > 视口 768px，右侧 55px 被裁切。
 *
 * 修复口径：
 *  ① `App` 在 Footer 与底栏之间补等高占位（底栏 fixed，不占文档流）；
 *  ② Footer 内容按 `lg` 断点收敛：窄屏只保留「后端状态 + 停止/启动」。
 *
 * 手法：源码扫描（与 `navigationBoundary.test.ts` 同款，渲染成本高、接线更值得锁）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readClient = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");

const appSrc = readClient("../App.tsx");
const footerSrc = readClient("../components/common/Footer.tsx");

describe("窄屏状态栏：与移动底栏共存", () => {
  it("App 在 Footer 与 MobileBottomNav 之间让出底栏高度", () => {
    const footerAt = appSrc.indexOf("<Footer />");
    const spacerAt = appSrc.indexOf("lg:hidden h-[50px] shrink-0");
    const navAt = appSrc.indexOf("<MobileBottomNav />");
    expect(footerAt).toBeGreaterThan(-1);
    expect(spacerAt).toBeGreaterThan(footerAt);
    expect(navAt).toBeGreaterThan(spacerAt);
  });

  it("Footer 根节点裁掉溢出（原内容宽 823 > 768 视口）", () => {
    expect(footerSrc).toContain("select-none relative overflow-hidden");
  });

  it("窄屏隐藏 CPU/MEM/端口/模型/Token 等密集段落（lg 断点）", () => {
    // 4 条分隔线 + 4 个指标块都必须带 lg 断点，避免窄屏只剩分隔线
    const separators = footerSrc.match(/hidden lg:block w-px h-3 bg-gray-300/g);
    expect(separators?.length).toBe(4);
    expect(footerSrc).toContain("hidden lg:inline text-gray-400"); // 端口
    expect(footerSrc).toContain("hidden lg:flex items-center gap-1"); // CPU/MEM
    expect(footerSrc).toContain("hidden lg:inline text-orange-500"); // 今日消费
  });

  it("后端状态与启停按钮在窄屏仍然可见（不参与隐藏）", () => {
    expect(footerSrc).toContain("Backend {getStatusText()}");
    expect(footerSrc).toContain('t("common.stop")');
  });
});
