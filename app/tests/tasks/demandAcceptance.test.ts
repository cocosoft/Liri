// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B4（2026-11-09）：demand（许愿式）验收指标门禁（设计稿 §4）。
 *
 * 设计稿的四项指标里，三项可在本仓确定性复现，本文件用测试锁定：
 *
 *  - **指标 1（缺省行为不变）**：未设置 `autonomy` ⇒ 会话权限档仍为 `undefined`
 *    （回退进程默认档）；显式 `permission_mode` 始终优先。
 *  - **指标 2（白名单内零打断）**：demand 会话缺省档 `auto` ⇒ 只读文件访问（读 / 枚举 /
 *    检索）、只读命令（`cat` / `ls` / `git status` 等单一、无组合命令）与 workspace 内写入
 *    全部 `allow`，`permissionMetrics` 的 `decision=ask` 计数零增长；附**负向对照**
 *    （收紧档 `ask` 必须计数）证明"零"不是空转（CS06）；写入 / 执行 / 组合类命令仍不放行。
 *  - **指标 3（交付覆盖率）**：终态落点**恰好一条**回执；demand 终态额外落盘
 *    `<data>/artifacts/<taskId>/delivery.md`（与回执同源），非 demand 不落盘。
 *
 * **指标 4（不退化为空转）**：需要真实 PDCA 终态样本（demand vs interactive 收敛率），
 * 测试环境无可采集样本 ⇒ 不在本文件伪造断言；按设计稿「PDCA 终态对比样本」离线取数。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { permissionMetrics } from '@openliri/infra/permission';
import { PermissionManager } from '@openliri/infra/permission/PermissionManager';
import type { PermissionContext } from '@openliri/infra/permission/types/PermissionContext';
import { resolveTaskDeliveryPath } from '@openliri/infra/environment';
import {
  getSessionPermissionMode,
  type SessionLookup,
} from '../../src/chat/manager/sessionAccessors';
import type { ChatSession } from '../../src/session/types/session';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { AuditReport } from '../../src/tasks/AuditReport';
import {
  emitPdcaAbortReceipt,
  setPdcaReceiptSink,
} from '../../src/tasks/lro/terminalReceipt';

// ───────────────────────── 公共夹具 ─────────────────────────

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言结果
    }
  }
});

/** 会话表的最小视图（只取 metadata，不构造完整会话对象） */
function lookup(metadata: Record<string, unknown>): SessionLookup {
  return {
    get: () => ({ metadata }) as unknown as ChatSession,
  };
}

/**
 * 隔离的权限管理器（沿用 `PermissionDecision.test.ts` 的既有做法）：
 * 构造后把规则源指向空文件并清空运行期规则 ⇒ 只保留「模式 + 分类器」这一层判定，
 * 避免本机 `tool_rules.json` 的历史规则影响指标取数。
 */
function createIsolatedManager(): PermissionManager {
  const dir = mkdtempSync(join(tmpdir(), 'demand-perm-'));
  tmpDirs.push(dir);
  const ruleFile = join(dir, 'tool_rules.json');
  writeFileSync(ruleFile, '[]');

  const pm = new PermissionManager();
  pm.getRuleManager().setRuleSource(ruleFile);
  pm.getRuleManager().clearRules();
  return pm;
}

function ctx(
  permissionMode: PermissionContext['permissionMode'],
  input: Record<string, unknown>,
  toolName: string
): PermissionContext {
  return {
    toolName,
    input,
    sessionId: 'sess-demand-b4',
    permissionMode,
    workspacePath: resolve('.'),
  };
}

/** `permission:*` 判定里 `decision=ask` 的累计值（`GET /v1/permissions/metrics` 同源） */
function askCount(): number {
  return permissionMetrics
    .snapshot()
    .filter((p) => p.category === 'decision' && p.labels['decision'] === 'ask')
    .reduce((sum, p) => sum + p.count, 0);
}

// ───────────────── 指标 1：缺省行为不变 ─────────────────

