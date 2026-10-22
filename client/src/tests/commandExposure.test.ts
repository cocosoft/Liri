/**
 * 后端命令的前端暴露面（2026-10-22 首片 brief → 2026-10-23 方案 B 合并为 `insights report`）
 *
 * 背景：后端有 `POST /v1/commands/execute`，但前端一直**零调用方** ⇒ 命令类能力只能 CLI/斜杠用。
 * 现在聊天页的「会话洞察」入口调用 `insights report`，并锁住三条契约：
 *  ① 会话级命令必须带 `session_id`；
 *  ② 后端 handler 必须把 `data` 透出（否则面板拿不到结构化载荷）；
 *  ③ 前端服务层必须声明 `data` 字段。
 *
 * 手法：源码扫描（与 `navigationBoundary.test.ts` 同款，渲染成本高、接线更值得锁）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readClient = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");
const readApp = (rel: string): string =>
  readFileSync(resolve(__dirname, "../../..", rel), "utf-8");

const endpointsSrc = readClient("../services/endpoints.ts");
const commandServiceSrc = readClient("../services/commandService.ts");
const messageListSrc = readClient("../components/ChatArea/ChatMessageList.tsx");
const commandsHandlerSrc = readApp(
  "app/src/infrastructure/http/handlers/commands-handlers.ts",
);

describe("会话洞察（后端 insights 命令）的前端接线", () => {
  it("端点常量存在且指向 /v1/commands/execute", () => {
    expect(endpointsSrc).toContain('execute: "/v1/commands/execute"');
  });

  it("服务层透传 session_id（会话级命令不带它必然失败）", () => {
    expect(commandServiceSrc).toContain("session_id: sessionId");
    expect(commandServiceSrc).toContain("ENDPOINTS.commands.execute");
  });

  it("服务层声明结构化 data（方案 B）", () => {
    expect(commandServiceSrc).toContain("data?: unknown");
  });

  it("聊天列表工具栏有洞察入口，且把当前会话 id 传下去", () => {
    expect(messageListSrc).toContain(
      'runCommand("insights report", currentSessionId)',
    );
    expect(messageListSrc).toContain('t("chat.insights")');
    expect(messageListSrc).toContain("SessionInsightsModal");
  });

  it("后端 handler 把 session_id 透传给命令执行器", () => {
    expect(commandsHandlerSrc).toContain("session_id");
    expect(commandsHandlerSrc).toContain("executeCommand(command, sessionId)");
  });

  it("后端 handler 透出结构化 data（缺省不带该字段）", () => {
    expect(commandsHandlerSrc).toContain("data: result.data");
    expect(commandsHandlerSrc).toContain("result.data === undefined");
  });
});
