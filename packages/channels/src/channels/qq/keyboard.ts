/**
 * keyboard.ts — QQ「消息按钮」载荷构造（**纯函数**，便于单测）
 *
 * 依据 QQ 官方文档「消息按钮」：`keyboard.content.rows[].buttons[]`，每按钮
 * `id?` + `render_data{label,visited_label,style}` + `action{type,permission{type},data,unsupport_tips}`。
 *
 * - `action.type`：**0 跳转 / 1 回调（data 交后台）/ 2 指令** ⇒ 本通道用 **1**（回调）；
 * - `permission.type`：0 指定用户 / 1 仅管理员 / **2 所有人** ⇒ 用 **2**（放行按钮面向会话主人）；
 * - ⚠️ **自定义按钮属平台「内邀开通」能力**（模版按钮需「申请使用」）⇒ 调用方必须容忍发送失败并降级。
 *
 * 事件侧：点击回调按钮 ⇒ `INTERACTION_CREATE`（`type=11`），`data.resolved.button_data` = 本处的 `data`。
 */

import type { InteractiveCard } from '../types/IChannel';

/** QQ 一行最多 5 个按钮（官方约束） */
const MAX_BUTTONS_PER_ROW = 5;

interface QQKeyboardButton {
  id: string;
  render_data: { label: string; visited_label: string; style: number };
  action: {
    type: 1;
    permission: { type: 2 };
    data: string;
    unsupport_tips: string;
  };
}

/**
 * 把通道中立的 `InteractiveCard.buttons` 翻成 QQ `keyboard` 值；无按钮 ⇒ `null`（调用方不带该字段）。
 *
 * `style`：QQ 只区分 0 灰色线框 / 1 蓝色线框 ⇒ 仅 `primary` 映射为 1，其余 0（**不猜**更多样式）。
 */
export function buildQQKeyboard(
  card: InteractiveCard
): { content: { rows: Array<{ buttons: QQKeyboardButton[] }> } } | null {
  const buttons = card.buttons ?? [];
  if (buttons.length === 0) return null;

  const mapped: QQKeyboardButton[] = buttons
    .slice(0, MAX_BUTTONS_PER_ROW)
    .map((b, i) => ({
      id: `btn-${i + 1}`,
      render_data: {
        label: b.text,
        visited_label: b.text,
        style: b.style === 'primary' ? 1 : 0,
      },
      action: {
        type: 1,
        permission: { type: 2 },
        data: b.value,
        unsupport_tips:
          '当前客户端不支持该按钮，请在 Liri 桌面端「用量中心 → 日限额」放行。',
      },
    }));

  return { content: { rows: [{ buttons: mapped }] } };
}
