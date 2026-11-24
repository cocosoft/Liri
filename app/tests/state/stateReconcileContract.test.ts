/**
 * R09-009（治理方案 P1-1，2026-11-24）：**重启对账证据**契约。
 *
 * 缺口：`processing`（Inbox）/ `firing`（SelfWake）等崩溃残留路径此前各域手写，
 * 新持久化机器极易漏掉；目录登记的 `reconcile` 若无证据锚点，会退化为"填了就算"。
 *
 * 本测试对**所有持久化机器**（`persistence` ∈ json-file / sqlite）断言：
 * ① 必须声明 `reconcile` 且策略不为 `none`；
 * ② 证据锚点格式为 `文件#符号`，文件真实存在；
 * ③ 该符号确实出现在证据文件内（防陈旧/编造锚点，CS06）。
 *
 * 终态收尾的**样板契约**（不重复实现，只要求存在）：
 * - 审批落地失败回滚：`app/tests/runtime/inboxApprovalReplyRollback.test.ts`
 * - 唤醒"成功才落终态 + 失败重试"：`app/tests/tasks/selfwake/selfWakeLifecycle.test.ts`
 * - 工具结果态单一派生：`client/src/stores/chat/__tests__/toolOutcome.test.ts`
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_MACHINES } from '@openliri/infra/state/engine/stateMachineCatalog';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

const persistent = STATE_MACHINES.filter(
  (m) => m.persistence === 'json-file' || m.persistence === 'sqlite'
);

describe('R09-009 持久化机器必须有可验证的启动对账证据', () => {
  it('至少覆盖 5 台持久化机器（防筛选失效空跑，AR-3）', () => {
    expect(persistent.length).toBeGreaterThanOrEqual(5);
  });

  for (const m of persistent) {
    it(`${m.id}：reconcile 策略非 none 且证据锚点真实可查`, () => {
      expect(m.reconcile, `${m.id} 缺 reconcile`).toBeDefined();
      expect(m.reconcile!.strategy, `${m.id} 策略为 none`).not.toBe('none');

      const raw = m.reconcile!.evidence;
      const [file, symbol] = raw.split('#');
      expect(file?.length ?? 0, `${m.id} 证据缺文件`).toBeGreaterThan(0);
      expect(
        symbol?.length ?? 0,
        `${m.id} 证据缺符号（格式：文件#符号）`
      ).toBeGreaterThan(0);

      const abs = join(REPO_ROOT, file);
      expect(existsSync(abs), `${m.id} 证据文件不存在：${file}`).toBe(true);
      const src = readFileSync(abs, 'utf8');
      expect(
        src.includes(symbol),
        `${m.id} 证据符号不在文件内：${file}#${symbol}`
      ).toBe(true);
    });
  }

  it('终态收尾样板测试存在（防文档承诺与实现脱节）', () => {
    const samples = [
      'app/tests/runtime/inboxApprovalReplyRollback.test.ts',
      'app/tests/tasks/selfwake/selfWakeLifecycle.test.ts',
      'client/src/stores/chat/__tests__/toolOutcome.test.ts',
    ];
    for (const rel of samples) {
      expect(existsSync(join(REPO_ROOT, rel)), `样板缺失：${rel}`).toBe(true);
    }
  });
});
