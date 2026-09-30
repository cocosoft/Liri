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

/** 命令执行结果投影（调用方读 `value` / `message` / `type` / `success`） */
export interface CommandResultDto {
  /** app 侧为 `string`（原码 `value?.toString()`） */
  value?: string | undefined;
  message?: string | undefined;
  /** app 侧为字面量联合（原码与 `'error'` 比较） */
  type?: string | undefined;
  success?: boolean | undefined;
}

/** 命令运维端口 */
export interface CommandsOpsPort {
  /** 原 `getCommandManager().getAllCommands()` */
  listCommands(): Promise<CommandBriefDto[]>;
  /** 原 `commandExecutor.execute(command)`（不传 `context` —— 原调用点即无第二参） */
  executeCommand(command: string): Promise<CommandResultDto>;
}
