/**
 * UI图形字符常量
 *
 * D-2（2026-10-18）：40 个零消费者字形已删除（与 `messages.ts` / `xml.ts` / `betas.ts`
 * 同批下线）；仅保留仍有真实读取点的导出。
 *
 * @kind-default A
 */

export const UP_ARROW = '↑';
export const DOWN_ARROW = '↓';

// B5-2㊷：CHANNEL_ARROW 唯一真源（本 UI 图形字符库，←）；chat/ChannelMessageParser 的「消息来源箭头」（→）异值已按域消歧改名 MSG_SOURCE_ARROW
export const CHANNEL_ARROW = '←';

export const DIAMOND_OPEN = '◇';
export const DIAMOND_FILLED = '◆';

/**
 * ANSI SGR 重置序列（终端颜色/样式复位）。
 *
 * **唯一真源**（硬编码治理「同名常量」B2 收口）：原于 `cli/print.ts` 与 `commands/tasks/tasks.ts`
 * **各写一份**同名 `RESET` ⇒ 现统一由此导出（命名加 `ANSI_` 前缀消歧）。
 * 注：`print.ts` 的 ANSI 族其余成员（`BOLD` / `ITALIC` / `UNDERLINE` 等）**单处使用**、暂留本地。
 */
export const ANSI_RESET = '\x1b[0m';

export const ELLIPSIS = '…';
