/**
 * 日预算按身份分区（多租户 P1）
 *
 * 锁三件事：
 *  ① 状态文件路径随身份：本地 ⇒ `<data>/daily-budget-state.json`（零变更）；
 *     已认证 ⇒ `<data>/tenants/<t>/users/<u>/daily-budget-state.json`；
 *  ② 账本按身份分桶：ALICE 记账不影响本地/BOB 的用量；
 *  ③ 分区账本首次创建时**同步恢复**当日用量（不会从 0 起算 ⇒ 闸门不被绕过）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Principal } from '@modules/core/identity/principal';
import { runWithPrincipal } from '@modules/core/identity/requestScope';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import { dailyBudgetStatePath } from '../../src/query/dailyBudgetPersistence';

const ALICE: Principal = {
  tenantId: 'acme',
  userId: 'alice',
  roles: ['user'],
};
const BOB: Principal = {
  tenantId: 'acme',
  userId: 'bob',
  roles: ['user'],
};

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tenant-budget-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetDailyBudgetForTest();
});

afterEach(() => {
  resetDailyBudgetForTest();
  delete process.env.LIRI_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('日预算：路径分区', () => {
  // `dailyBudgetStatePath()` 用模板串拼接（`${dir}/file`），`join` 在 Windows 用反斜杠 ⇒ 归一后比较
  const norm = (p: string) => p.replaceAll('\\', '/');

  it('本地身份路径不变，已认证身份落在 tenants/<t>/users/<u>/ 下', () => {
    expect(norm(dailyBudgetStatePath())).toBe(
      norm(join(dataDir, 'daily-budget-state.json'))
    );
    expect(norm(runWithPrincipal(ALICE, () => dailyBudgetStatePath()))).toBe(
      norm(
        join(
          dataDir,
          'tenants',
          'acme',
          'users',
          'alice',
          'daily-budget-state.json'
        )
      )
    );
  });
});

describe('日预算：账本分桶', () => {
  it('ALICE 记账不影响本地与 BOB', () => {
    runWithPrincipal(ALICE, () => {
      getDailyBudget().recordUsage(1000, 's-alice');
    });

    expect(runWithPrincipal(ALICE, () => getDailyBudget().getMode().used)).toBe(
      1000
    );
    expect(getDailyBudget().getMode().used).toBe(0);
    expect(runWithPrincipal(BOB, () => getDailyBudget().getMode().used)).toBe(
      0
    );
  });

  it('分区账本首次创建时同步恢复当日用量（不从 0 起算）', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dir = join(dataDir, 'tenants', 'acme', 'users', 'alice');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'daily-budget-state.json'),
      JSON.stringify({ date: `${y}-${m}-${d}`, used: 4321 }),
      'utf-8'
    );

    const used = runWithPrincipal(ALICE, () => getDailyBudget().getMode().used);
    expect(used).toBe(4321);
  });
});
