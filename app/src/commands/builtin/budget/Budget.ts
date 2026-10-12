/**
 * Budget 命令 —— 日 Token 限额（查看 / 放行 / 改上限）
 *
 * 与桌面端「用量中心 → 日限额」**同一事实源**（`DailyBudgetManager` 进程单例）与**同一配置键**
 *（`DAILY_BUDGET_CONFIG_KEY`）；CLI 是**进程内**入口 ⇒ 改动**当场生效**并持久化（重启后仍生效）。
 * 撞限时各入口的提示文案即指向本命令（G-2/M 的终端出路）。
 */
import { getLogger } from '@modules/monitoring';
import { setConfigValue } from '@modules/config';
import {
  DAILY_BUDGET_CONFIG_KEY,
  getDailyBudget,
  isValidDailyLimit,
} from '../../../query/DailyBudgetManager';

const logger = getLogger('commands:builtin:budget');

export interface BudgetResult {
  type: 'text';
  value: string;
}

const USAGE = [
  '日 Token 限额（本地日统计；与桌面端「用量中心 → 日限额」同源）',
  '',
  '  /budget                     查看状态',
  '  /budget status              同上',
  '  /budget boost [倍数] [分钟] 临时提额（默认 ×2 / 60 分钟；到期自动恢复原上限）',
  '  /budget waive               放行**下一次**发送（一次性；未消费 10 分钟后作废）',
  '  /budget unlock              今日不再拦截（软上限 = 原上限 ×5，次日恢复）',
  '  /budget revoke              撤销放行（恢复配置上限；**保留**今日用量与欠账）',
  '  /budget set <token 上限>    改日上限（当场生效 + 持久化）',
].join('\n');

/** 档位 → 人读 */
const MODE_LABEL: Record<string, string> = {
  normal: '正常',
  report_only: '告警（仅提示）',
  locked: '已锁定（拒绝新调用）',
};

