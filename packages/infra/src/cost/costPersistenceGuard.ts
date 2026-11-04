/**
 * 成本落库的「测试来源」护栏（2026-11-04，附录 B2 未完成项）
 *
 * **要防的事（实测）**：`cost_records` 里出现过 `zzz-unknown-test-model`（1 次 **$18**）与
 * `test-model`（10 次）—— 来源是单测直接调 `costTracker.addCost(...)`，而 `COST_RECORDED`
 * 的订阅者照常 INSERT 进真实库 `~/.pyapp/data/app.db`。`query/dailyBudgetGate.ts` 以 USD 为
 * 唯一硬闸 ⇒ 一条 $18 的测试行足以吃掉当日额度，且用户完全无感。
 *
 * **与既有护栏同源（CS01）**：`app/src/ai/UsageTracker.ts#shouldSkipUsagePersistence()` 早已对
 * `model_usage_logs` 做同一判定；本函数是**infra 侧对成本表**的对应实现（app 层不能反向依赖，
 * 故不能直接复用，判据逐字对齐）：
 *   ① `NODE_ENV === 'test'`；
 *   ② 调用方**没有**显式隔离数据目录（`setUserDataDirOverride` / `LIRI_DATA_DIR` / `LIRI_HOME`）。
 * 两条同时成立 ⇒ 跳过落库。显式隔离的用例（写临时库并断言）行为完全不变。
 *
 * ⚠️ 只作用于**事件驱动的生产写入路径**（`cost/index.ts` 的 `COST_RECORDED` 订阅者）；
 * 直接 `new CostRecordRepository(':memory:')` 的单测不受影响。
 */
import { getUserDataDirOverride } from '@openliri/infra/environment';

export function shouldSkipCostEventPersistence(
  env: NodeJS.ProcessEnv = process.env,
  dataDirOverride: string | null = getUserDataDirOverride()
): boolean {
  if (env.NODE_ENV !== 'test') return false;
  if (dataDirOverride) return false;
  return !env.LIRI_DATA_DIR?.trim() && !env.LIRI_HOME?.trim();
}
