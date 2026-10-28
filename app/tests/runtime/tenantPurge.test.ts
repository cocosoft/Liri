/**
 * 多租户 P5：删除租户 ⇒ 数据、预算、事件、凭据全量清除（方案 §2.7.7 最后一项）
 *
 * 覆盖：
 * ① 分区目录（`<data>/tenants/<t>/…`：会话/事件/租户库/预算状态/审计/凭据/工作区）整目录删除，
 *    其他租户不受影响；
 * ② 共享单库的归属行（`channel_configs` / `cron_jobs` / `task_flow`）按 `owner_key` 前缀删除；
 * ③ 全局 `data/projects/<id>` 按 `project.json` 的 `ownerKey` 删除；
 * ④ 进程内放行缓存按前缀清理（其他租户与本机记录保留）；
 * ⑤ `local` / 空租户被拒绝；
 * ⑥ 无法定位的数据面如实登记在 `notPurged`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Database } from '@modules/external';
import {
  setUserDataDirOverride,
  resolveDataDir,
  resolveDbPath,
} from '@modules/environment';
import { purgeTenant } from '../../src/runtime/tenantPurge.js';
import { CronJobStore } from '../../src/tasks/cron/CronJobStore.js';
import { SqliteTaskStore } from '../../src/tasks/db/SqliteTaskStore.js';
import { GoalMetricsService } from '../../src/tasks/db/GoalMetricsService.js';
import { UsageStatsService } from '../../src/ai/models/UsageStatsService.js';
import { SkillDB } from '../../src/skills/persistence/SkillDB.js';
import { ChannelRegistry } from '../../src/channels/registry/ChannelRegistry.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';
import {
  getApprovedCommandRegistry,
  type ApprovedCommandRegistry,
} from '../../src/permission/ApprovedCommandRegistry.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = {
  tenantId: 'other',
  userId: 'bob',
  roles: ['user'],
};

let root: string;

/** 打开一次连接跑一句 SQL（测试夹具；生产走各 store） */
function execSql(
  db: Database,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function queryCount(
  db: Database,
  sql: string,
  params: unknown[] = []
): Promise<number> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: Array<{ n: number }>) => {
      if (err) reject(err);
      else resolve(rows[0]?.n ?? 0);
    });
  });
}

