/**
 * `CommandResult` → 展示文本（**单一实现**）
 *
 * 收敛原先散落各处的 `result.message || result.value || …` 取值口径（2026-10-16，方案①/③）：
 * 此前 `ChatOrchestrator._handleCommand` 与命令行入口各写一份，且**都丢掉了 `error`** ——
 * 实测：打错命令（如 `/budgett`）时 `CommandManager` 以 `{success:false, error:'Command not found: …'}`
 * 返回（**不抛**），而正文取 `message || value` 恰为空 ⇒ 聊天里回一条**空消息**（既不报错也无提示）。
 *
 * 判据说明：`success !== false` 视为成功（与 `commands-handlers.ts` 的 HTTP 口径一致）；
 * 失败时正文取 `message → value → error`（后两者用于命令实现自己给的 fail-loud 文案）；
 * 成功但无任何正文 ⇒ `（命令无输出）`（**禁止**回空消息，避免"看起来没反应"）。
 */
import type { CommandResult } from './types/index.js';

export interface CommandDisplay {
  /** 命令是否执行成功 */
  ok: boolean;
  /** 展示文本（已保证非空） */
  text: string;
}

export function formatCommandResult(result: CommandResult): CommandDisplay {
  const ok = result.success !== false;

  if (!ok) {
    return {
      ok,
      text: `❌ ${
        result.message || result.value || result.error || '命令执行失败'
      }`,
    };
  }

  const text =
    result.message ||
    result.value ||
    (result.data !== undefined ? JSON.stringify(result.data, null, 2) : '');

  return { ok, text: text || '（命令无输出）' };
}
