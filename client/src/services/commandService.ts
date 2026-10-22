/**
 * 命令服务（commandService）—— 前端调用**后端已注册命令**的唯一入口
 *
 * 背景（2026-10-22）：后端有 `GET /v1/commands` 与 `POST /v1/commands/execute`，
 * 但前端一直没有任何调用方 ⇒ 只有 CLI / 斜杠命令能用，GUI 用户看不到这些能力
 * （盘点见 `dev_docs/20261022/workbench-audit/command-coverage.ts`）。
 *
 * 本服务只做"透传"，**不复制命令逻辑**（实现唯一性）：摘要、洞察等能力仍由后端命令实现，
 * 前端负责触发与展示。
 */

import { unwrapOrThrow, http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";

/** 命令执行结果（与 `commands-handlers.ts` 的响应字段逐一对应） */
export interface CommandRunResult {
  success: boolean;
  /** 命令的文本输出（`result.value` / `result.message`） */
  output: string;
  /** 命令级错误（`result.type === 'error'` 时与 output 相同） */
  error: string;
  /**
   * 结构化载荷（2026-10-23，方案 B）。
   *
   * 仅 `execute` 形态命令提供（如 `insights report`）；`call` 形态命令的 `data`
   * 是 `{ type, value }` 文本包装。调用方按需收窄，不保证存在。
   */
  data?: unknown;
}

/**
 * 执行一条后端命令。
 *
 * @param command 命令字符串（可带参数，如 `brief --type=detailed`）
 * @param sessionId 会话级命令（如 `brief`）**必须**传，否则后端拿不到本会话消息
 */
export async function runCommand(
  command: string,
  sessionId?: string,
): Promise<CommandRunResult> {
  const res = await http.post<CommandRunResult>(ENDPOINTS.commands.execute, {
    command,
    session_id: sessionId,
  });
  return unwrapOrThrow(res);
}