function openDb(path: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(path, (err: Error | null) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function closeDb(db: Database): Promise<void> {
  return new Promise((resolve) => db.close(() => resolve()));
}

/** 建表（借用各 store 的幂等 DDL） + 写入三类归属行 */
async function seedSharedDb(): Promise<void> {
  const dbPath = resolveDbPath();

  const cron = new CronJobStore(dbPath);
  await cron.init();
  await cron.upsertJob({
    id: 'job-acme',
    name: 'acme job',
    skills: [],
    schedule: { kind: 'interval', display: '每 60 分钟', minutes: 60 },
    repeat: { times: null, completed: 0 },
    enabled: true,
    state: 'scheduled',
    deliver: 'local',
    createdAt: new Date().toISOString(),
    ownerKey: 'acme:alice',
  });
  await cron.upsertJob({
    id: 'job-other',
    name: 'other job',
    skills: [],
    schedule: { kind: 'interval', display: '每 60 分钟', minutes: 60 },
    repeat: { times: null, completed: 0 },
    enabled: true,
    state: 'scheduled',
    deliver: 'local',
    createdAt: new Date().toISOString(),
    ownerKey: 'other:bob',
  });
  await cron.close();

  const tasks = new SqliteTaskStore(dbPath);
  await tasks.init();
  await tasks.close();

  const channels = new ChannelRegistry(dbPath);
  await channels.initPersistence();
  await channels.close();

  const db = await openDb(dbPath);
  try {
    await execSql(
      db,
      `INSERT INTO task_flow (flow_id, owner_key) VALUES (?, ?)`,
      ['flow-acme', 'acme:alice']
    );
    await execSql(
      db,
      `INSERT INTO task_flow (flow_id, owner_key) VALUES (?, ?)`,
      ['flow-other', 'other:bob']
    );
    for (const [id, owner] of [
      ['chan-acme', 'acme:alice'],
      ['chan-other', 'other:bob'],
    ]) {
      await execSql(
        db,
        `INSERT INTO channel_configs (id, name, type, enabled, options, owner_key, updated_at)
         VALUES (?, ?, ?, 1, '{}', ?, 0)`,
        [`${id}::telegram`, 'telegram', 'telegram', owner]
      );
    }
    // 部署级行（owner_key NULL）必须保留
    await execSql(
      db,
      `INSERT INTO channel_configs (id, name, type, enabled, options, owner_key, updated_at)
       VALUES ('telegram', 'telegram', 'telegram', 1, '{}', NULL, 0)`
    );
  } finally {
    await closeDb(db);
  }
}

/**
 * 写入三类用量记录（走**真实写入路径** ⇒ 同时验证写入侧自动带归属）
 */
async function seedUsageTables(): Promise<void> {
  const metrics = new GoalMetricsService(resolveDbPath());
  await metrics.init();
  await runWithPrincipal(ALICE, () =>
    metrics.recordMessageUsage({ sessionId: 's-acme', totalTokens: 10 })
  );
  await runWithPrincipal(BOB, () =>
    metrics.recordMessageUsage({ sessionId: 's-other', totalTokens: 20 })
  );
  metrics.close();

  const usage = await UsageStatsService.openAt(resolveDbPath());
  const logParams = {
    model: 'probe-model',
    inputTokens: 1,
    outputTokens: 1,
    costUSD: 0,
    latencyMs: 1,
  };
  await runWithPrincipal(ALICE, () => usage.logUsage(logParams));
  await runWithPrincipal(BOB, () => usage.logUsage(logParams));
  await usage.close();

  const skills = new SkillDB(resolveDbPath());
  const skillRecord = {
    skillName: 'probe-skill',
    timestamp: Date.now(),
    durationMs: 1,
    success: true,
    source: 'test',
    triggeredBy: 'user' as const,
  };
  await runWithPrincipal(ALICE, () => skills.insertUsage(skillRecord));
  await runWithPrincipal(BOB, () => skills.insertUsage(skillRecord));
  await skills.close();
}

function seedTenantDir(tenantId: string, userId: string): void {
  const dir = join(
    resolveDataDir(),
    'tenants',
    tenantId,
    'users',
    userId,
    'sessions',
    'hash'
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), '{"id":"s1"}', 'utf-8');
}

function seedProject(id: string, ownerKey?: string): void {
  const dir = join(resolveDataDir(), 'projects', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ id, ...(ownerKey ? { ownerKey } : {}) }),
    'utf-8'
  );
}

/** 让放行缓存里各有一条"acme"与"other"的记录 */
function seedApprovals(registry: ApprovedCommandRegistry): void {
  runWithPrincipal(ALICE, () => registry.approve('s-acme', 'h1', 'npm test'));
  runWithPrincipal(BOB, () =>
    registry.approve('s-other', 'h2', 'npm run build')
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-purge-'));
  setUserDataDirOverride(root);
  mkdirSync(resolveDataDir(), { recursive: true });
  seedTenantDir('acme', 'alice');
  seedTenantDir('other', 'bob');
  seedProject('p-acme', 'acme:alice');
  seedProject('p-other', 'other:bob');
  seedProject('p-local');
});

afterEach(() => {
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows 上仍有模块级 sqlite 句柄指向临时库（进程内单例）⇒ 交给系统回收临时目录
  }
});

