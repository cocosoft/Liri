/**
 * 0a 单一事实源收敛（M-0，2026-09-22）
 *
 * 背景：同一批 run 同时活在**内存台账** `AgentRunLedger`、**磁盘** `AgentRunStore`、
 * **引擎** `SubAgentEngine.activeAgents` 三处；控制面靠 `getAgentStatus` 两层回落打补丁，
 * 且并行批次 worker（id = `${batchId}::${taskKey}`）**只登记在引擎**、台账看不见 ⇒
 * 同一 run 在不同层可见性不一致（母根因）。
 *
 * 本批收敛（不加新机制）：
 * 1. 台账新增 `ensureCoveredRun()` —— 引擎入口统一登记（幂等、`weight: 0` 不重复占额度）；
 * 2. 台账新增 `hasLiveRunsForSession()` —— "是否仍应等待"的**单一谓词**；
 * 3. 引擎 `hasActiveAgentForSession` / `ownerSessionId` **改为委托台账**；
 * 4. 引擎 3 个结束点收敛为 `endRun()`（台账落终态 + 释放本地句柄），不留悬挂条目。
 *
 * 断言均为"**修复前必失败**"型：
 * - `hasLiveRunsForSession` 在修复前对 worker 恒 false（worker 不进台账）；
 * - 引擎两个判据在修复前只认自持 Map ⇒ 台账里存在的 run 引擎答不出。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../../src/tools/AgentTool/AgentRunLedger';
import { SubAgentEngine } from '../../../src/tools/AgentTool/SubAgentEngine';

const SID = 'sess-0a';
const OTHER_SID = 'sess-0a-other';

describe('0a：台账为存续/归属的单一事实源', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('ensureCoveredRun 登记 worker 且**不占额度**（weight 0）', () => {
    const ledger = getAgentRunLedger();
    // 模拟批次已按 plannedWeight 预留 2 个槽位
    ledger.register({
      id: 'batch-A',
      name: 'batch',
      type: 'general',
      sessionId: SID,
      weight: 2,
    });
    expect(ledger.liveCount()).toBe(2);

    // worker 进入台账（修复前 worker 只在引擎侧，台账看不见）
    ledger.ensureCoveredRun({
      id: 'batch-A::t1',
      name: 'batch-A::t1',
      type: 'general',
      sessionId: SID,
    });
    expect(ledger.view('batch-A::t1')?.status).toBe('running');
    // 额度不翻倍：覆盖登记的 weight = 0
    expect(ledger.liveCount()).toBe(2);
  });

  test('ensureCoveredRun 幂等：不覆盖已有 weight，仅补缺失的 sessionId', () => {
    const ledger = getAgentRunLedger();
    // 单代理路径：beginRun 先登记（含准入预留 weight），引擎随后 ensureCoveredRun
    ledger.register({ id: 'a-1', name: 'a-1', type: 'general', weight: 3 });
    ledger.ensureCoveredRun({
      id: 'a-1',
      name: 'a-1',
      type: 'general',
      sessionId: SID,
    });

    expect(ledger.liveCount()).toBe(3); // weight 未被冲成 0/1
    expect(ledger.ownerSessionId('a-1')).toBe(SID); // 补齐了归属
    expect(ledger.listActive()).toHaveLength(1); // 未新增第二条
  });

  test('hasLiveRunsForSession 覆盖单代理与 worker 两类条目', () => {
    const ledger = getAgentRunLedger();
    expect(ledger.hasLiveRunsForSession(SID)).toBe(false);

    ledger.register({
      id: 'a-2',
      name: 'a-2',
      type: 'general',
      sessionId: SID,
    });
    expect(ledger.hasLiveRunsForSession(SID)).toBe(true);
    expect(ledger.hasLiveRunsForSession(OTHER_SID)).toBe(false);

    // worker（批次内）：修复前对台账不可见 ⇒ 该断言修复前必失败
    ledger.ensureCoveredRun({
      id: 'batch-B::t1',
      name: 'batch-B::t1',
      type: 'general',
      sessionId: OTHER_SID,
    });
    expect(ledger.hasLiveRunsForSession(OTHER_SID)).toBe(true);
  });

  test('settle 后该会话不再计为"仍有活跃 run"（无悬挂条目）', () => {
    const ledger = getAgentRunLedger();
    ledger.ensureCoveredRun({
      id: 'batch-C::t1',
      name: 'batch-C::t1',
      type: 'general',
      sessionId: SID,
    });
    expect(ledger.hasLiveRunsForSession(SID)).toBe(true);

    expect(ledger.settle('batch-C::t1', 'failed')).toBe(true);
    expect(ledger.hasLiveRunsForSession(SID)).toBe(false);
    // 终态幂等：重复结算不再迁移
    expect(ledger.settle('batch-C::t1', 'completed')).toBe(false);
    expect(ledger.view('batch-C::t1')?.status).toBe('failed');
  });
});

describe('0a：引擎判据委托台账（引擎不再自持第二套口径）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
  });

  afterEach(() => {
    resetAgentRunLedger();
  });

  test('hasActiveAgentForSession 反映台账中的 run（引擎句柄表为空也成立）', () => {
    const engine = new SubAgentEngine();
    const ledger = getAgentRunLedger();

    // 台账里有一个属于 SID 的活 run（例如并行批次 worker）——引擎自持 Map 中没有
    ledger.ensureCoveredRun({
      id: 'batch-D::t1',
      name: 'batch-D::t1',
      type: 'general',
      sessionId: SID,
    });

    expect(ledger.listActive()).toHaveLength(1);
    expect(engine.getActiveAgents()).toHaveLength(0); // 句柄表确实为空
    // 修复前：引擎只扫自持 Map ⇒ false（→ 父会话被过早恢复）
    expect(engine.hasActiveAgentForSession(SID)).toBe(true);
    expect(engine.hasActiveAgentForSession(OTHER_SID)).toBe(false);
  });

  test('ownerSessionId 委托台账（控制面归属校验与台账同源）', () => {
    const engine = new SubAgentEngine();
    const ledger = getAgentRunLedger();

    ledger.ensureCoveredRun({
      id: 'batch-E::t1',
      name: 'batch-E::t1',
      type: 'general',
      sessionId: SID,
    });

    // 修复前：引擎自持 Map 为空 ⇒ undefined（控制面归属校验恒 miss）
    expect(engine.ownerSessionId('batch-E::t1')).toBe(SID);
    expect(engine.ownerSessionId('unknown-id')).toBeUndefined();
  });

  test('cancel_requested 仍算"活跃"（取消受理后不得提前放弃等待）', () => {
    const engine = new SubAgentEngine();
    const ledger = getAgentRunLedger();

    ledger.register({
      id: 'a-3',
      name: 'a-3',
      type: 'general',
      sessionId: SID,
    });
    expect(ledger.requestCancel('a-3')).toBe(true);
    expect(ledger.view('a-3')?.status).toBe('cancel_requested');
    expect(engine.hasActiveAgentForSession(SID)).toBe(true);

    ledger.settle('a-3', 'failed');
    expect(engine.hasActiveAgentForSession(SID)).toBe(false);
  });
});
