/**
 * 回复设置（详略 / 快速模式）的前端暴露面（2026-10-22）
 *
 * 背景：`/effort`、`/fast` 的后端链路已补齐（会话 metadata.effortLevel → system prompt 注入；
 * 全局 fastMode → `resolveSmartModel` 分流 quick），但 GUI 用户没有可点的入口。
 *
 * 本片把两者接进输入区，并锁住三条契约：
 *  ① 写路径**复用命令实现**（`effort <level>` / `fast on|off`），不另造一套状态写入；
 *  ② 详略必须带 `session_id`（会话级偏好），读的是会话 `metadata.effortLevel` 展平值；
 *  ③ 快速模式是全局偏好，读 `GET /v1/config/fastMode`，与会话无关。
 *
 * 手法：源码扫描（与 `commandExposure.test.ts` 同款，渲染成本高、接线更值得锁）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readClient = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");

const menuSrc = readClient("../components/ChatArea/ReplyPrefsMenu.tsx");
const inputSrc = readClient("../components/ChatArea/ChatInput.tsx");
const sessionServiceSrc = readClient("../services/sessionService.ts");
const typesSrc = readClient("../types/session.ts");

describe("回复设置菜单：写路径复用命令实现", () => {
  it("详略写入走 `effort <level>` 并带上当前会话 id", () => {
    // 分两段断言，避免在普通字符串里写模板占位（no-template-curly-in-string）
    expect(menuSrc).toContain("runCommand(`effort ");
    expect(menuSrc).toContain("`, sessionId)");
  });

  it("快速模式写入走 `fast on` / `fast off`（全局偏好，不带会话）", () => {
    expect(menuSrc).toContain('runCommand(next ? "fast on" : "fast off")');
  });

  it("失败不静默：两条路径都有 toast 提示", () => {
    expect(menuSrc).toContain('t("chat.effortUpdateFailed")');
    expect(menuSrc).toContain('t("chat.fastModeUpdateFailed")');
  });
});

describe("回复设置菜单：读路径", () => {
  it("快速模式读全局配置 fastMode（不猜状态）", () => {
    expect(menuSrc).toContain('configService.get("fastMode")');
    expect(menuSrc).toContain("res?.value === true");
  });

  it("详略读会话展平的 effortLevel，默认 auto", () => {
    expect(menuSrc).toContain('effortLevel ?? "auto"');
    expect(sessionServiceSrc).toContain("effortLevel:");
    expect(sessionServiceSrc).toContain("raw.metadata?.effortLevel");
  });

  it("会话类型暴露 effortLevel（与后端 metadata 同名字面量）", () => {
    expect(typesSrc).toContain("ReplyEffortLevel");
    expect(typesSrc).toContain("effortLevel?: ReplyEffortLevel");
  });
});

describe("输入区接线", () => {
  it("ChatInput 渲染菜单并把会话 id / 当前档位传下去", () => {
    expect(inputSrc).toContain('import ReplyPrefsMenu from "./ReplyPrefsMenu"');
    expect(inputSrc).toContain("<ReplyPrefsMenu");
    expect(inputSrc).toContain("sessionId={currentSession?.id}");
    expect(inputSrc).toContain("effortLevel={currentSession?.effortLevel}");
  });

  it("切换成功后就地更新会话缓存（后端广播仍为最终事实）", () => {
    expect(inputSrc).toContain("effortLevel: level");
  });
});