describe('删除租户（P5）', () => {
  it('清分区目录 / 共享库归属行 / 归属项目 / 放行缓存，其他租户与本机不受影响', async () => {
    await seedSharedDb();
    await seedUsageTables();
    const registry = getApprovedCommandRegistry();
    seedApprovals(registry);

    const report = await purgeTenant('acme');

    // ① 分区目录：acme 删除，other 保留
    const tenantsRoot = join(resolveDataDir(), 'tenants');
    expect(existsSync(join(tenantsRoot, 'acme'))).toBe(false);
    expect(existsSync(join(tenantsRoot, 'other', 'users', 'bob'))).toBe(true);
    expect(report.removed.tenantDataDir).toBe(true);

    // ② 共享库归属行（含三类用量统计表）
    expect(report.removed.channelConfigs).toBe(1);
    expect(report.removed.cronJobs).toBe(1);
    expect(report.removed.taskFlows).toBe(1);
    expect(report.removed.usageRecords).toBe(1);
    expect(report.removed.modelUsageLogs).toBe(1);
    expect(report.removed.skillUsageRecords).toBe(1);

    const db = await openDb(resolveDbPath());
    try {
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM cron_jobs WHERE id = ?`,
          ['job-acme']
        )
      ).toBe(0);
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM cron_jobs WHERE id = ?`,
          ['job-other']
        )
      ).toBe(1);
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM task_flow WHERE flow_id = ?`,
          ['flow-acme']
        )
      ).toBe(0);
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM channel_configs WHERE owner_key LIKE ?`,
          ['acme:%']
        )
      ).toBe(0);
      // 部署级行与其他租户行保留
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM channel_configs WHERE id = 'telegram'`
        )
      ).toBe(1);
      expect(
        await queryCount(
          db,
          `SELECT COUNT(*) AS n FROM channel_configs WHERE owner_key LIKE ?`,
          ['other:%']
        )
      ).toBe(1);

      // 三类用量统计表：acme 行清除、other 行保留（写入侧已自动带归属）
      for (const table of [
        'usage_records',
        'model_usage_logs',
        'skill_usage_records',
      ]) {
        expect(
          await queryCount(
            db,
            `SELECT COUNT(*) AS n FROM ${table} WHERE owner_key LIKE ?`,
            ['acme:%']
          )
        ).toBe(0);
        expect(
          await queryCount(
            db,
            `SELECT COUNT(*) AS n FROM ${table} WHERE owner_key LIKE ?`,
            ['other:%']
          )
        ).toBe(1);
      }
    } finally {
      await closeDb(db);
    }

    // ③ 项目目录：acme 删除，other 与本地项目保留
    const projectsRoot = join(resolveDataDir(), 'projects');
    expect(report.removed.projects).toBe(1);
    expect(existsSync(join(projectsRoot, 'p-acme'))).toBe(false);
    expect(existsSync(join(projectsRoot, 'p-other'))).toBe(true);
    expect(existsSync(join(projectsRoot, 'p-local'))).toBe(true);

    // ④ 放行缓存：acme 记录清除，other 仍可用；本地身份仍可见 other 的记录
    expect(report.removed.approvedCommands).toBeGreaterThan(0);
    expect(
      runWithPrincipal(ALICE, () => registry.isApproved('s-acme', 'h1'))
    ).toBe(false);
    expect(
      runWithPrincipal(BOB, () =>
        registry.isCommandNameApproved('s-other', 'npm run build')
      )
    ).toBe(true);

    // ⑥ 无法定位的数据面如实登记
    expect(report.notPurged.length).toBeGreaterThan(0);
    expect(report.blocked).toEqual([]);
  });

  it('拒绝删除 local 与空租户', async () => {
    await expect(purgeTenant('local')).rejects.toThrow(/local/);
    await expect(purgeTenant('   ')).rejects.toThrow(/tenantId/);
  });

  it('租户不存在时幂等（不报错、计数为 0）', async () => {
    const report = await purgeTenant('never-existed');
    expect(report.removed.tenantDataDir).toBe(false);
    expect(report.removed.projects).toBe(0);
    expect(report.blocked).toEqual([]);
  });
});
