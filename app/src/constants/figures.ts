/**
 * UI图形字符常量
 */

export const BLACK_CIRCLE = '●';
export const BULLET_OPERATOR = '∙';
export const TEARDROP_ASTERISK = '✻';
export const UP_ARROW = '↑';
export const DOWN_ARROW = '↓';
export const LIGHTNING_BOLT = '↯';
export const EFFORT_LOW = '○';
export const EFFORT_MEDIUM = '◐';
export const EFFORT_HIGH = '●';
export const EFFORT_MAX = '◉';

export const PLAY_ICON = '▶';
export const PAUSE_ICON = '⏸';

export const REFRESH_ARROW = '↻';
// B5-2㊷：CHANNEL_ARROW 唯一真源（本 UI 图形字符库，←）；chat/ChannelMessageParser 的「消息来源箭头」（→）异值已按域消歧改名 MSG_SOURCE_ARROW
export const CHANNEL_ARROW = '←';
export const INJECTED_ARROW = '→';
export const FORK_GLYPH = '⑂';

export const DIAMOND_OPEN = '◇';
export const DIAMOND_FILLED = '◆';
export const REFERENCE_MARK = '※';

export const FLAG_ICON = '⚑';

export const BLOCKQUOTE_BAR = '▎';
export const HEAVY_HORIZONTAL = '━';

export const BRIDGE_SPINNER_FRAMES = ['·|·', '·/·', '·—·', '·\\·'];
export const BRIDGE_READY_INDICATOR = '·✔·';
export const BRIDGE_FAILED_INDICATOR = '×';

export const CHECKMARK = '✓';
export const CROSS = '✗';
export const ARROW_RIGHT = '→';
export const ARROW_LEFT = '←';
export const ARROW_UP = '↑';
export const ARROW_DOWN = '↓';

/**
 * ANSI SGR 重置序列（终端颜色/样式复位）。
 *
 * **唯一真源**（硬编码治理「同名常量」B2 收口）：原于 `cli/print.ts` 与 `commands/tasks/tasks.ts`
 * **各写一份**同名 `RESET` ⇒ 现统一由此导出（命名加 `ANSI_` 前缀消歧）。
 * 注：`print.ts` 的 ANSI 族其余成员（`BOLD` / `ITALIC` / `UNDERLINE` 等）**单处使用**、暂留本地。
 */
export const ANSI_RESET = '\x1b[0m';

export const DOT = '•';
export const ELLIPSIS = '…';
export const BULLET = '●';
export const MIDDLE_DOT = '·';

export const VERTICAL_BAR = '│';
export const HORIZONTAL_BAR = '─';
export const BOX_DRAWING_LIGHT_VERTICAL = '│';
export const BOX_DRAWING_LIGHT_HORIZONTAL = '─';

export const INFO_ICON = 'ℹ';
export const WARNING_ICON = '⚠';
export const ERROR_ICON = '❌';
export const SUCCESS_ICON = '✅';
export const QUESTION_ICON = '❓';
export const STAR_ICON = '★';
export const STAR_EMPTY_ICON = '☆';