/** 放行类型 → 人读 */
const RELIEF_LABEL: Record<string, string> = {
  boost: '临时提额',
  'waive-once': '单次豁免',
  'unlock-today': '今日解除',
};

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export class BudgetCommand {
  async call(args: string): Promise<BudgetResult> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0] ?? 'status';
    const rest = parts.slice(1);
    try {
      switch (sub) {
        case 'status':
          return { type: 'text', value: this.status() };
        case 'boost':
          return { type: 'text', value: this.boost(rest) };
        case 'waive':
          return { type: 'text', value: this.waive() };
        case 'unlock':
          return { type: 'text', value: this.unlock() };
        case 'revoke':
          return { type: 'text', value: this.revoke() };
        case 'set':
          return { type: 'text', value: this.setLimit(rest) };
        default:
          return { type: 'text', value: `未知子命令：${sub}\n\n${USAGE}` };
      }
    } catch (e) {
      logger.warning('budget 命令执行失败', {
        sub,
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        type: 'text',
        value: `执行失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /** 硬锁优先（D-e）：放行不覆盖硬锁 ⇒ 提示用户去桌面端解除（本命令不提供硬锁开关） */
  private killSwitchWarning(): string {
    return getDailyBudget().isKillSwitchEnabled()
      ? '\n  ⚠️ 硬锁（kill-switch）已开启：放行不生效（硬锁优先）；请在桌面端「用量中心 → 日限额」解除。'
      : '';
  }

  private status(): string {
    const budget = getDailyBudget();
    const state = budget.getMode();
    const relief = budget.getRelief();
    const effectiveLimit = relief?.effectiveLimit ?? state.dailyLimit;
    const debt = budget.getDebtTokens();
    const reliefText = relief
      ? `${RELIEF_LABEL[relief.kind] ?? relief.kind}${
          relief.expiresAt
            ? `（到期 ${new Date(relief.expiresAt).toLocaleTimeString()}）`
            : '（至今日结束）'
        }`
      : '无';

    return [
      `日 Token 限额（${budget.currentDate()}）`,
      `  档位：${MODE_LABEL[state.mode] ?? state.mode}`,
      `  已用 / 上限：${fmt(state.todayUsed)} / ${fmt(state.dailyLimit)}（${(
        state.percentUsed * 100
      ).toFixed(1)}%）`,
      `  当前有效上限：${fmt(effectiveLimit)}`,
      `  今日剩余：${fmt(state.remaining)}`,
      `  透支欠账：${fmt(debt)}${debt > 0 ? '（次日从可用额度扣回）' : ''}`,
      `  当前放行：${reliefText}`,
      `  硬锁：${budget.isKillSwitchEnabled() ? '已开启' : '未开启'}`,
    ].join('\n');
  }

  private boost(rest: string[]): string {
    const rawFactor = rest[0];
    const rawMinutes = rest[1];
    const factor = rawFactor === undefined ? undefined : Number(rawFactor);
    const minutes = rawMinutes === undefined ? undefined : Number(rawMinutes);
    if (factor !== undefined && (!Number.isFinite(factor) || factor <= 1)) {
      return `倍数需 > 1（收到：${rawFactor}）\n\n${USAGE}`;
    }
    if (minutes !== undefined && (!Number.isFinite(minutes) || minutes <= 0)) {
      return `时长需为正数分钟（收到：${rawMinutes}）\n\n${USAGE}`;
    }

    const budget = getDailyBudget();
    const before = budget.getMode().dailyLimit;
    const view = budget.applyRelief({
      kind: 'boost',
      ...(factor !== undefined ? { factor } : {}),
      ...(minutes !== undefined ? { ttlMs: Math.round(minutes * 60_000) } : {}),
    });
    return (
      `已临时提额：有效上限 ${fmt(before)} → ${fmt(view.effectiveLimit)}` +
      (view.expiresAt
        ? `（到期自动恢复：${new Date(view.expiresAt).toLocaleTimeString()}）`
        : '') +
      this.killSwitchWarning()
    );
  }

  private waive(): string {
    const budget = getDailyBudget();
    budget.applyRelief({ kind: 'waive-once' });
    return (
      '已放行**下一次**发送：一次性通行证（被消费即失效；未消费 10 分钟后自动作废）。' +
      '超出的消耗会计入欠账，次日从可用额度扣回。' +
      this.killSwitchWarning()
    );
  }

  private unlock(): string {
    const budget = getDailyBudget();
    const view = budget.applyRelief({ kind: 'unlock-today' });
    return (
      `今日不再拦截：有效上限 ${fmt(view.effectiveLimit)}（= 原上限 ×5 的软上限，次日自动恢复）。` +
      this.killSwitchWarning()
    );
  }

  /**
   * 撤销放行（D-b 对称回路，2026-10-12）：清全部在途放行、恢复**配置上限**；
   * **不动**今日用量与欠账（区别于 `reset`）。无放行时为幂等 no-op。
   */
  private revoke(): string {
    const budget = getDailyBudget();
    const before = budget.getRelief();
    budget.clearRelief();
    if (!before) {
      // 无 reliefState 也仍可能持有 waive-once 通行证（公开 API 不暴露）⇒ 文案如实，不断言"什么都没有"
      return '当前没有生效的放行；已清空在途放行（若有）。今日用量与欠账保留。';
    }
    return `已撤销放行（${RELIEF_LABEL[before.kind] ?? before.kind}）：有效上限恢复为配置值 ${fmt(
      budget.getMode().dailyLimit
    )}（今日用量与欠账保留）。`;
  }

  private setLimit(rest: string[]): string {
    const limit = Number(rest[0]);
    if (!isValidDailyLimit(limit)) {
      return `上限需为正整数（收到：${rest[0] ?? '(空)'}）\n\n${USAGE}`;
    }

    const budget = getDailyBudget();
    const before = budget.getMode().dailyLimit;
    // 1) 运行期热更新（当场生效）；2) 持久化（重启后仍生效）—— 与 HTTP PUT 同一配置键
    budget.applyConfig({ dailyLimit: limit });
    const cfg = budget.getConfigSnapshot();
    setConfigValue(DAILY_BUDGET_CONFIG_KEY, {
      dailyLimit: cfg.dailyLimit,
      warningThreshold: cfg.warningThreshold,
      lockThreshold: cfg.lockThreshold,
    });
    return `日上限已更新：${fmt(before)} → ${fmt(
      limit
    )}（当场生效，且已持久化 ⇒ 重启后仍生效）`;
  }
}

export default new BudgetCommand();
