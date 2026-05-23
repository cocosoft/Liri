/**
 * 上下文提示机制（对标 Hermes onboarding.py）
 * 首次遇到特定行为时展示一次性提示，而非在 setup 阶段追问。
 * 提示状态通过配置系统持久化，每个提示只展示一次。
 */
import { getConfigValue, setConfigValue } from '@modules/config';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const HINT_PREFIX = 'onboarding.seen';

/**
 * 提示标识（stable — 用作配置键）
 */
export enum OnboardHintKey {
  /** 提醒用户可自定义 SOUL/USER */
  SOUL_CUSTOMIZATION = 'soul_customization',
  /** 提醒用户可配置消息通道 */
  CHANNEL_SETUP = 'channel_setup',
  /** 工具首次长时间运行进度提示 */
  TOOL_PROGRESS = 'tool_progress',
  /** 首次配置完成后快速入门指引 */
  FIRST_SETUP_COMPLETE = 'first_setup_complete',
}

function hintPath(key: OnboardHintKey): string {
  return `${HINT_PREFIX}.${key}`;
}

export function isHintSeen(key: OnboardHintKey): boolean {
  try {
    const value = getConfigValue<boolean>(hintPath(key));
    return value === true;
  } catch {
    return false;
  }
}

export function markHintSeen(key: OnboardHintKey): void {
  try {
    setConfigValue(hintPath(key), true);
  } catch (e) {
    logger.warn('标记提示已读失败', { key, error: String(e) });
  }
}

export function resetHint(key: OnboardHintKey): void {
  try {
    setConfigValue(hintPath(key), false);
  } catch (e) {
    logger.warn('重置提示状态失败', { key, error: String(e) });
  }
}

export function resetAllHints(): void {
  for (const key of Object.values(OnboardHintKey)) {
    try {
      setConfigValue(hintPath(key), false);
    } catch {
      // 忽略
    }
  }
}

/**
 * 如果提示尚未展示过，展示一次并标记。
 * 返回 true 表示已展示。
 */
export function showHintIfNeeded(
  key: OnboardHintKey,
  message: string
): boolean {
  if (isHintSeen(key)) return false;

  markHintSeen(key);
  console.log('');
  console.log(message);
  console.log('');
  return true;
}

/**
 * 提示内容 — SOUL/USER 自定义提醒
 * 在首次 AI 回复之后或在 Quick 模式下首次配置完成后展示
 */
export const HINT_SOUL_CUSTOMIZATION = `💡 提示（仅此一次）— 你可以自定义 AI 的说话风格和你的个人档案：
    编辑 ~/.pyapp/SOUL.md 设置 AI 人格（语气、风格、偏好）
    编辑 ~/.pyapp/USER.md 设置用户档案（称呼、语言、详细程度）
    运行 /onboard 选择完整配置重新进行交互式设置`;

/**
 * 提示内容 — 消息通道配置提醒
 */
export const HINT_CHANNEL_SETUP = `💡 提示（仅此一次）— PY_APP 支持连接消息平台：
    运行 /onboard 选择完整配置 → 步骤 5 设置 QQ/Telegram 等通道
    或在配置文件中手动编辑通道设置`;

/**
 * 获取已读/未读提示统计
 */
export function getHintStats(): {
  total: number;
  seen: number;
  hints: Record<string, boolean>;
} {
  const keys = Object.values(OnboardHintKey);
  const hints: Record<string, boolean> = {};
  let seen = 0;

  for (const key of keys) {
    const isSeen = isHintSeen(key);
    hints[key] = isSeen;
    if (isSeen) seen++;
  }

  return { total: keys.length, seen, hints };
}
