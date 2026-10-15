/**
 * T14（遗留 #5，用户裁定"做（含改上限）"）：**`/budget` 一等 CLI 命令**。
 *
 * 与桌面端「用量中心 → 日限额」同源（`DailyBudgetManager` 单例 + 同一配置键）；CLI 是进程内入口
 * ⇒ 改动**当场生效**，`set` 额外**持久化**（重启后仍生效）。撞限文案的终端出路即指向本命令。
 *
 * 隔离：spy `getConfigManager().setConfigValue` 拦截持久化写盘（仅断言调用参数，不污染真实配置）。
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { getConfigManager } from '@modules/config';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { BudgetCommand } from '../../src/commands/builtin/budget/Budget';

const LIMIT = 100;
const CONFIG_KEY = 'costControl.dailyTokenBudget';

describe('T14：/budget 命令（查看 / 放行 / 改 Token 观测阈值）', () => {
  let writeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetDailyBudgetForTest();
    getDailyBudget().setLimit(LIMIT);
    writeSpy = spyOn(getConfigManager(), 'setConfigValue').mockImplementation(
      () => {}
    );
  });
  afterEach(() => {
    writeSpy.mockRestore();
    resetDailyBudgetForTest();
  });

  it('status（**未配金额上限**）：明示无闸门 + 阈值口径 + 欠账/放行/硬锁', async () => {
    const { value } = await new BudgetCommand().call('');

    expect(value).toContain('每日预算限额');
    // 2026-10-15：Token 轨只观测、不启用闸门 ⇒ 必须**显式说明当前无闸门**
    expect(value).toContain('闸门：**未启用**（未配置金额上限）');
    expect(value).toContain('档位：观测（不拦截）'); // 无闸门 ⇒ 不显示「正常/锁定」
    expect(value).toContain('已用 / Token 观测阈值：0 / 100');
    expect(value).toContain('今日剩余：100（按观测阈值基座）');
    // 无闸门 ⇒ 不展示「当前有效阈值」（relief 只作用于闸门，展示即与阈值行矛盾）
    expect(value).not.toContain('当前有效阈值');
    expect(value).toContain('透支欠账：0');
    expect(value).toContain('当前放行：无');
    expect(value).toContain('硬锁：未开启');
  });

  it('status（无闸门 + 放行生效）⇒ 观测口径仍按**基座**（不被 relief ×5 抬高）', async () => {
    // 真机 E2E（2026-10-15）：`unlock-today` 生效时，无闸门状态曾显示「当前有效阈值 150,000,000 /
    // 今日剩余 136,788,517」，与「Token 观测阈值 30,000,000」自相矛盾（观测告警也用基座）。
    const budget = getDailyBudget();
    budget.recordUsage(20);
    await new BudgetCommand().call('unlock'); // ×5 ⇒ 有效值 500，但观测口径**不得**跟随

    const { value } = await new BudgetCommand().call('status');

    expect(value).toContain('档位：观测（不拦截）');
    expect(value).toContain('已用 / Token 观测阈值：20 / 100');
    expect(value).toContain('今日剩余：80（按观测阈值基座）');
    expect(value).not.toContain('当前有效阈值');
    expect(value).not.toContain('500'); // relief 抬高值不得出现
  });

  it('status（**已配金额上限**）：闸门=金额已启用 + 档位按金额 + Token 轨观测行', async () => {
    const budget = getDailyBudget();
    budget.setLimitUsd(10);
    budget.recordUsdUsage(1); // 1/10 = 10% ⇒ normal

    const { value } = await new BudgetCommand().call('status');

    expect(value).toContain('闸门：金额（USD）—— **已启用**');
    expect(value).toContain('档位：正常');
    expect(value).toContain('已用 / 上限：$1.00 / $10.00');
    expect(value).toContain('Token 轨（**观测**，不参与判定）');
  });

  it('boost 3 30 ⇒ 有效上限 ×3 + 到期时间（当场生效）', async () => {
    const { value } = await new BudgetCommand().call('boost 3 30');

    expect(value).toContain('已临时提额');
    const relief = getDailyBudget().getRelief();
    expect(relief?.kind).toBe('boost');
    expect(relief?.effectiveLimit).toBe(LIMIT * 3);
    expect(relief?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('boost 参数非法 ⇒ fail-loud 用法提示（不放行、不改上限）', async () => {
    const { value } = await new BudgetCommand().call('boost 1');

    expect(value).toContain('倍数需 > 1');
    expect(getDailyBudget().getRelief()).toBeNull();
  });

  it('unlock ⇒ 今日解除（软上限 = 原上限 ×5）', async () => {
    const { value } = await new BudgetCommand().call('unlock');

    expect(value).toContain('今日不再拦截');
    expect(getDailyBudget().getRelief()?.effectiveLimit).toBe(LIMIT * 5);
  });

  it('waive ⇒ 一次性放行（不改有效上限，通行证可被消费一次）', async () => {
    const { value } = await new BudgetCommand().call('waive');

    expect(value).toContain('下一次');
    expect(getDailyBudget().getRelief()).toBeNull();
    expect(getDailyBudget().consumeWaiveOnce('s-cli')).toBe(true);
  });

  it('set 200 ⇒ 当场生效 + 持久化到同一配置键', async () => {
    const { value } = await new BudgetCommand().call('set 200');

    expect(value).toContain('Token 观测阈值已更新');
    expect(getDailyBudget().getMode().dailyLimit).toBe(200);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [key] = writeSpy.mock.calls[0] as unknown as [string, unknown];
    expect(key).toBe(CONFIG_KEY);
  });

  it('set 非法 / 未知子命令 ⇒ 用法提示且**不改配置**', async () => {
    const invalid = await new BudgetCommand().call('set abc');
    expect(invalid.value).toContain('阈值需为正整数');

    const unknown = await new BudgetCommand().call('whatever');
    expect(unknown.value).toContain('未知子命令');

    expect(getDailyBudget().getMode().dailyLimit).toBe(LIMIT);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('revoke ⇒ 撤销放行（恢复配置上限），且**不动**今日用量', async () => {
    const budget = getDailyBudget();
    budget.recordUsage(80);
    await new BudgetCommand().call('unlock');
    expect(budget.getRelief()?.effectiveLimit).toBe(LIMIT * 5);

    const { value } = await new BudgetCommand().call('revoke');
    expect(value).toContain('已撤销放行');
    expect(budget.getRelief()).toBeNull();
    expect(budget.getMode().dailyLimit).toBe(LIMIT); // 回配置上限
    expect(budget.getMode().todayUsed).toBe(80); // 用量保留（≠ reset）
  });

  it('revoke：无放行时幂等（如实提示，不报错）', async () => {
    const { value } = await new BudgetCommand().call('revoke');
    expect(value).toContain('当前没有生效的放行');
  });
});
