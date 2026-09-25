/**
 * P2-9（2026-09-25）：迁移**注册表 + 统一执行入口**单测。
 *
 * 覆盖 spec §6：注册（id 唯一/顺序）、中枢幂等（已 `applied` ⇒ 跳过）、`dryRun` **零副作用**、
 * fail-fast、**失败自动恢复快照**、`recover`（无快照时如实报错）、`getMigrationStatus`。
 *
 * **装置**：`getAppMigrationStore()` 是单例、按 `resolveDbPath()`（读 `LIRI_DATA_DIR`）定位
 * ⇒ 每个用例设临时 `LIRI_DATA_DIR` 并 `resetAppMigrationStore()`（避免落到真实 `~/.pyapp`）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  registerMigration,
  listRegistered,
  resetMigrationRegistry,
  runAll,
  recover,
  getMigrationStatus,
  cleanupMigrationSnapshots,
  MIGRATION_BACKUPS_DIRNAME,
} from '../../../src/core/migration/MigrationRegistry';
import {
  getAppMigrationStore,
  resetAppMigrationStore,
} from '../../../src/core/migration/AppMigrationStore';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'migration-reg-'));
  process.env.LIRI_DATA_DIR = dataDir;
  resetMigrationRegistry();
  resetAppMigrationStore();
});

afterEach(() => {
  resetMigrationRegistry();
  resetAppMigrationStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // @ignore-catch — 清理临时目录失败不影响断言
  }
});

describe('MigrationRegistry（P2-9 注册表）', () => {
  test('重复 id 注册 ⇒ 抛 AppError（fail-closed）', () => {
    const entry = {
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'x',
      async apply() {
        return {};
      },
    };
    registerMigration(entry);
    expect(() => registerMigration({ ...entry })).toThrow(/重复注册/);
  });

  test('listRegistered 顺序稳定（= 注册顺序）', () => {
    registerMigration({
      id: 'a.1->2',
      module: 'a',
      toVersion: '2',
      description: 'a',
      async apply() {
        return {};
      },
    });
    registerMigration({
      id: 'b.1->2',
      module: 'b',
      toVersion: '2',
      description: 'b',
      async apply() {
        return {};
      },
    });
    expect(listRegistered().map((e) => e.id)).toEqual(['a.1->2', 'b.1->2']);
  });

  test('runAll 顺序：按 module 首次出现分组，组内保持注册顺序', async () => {
    const order: string[] = [];
    registerMigration({
      id: 'b.1->2',
      module: 'b',
      toVersion: '2',
      description: 'b2',
      async apply() {
        order.push('b.1->2');
        return {};
      },
    });
    registerMigration({
      id: 'a.1->2',
      module: 'a',
      toVersion: '2',
      description: 'a2',
      async apply() {
        order.push('a.1->2');
        return {};
      },
    });
    registerMigration({
      id: 'b.2->3',
      module: 'b',
      toVersion: '3',
      description: 'b3',
      async apply() {
        order.push('b.2->3');
        return {};
      },
    });

    const report = await runAll();
    // b 组先出现 ⇒ 先执行；组内保持注册顺序
    expect(order).toEqual(['b.1->2', 'b.2->3', 'a.1->2']);
    expect(report.appliedCount).toBe(3);
  });

  test('幂等：已 applied 的条目二次 runAll 直接 skipped（不重复执行）', async () => {
    let calls = 0;
    registerMigration({
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'x',
      async apply() {
        calls++;
        return {};
      },
    });

    const first = await runAll();
    expect(first.appliedCount).toBe(1);
    expect(calls).toBe(1);

    const second = await runAll();
    expect(second.skippedCount).toBe(1);
    expect(second.appliedCount).toBe(0);
    expect(calls).toBe(1); // 修复前（无中枢幂等）会重复执行 ⇒ 本条必失败
  });

  test('dryRun ⇒ 零副作用（不调 apply、不写中枢、不产快照）', async () => {
    let calls = 0;
    const target = join(dataDir, 'payload.txt');
    writeFileSync(target, 'v1');
    registerMigration({
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'x',
      requiresSnapshot: true,
      snapshotTargets: [target],
      async apply() {
        calls++;
        return {};
      },
    });

    const report = await runAll({ dryRun: true });
    expect(report.plannedCount).toBe(1);
    expect(calls).toBe(0);
    expect(await getAppMigrationStore().listAll()).toEqual([]);
    expect(existsSync(join(dataDir, MIGRATION_BACKUPS_DIRNAME))).toBe(false);
  });

  test('fail-fast：首个失败即停止，后续条目不再执行', async () => {
    const order: string[] = [];
    registerMigration({
      id: 'demo.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'boom',
      async apply() {
        order.push('first');
        throw new Error('boom');
      },
    });
    registerMigration({
      id: 'demo.2->3',
      module: 'demo',
      toVersion: '3',
      description: 'should-not-run',
      async apply() {
        order.push('second');
        return {};
      },
    });

    const report = await runAll();
    expect(order).toEqual(['first']);
    expect(report.failedCount).toBe(1);
    expect(report.steps[0].error).toContain('boom');
    expect(report.steps.some((s) => s.id === 'demo.2->3')).toBe(false);
  });

  test('失败 + requiresSnapshot ⇒ **自动恢复快照**并把状态置 reverted', async () => {
    const target = join(dataDir, 'payload.txt');
    writeFileSync(target, 'before');
    registerMigration({
      id: 'demo.snap.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'snapshot+boom',
      requiresSnapshot: true,
      snapshotTargets: [target],
      async apply() {
        writeFileSync(target, 'after');
        throw new Error('boom');
      },
    });

    const report = await runAll();
    expect(report.revertedCount).toBe(1);
    // 受控文件已回到执行前内容
    expect(readFileSync(target, 'utf-8')).toBe('before');
    expect((await getAppMigrationStore().get('demo.snap.1->2'))?.status).toBe(
      'reverted'
    );
  });

  test('recover：无快照的 failed 条目 ⇒ **如实报错**（不假装成功）', async () => {
    registerMigration({
      id: 'demo.nosnap.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'no snapshot',
      async apply() {
        throw new Error('boom');
      },
    });
    await runAll();

    const report = await recover();
    expect(report.failedCount).toBe(1);
    expect(report.steps[0].error).toContain('无可恢复快照');
  });

  test('recover：有快照的 failed 条目 ⇒ 恢复并置 reverted', async () => {
    const target = join(dataDir, 'payload2.txt');
    writeFileSync(target, 'before');
    registerMigration({
      id: 'demo.snap2.1->2',
      module: 'demo',
      toVersion: '2',
      description: 'snapshot+boom',
      requiresSnapshot: true,
      snapshotTargets: [target],
      async apply() {
        writeFileSync(target, 'changed');
        throw new Error('boom');
      },
    });
    await runAll();
    // 自动恢复已把内容还原；此处再改脏一次，验证 recover() 独立可用
    writeFileSync(target, 'dirty');

    const report = await recover({ id: 'demo.snap2.1->2' });
    expect(report.revertedCount).toBe(1);
    expect(readFileSync(target, 'utf-8')).toBe('before');
  });

  test('getMigrationStatus：给出各 module 的 appliedMax 与 pending', async () => {
    registerMigration({
      id: 'a.1->2',
      module: 'a',
      toVersion: '2',
      description: 'a2',
      async apply() {
        return {};
      },
    });
    registerMigration({
      id: 'a.2->3',
      module: 'a',
      toVersion: '3',
      description: 'a3',
      async apply() {
        throw new Error('later');
      },
    });

    // 只跑第一条（`only` 过滤）
    await runAll({ only: ['a.1->2'] });

    const status = await getMigrationStatus();
    expect(status).toEqual([
      { module: 'a', appliedMax: '2', pending: ['a.2->3'] },
    ]);
  });

  test('cleanupMigrationSnapshots：空目录返回 0（幂等、不抛）', () => {
    expect(cleanupMigrationSnapshots()).toBe(0);
  });
});