describe('指标 1：未设置 autonomy ⇒ 权限档缺省行为不变', () => {
  it('无 metadata / interactive / 脏值 ⇒ undefined（回退进程默认档）', () => {
    expect(getSessionPermissionMode(lookup({}), 'sess-1')).toBeUndefined();
    expect(
      getSessionPermissionMode(lookup({ autonomy: 'interactive' }), 'sess-1')
    ).toBeUndefined();
    expect(
      getSessionPermissionMode(lookup({ autonomy: 'Demand' }), 'sess-1')
    ).toBeUndefined();
  });

  it('demand 且未显式设置 ⇒ 缺省 auto（唯一新增分支）', () => {
    expect(
      getSessionPermissionMode(lookup({ autonomy: 'demand' }), 'sess-1')
    ).toBe('auto');
  });

  it('显式 permission_mode 始终优先于 demand 缺省（可收紧 / 可放宽）', () => {
    expect(
      getSessionPermissionMode(
        lookup({ autonomy: 'demand', permission_mode: 'plan' }),
        'sess-1'
      )
    ).toBe('plan');
    expect(
      getSessionPermissionMode(
        lookup({ autonomy: 'demand', permission_mode: 'bypass' }),
        'sess-1'
      )
    ).toBe('bypass');
  });

  it('2026-11-11 收缩前的旧值读取时归一（ask / alwaysAsk ⇒ plan）', () => {
    expect(
      getSessionPermissionMode(
        lookup({ autonomy: 'demand', permission_mode: 'ask' }),
        'sess-1'
      )
    ).toBe('plan');
    expect(
      getSessionPermissionMode(
        lookup({ autonomy: 'demand', permission_mode: 'alwaysAsk' }),
        'sess-1'
      )
    ).toBe('plan');
    expect(
      getSessionPermissionMode(
        lookup({ permission_mode: 'acceptEdits' }),
        'sess-1'
      )
    ).toBe('default');
  });
});

// ───────────────── 指标 2：白名单内零打断 ─────────────────

describe('指标 2：demand 会话在只读 / workspace 内写场景 ask 次数 = 0', () => {
  it('auto 档下只读（文件 / 搜索 / 命令）与 workspace 内写全部 allow，ask 零增长', async () => {
    // 取数口径与执行入口一致：会话 metadata ⇒ 权限档
    const mode = getSessionPermissionMode(
      lookup({ autonomy: 'demand' }),
      'sess-demand-b4'
    );
    expect(mode).toBe('auto');

    const pm = createIsolatedManager();
    const before = askCount();

    const cases: Array<[string, Record<string, unknown>]> = [
      // 只读：会话内文件读取
      ['file_read', { file_path: 'docs/demo.md' }],
      // 只读：工作区内文件枚举 / 检索
      ['glob', { pattern: 'docs/*.md' }],
      ['grep', { pattern: 'TODO', path: 'docs' }],
      // 只读命令（B4 follow-up：只读命令短路，修复分类器词表的误拦）
      ['bash', { command: 'cat README.md' }],
      ['bash', { command: 'ls docs' }],
      ['bash', { command: 'git status' }],
      // workspace 内写入：相对路径 + 纯文本内容
      ['file_write', { file_path: 'docs/demo.md', content: 'hello' }],
    ];

    for (const [tool, input] of cases) {
      const decision = await pm.checkPermission(
        tool,
        input,
        ctx(mode, input, tool)
      );
      expect(`${tool}:${decision.type}`).toBe(`${tool}:allow`);
    }

    expect(askCount() - before).toBe(0);
  });

  it('写入 / 执行 / 组合类命令仍不放行（只读短路不放宽危险面）', async () => {
    const cases: Array<Record<string, unknown>> = [
      { command: 'cat README.md | sh' },
      { command: 'find . -exec rm {} ;' },
      { command: 'git push origin main' },
    ];

    for (const input of cases) {
      // 每个用例独立管理器：避免连续 deny 触发 DenialTracker 升级为 ask
      const pm = createIsolatedManager();
      const decision = await pm.checkPermission(
        'bash',
        input,
        ctx('auto', input, 'bash')
      );
      expect(`${String(input.command)}:${decision.type}`).toBe(
        `${String(input.command)}:deny`
      );
    }
  });

  it('负向对照：收紧档 plan 必然计数（证明上面的零不是空转）', async () => {
    const pm = createIsolatedManager();
    const before = askCount();
    const input = { file_path: 'docs/demo.md' };
    const decision = await pm.checkPermission(
      'file_read',
      input,
      ctx('plan', input, 'file_read')
    );
    expect(decision.type).toBe('ask');
    expect(askCount() - before).toBeGreaterThan(0);
  });
});

