// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 命令运维 —— **服务层端口**（C1「口径 C」：`commands` 域单点收尾；2026-09-30 台账 D-111）
 *
 * **范围（本批 = `commands-handlers.ts` 的 2 个动态导入）**。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：仅**调用方实际读字段**者给**最小投影 DTO**。
 */

/** 命令投影（调用方读 `name` / `description` / `aliases` / `argumentHint` / `userInvocable`） */
export interface CommandBriefDto {
  name: string;
  description?: string | undefined;
  aliases?: string[] | undefined;
  argumentHint?: string | undefined;
  userInvocable?: boolean | undefined;
}

/** 命令执行结果投影（调用方读 `value` / `message` / `type` / `success` / `data`） */
export interface CommandResultDto {
  /** app 侧为 `string`（原码 `value?.toString()`） */
  value?: string | undefined;
  message?: string | undefined;
  /** app 侧为字面量联合（原码与 `'error'` 比较） */
  type?: string | undefined;
  success?: boolean | undefined;
  /**
   * `call` / `execute` 两种实现形态的返回位置不同（2026-10-22 实测）：
   * `CommandManager` 对 `call` 形态包成 `{ success:true, data: result }`，
   * 而 `brief` / `help` 等返回的 `{ type:'text', value }` 落在 **`data.value`**。
   * 只读顶层 `value` 会得到空串（HTTP 200 + 空输出）。
   *
   * 类型保持 `unknown`（app 侧 `CommandResult.data` 即 `unknown`）⇒ 由 handler 在边界收窄。
   */
  data?: unknown;
}

/** 命令运维端口 */
export interface CommandsOpsPort {
  /** 原 `getCommandManager().getAllCommands()` */
  listCommands(): Promise<CommandBriefDto[]>;
  /**
   * 原 `commandExecutor.execute(command)`。
   *
   * 2026-10-22：新增可选 `sessionId` —— 原调用点无第二参，导致会话级命令（如 `brief` 摘要）
   * 拿不到 `context.sessionId`、`getSessionMessages(undefined)` 必然失败 ⇒ HTTP 侧传
   * `session_id` 后才能真正执行。不传时行为与旧实现逐字一致。
   */
  executeCommand(
    command: string,
    sessionId?: string
  ): Promise<CommandResultDto>;
}
