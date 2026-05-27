/**
 * Tips调度器
 * 选择合适的时机显示操作提示
 * */

import { getSessionsSinceLastShown, recordTipShown } from './tipHistory';
import { getRelevantTips } from './tipRegistry';
import type { Tip, TipContext } from './types';

/**
 * 选择距离上次显示时间最长的提示
 */
export function selectTipWithLongestTimeSinceShown(
  availableTips: Tip[]
): Tip | undefined {
  if (availableTips.length === 0) {
    return undefined;
  }

  if (availableTips.length === 1) {
    return availableTips[0];
  }

  const tipsWithSessions = availableTips.map((tip) => ({
    tip,
    sessions: getSessionsSinceLastShown(tip.id),
  }));

  tipsWithSessions.sort((a, b) => b.sessions - a.sessions);
  return tipsWithSessions[0]?.tip;
}

/**
 * 获取要显示的提示
 */
export async function getTipToShow(
  context?: TipContext
): Promise<Tip | undefined> {
  const tips = await getRelevantTips(context);
  if (tips.length === 0) {
    return undefined;
  }

  return selectTipWithLongestTimeSinceShown(tips);
}

/**
 * 记录提示已显示
 */
export function recordShownTip(tip: Tip): void {
  recordTipShown(tip.id);
}