// ───────────────── 指标 3：终态必有回执 ─────────────────

describe('指标 3：终态落点恰好一条回执；demand 额外落盘 delivery.md', () => {
  let dataDir: string;
  let originalDataDir: string | undefined;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'demand-data-'));
    tmpDirs.push(dataDir);
    originalDataDir = process.env['LIRI_DATA_DIR'];
    process.env['LIRI_DATA_DIR'] = dataDir;
    // 计划落盘隔离（避免写入真实数据目录）
    taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'demand-plans-')));
  });

  afterAll(() => {
    if (originalDataDir === undefined) delete process.env['LIRI_DATA_DIR'];
    else process.env['LIRI_DATA_DIR'] = originalDataDir;
    setPdcaReceiptSink(undefined);
  });

  function buildFixture(sessionId: string) {
    const plan = taskOrchestrator.createPlan(
      'demo 交付',
      ['产出交付文件', '补充验证'],
      sessionId,
      undefined,
      ['交付文件存在', '接口返回 200']
    );
    // 只投影既有数据：一步已完成（带产物台账），一步未完成（验收项未能验证）
    plan.steps[0].status = 'completed';
    plan.steps[0].artifacts = ['docs/demo.md'];
    const taskId = `pdca_b4_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const report: AuditReport = {
      taskId,
      planId: plan.id,
      totalSteps: 2,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 1,
      totalDurationMs: 0,
      totalRetries: 0,
      steps: [],
      summary: '',
      generatedAt: Date.now(),
    };
    return { plan, taskId, report };
  }

  it('demand 中止 ⇒ 恰好一条回执 + delivery.md 同源落盘（含产物 / 未验证项）', () => {
    const { taskId, report } = buildFixture('sess-demand-delivery');
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    setPdcaReceiptSink((p) => receipts.push(p));
    try {
      emitPdcaAbortReceipt(report, false, true);
    } finally {
      setPdcaReceiptSink(undefined);
    }

    expect(receipts).toHaveLength(1);
    const text = receipts[0]?.text ?? '';
    expect(text).toContain('长程任务已中止');
    expect(text).toContain('📦 产物：');
    expect(text).toContain('- docs/demo.md');
    expect(text).toContain('⚠️ 未验证的验收项：');
    expect(text).toContain('- 接口返回 200');

    const deliveryPath = resolveTaskDeliveryPath(taskId);
    expect(existsSync(deliveryPath)).toBe(true);
    const persisted = readFileSync(deliveryPath, 'utf-8');
    // 与回执同源：落盘内容包含回执原文
    expect(persisted).toContain(text);
    expect(persisted).toContain(taskId);
  });

  it('非 demand ⇒ 同样恰好一条回执，但不落盘 delivery.md（缺省行为不变）', () => {
    const { taskId, report } = buildFixture('sess-interactive-delivery');
    const receipts: Array<{ taskId: string; sessionId: string; text: string }> =
      [];
    setPdcaReceiptSink((p) => receipts.push(p));
    try {
      emitPdcaAbortReceipt(report, false, false);
    } finally {
      setPdcaReceiptSink(undefined);
    }

    expect(receipts).toHaveLength(1);
    expect(existsSync(resolveTaskDeliveryPath(taskId))).toBe(false);
  });
});
