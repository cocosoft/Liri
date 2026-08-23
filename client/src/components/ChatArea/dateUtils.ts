import type { Message } from "../../types";
import { handleClientError } from "../../utils/handleError";

/**
 * P2-8 修复：formatDateLabel 支持 i18n（"今天/昨天" 不再硬编码中文）
 * 函数接收可选 t() 函数，调用方传入（如 useTranslation()）
 */
export function formatDateLabel(
  timestamp: number,
  t?: (key: string) => string,
): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();

    // 归一化到当天 0 点，比较日期差
    const dateDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    const nowDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const diffDays = Math.round((nowDay - dateDay) / (24 * 60 * 60 * 1000));

    // P2-8：t() 存在时用 i18n（复用已有 chat.today/yesterday），否则 fallback 硬编码中文
    if (diffDays === 0) return t ? t("chat.today") : "今天";
    if (diffDays === 1) return t ? t("chat.yesterday") : "昨天";

    // 同年不显示年份
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    if (year === now.getFullYear()) {
      return `${month}-${day}`;
    }

    return `${year}-${month}-${day}`;
  } catch (e) {
    handleClientError(e, {
      module: "components:chat:dateUtils",
      action: "formatDateLabel",
    });
    // 异常时返回空字符串，由调用方跳过日期分隔线
    return "";
  }
}

/**
 * 判断当前消息是否需要显示日期分隔线
 * 规则：当前消息与前一条消息不在同一天时显示
 * @param index 当前消息在列表中的索引
 * @param messages 完整消息列表
 * @returns 是否需要在当前消息前显示日期分隔线
 */
export function shouldShowDateSeparator(
  index: number,
  messages: Message[],
): boolean {
  if (messages.length === 0) return false;
  if (index < 0 || index >= messages.length) return false;
  if (index === 0) return false; // 第一条消息不显示分隔线，SessionHeader 已标明时间

  const current = messages[index];
  const previous = messages[index - 1];

  if (!current.timestamp || !previous.timestamp) return false;

  try {
    const currentDate = new Date(current.timestamp);
    const prevDate = new Date(previous.timestamp);

    const currentDay = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
    ).getTime();
    const prevDay = new Date(
      prevDate.getFullYear(),
      prevDate.getMonth(),
      prevDate.getDate(),
    ).getTime();

    return currentDay !== prevDay;
  } catch (e) {
    handleClientError(e, {
      module: "components:chat:dateUtils",
      action: "shouldShowDateSeparator",
    });
    return false;
  }
}
