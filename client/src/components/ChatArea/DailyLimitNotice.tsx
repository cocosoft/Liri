/**
 * DailyLimitNotice —— 日预算**撞限卡片**（Spec `daily-budget-over-limit-ux.md` §5-A）。
 *
 * **设计要点**
 * - 撞限是**本机环境状态**，不是"异常" ⇒ 卡片**不用红色错误语义**（D-a），也不落盘为会话消息（D-l）。
 * - 就地把"接着用"的口子给出来（D-b）：临时提额 / 单次豁免 / 当日解除；外加直达限额设置（D-h）。
 * - 「继续」是**显式**动作（D-f）：**不**静默自动重发被拦的那条消息。
 * - 文案经 `t` prop 由**宿主**注入：组件不自行引入 i18n 实例（便于单测，也避免多实例）。
 */
export type DailyLimitReliefKind = 'boost' | 'waive-once' | 'unlock-today';

export interface DailyLimitNoticeProps {
  /** 今日已用量（tokens） */
  used: number;
  /** 当前**有效**上限（relief 生效时为提高后的上限） */
  limit: number;
  /** 已用量的展示串（如 `"901.2 K Tokens"`） */
  formatted: string;
  /** 档位（`locked` / `report_only`） */
  mode: string;
  /** 文案函数（宿主注入，如 i18n `t`） */
  t: (key: string) => string;
  /** 放行：交给宿主调 `POST /v1/cost/daily-budget/relief` */
  onRelief: (kind: DailyLimitReliefKind) => void;
  /** 显式重发被拦的那条消息（D-f） */
  onContinue: () => void;
  /** 直达限额设置面（D-h） */
  onOpenSettings: () => void;
  /** 关闭卡片 */
  onDismiss: () => void;
}

const ACTIONS: Array<{ kind: DailyLimitReliefKind; key: string }> = [
  { kind: 'boost', key: 'cost.action.boost' },
  { kind: 'waive-once', key: 'cost.action.waiveOnce' },
  { kind: 'unlock-today', key: 'cost.action.unlockToday' },
];

export default function DailyLimitNotice({
  used,
  limit,
  formatted,
  mode,
  t,
  onRelief,
  onContinue,
  onOpenSettings,
  onDismiss,
}: DailyLimitNoticeProps) {
  return (
    <div
      className="p-4 bg-amber-50 dark:bg-amber-900/30 backdrop-blur-xl border border-amber-200 dark:border-amber-800 rounded-xl shadow-lg"
      role="status"
      data-testid="daily-limit-notice"
      data-mode={mode}
    >
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 mt-0.5">⛽</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <span>{t('cost.card.used')}</span>{' '}
            <span className="font-mono">{used}</span>
            <span className="mx-1">/</span>
            <span className="font-mono">{limit.toLocaleString()}</span>
            <span className="ml-2 opacity-80">{formatted}</span>
          </div>
          <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/80 whitespace-pre-line">
            {t('cost.card.hint')}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            {ACTIONS.map(({ kind, key }) => (
              <button
                key={kind}
                onClick={() => onRelief(kind)}
                className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-700/50 transition-colors"
              >
                {t(key)}
              </button>
            ))}
            <button
              onClick={onOpenSettings}
              className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-800/50 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-700/50 transition-colors"
            >
              {t('cost.action.openSettings')}
            </button>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onContinue}
              className="text-xs px-3 py-1 rounded bg-amber-500/90 text-white hover:bg-amber-500 transition-colors"
            >
              ▶ {t('cost.action.continue')}
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 flex-shrink-0"
          title={t('common.close')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
