/**
 * Tips系统主入口
 */

export { getTipToShow, recordShownTip, selectTipWithLongestTimeSinceShown } from './tipScheduler';
export { getRelevantTips } from './tipRegistry';
export { recordTipShown, getSessionsSinceLastShown, initTipsHistory } from './tipHistory';
export type { Tip, TipContext } from './types';
