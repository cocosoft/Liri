/**
 * seed-test-tasks.ts — 前端测试用种子数据脚本
 *
 * 向数据库插入测试用的定时任务（Cron）和 Agent 任务，用于前端任务中心展示验证。
 *
 * 用法: bun run scripts/seed-test-tasks.ts
 */

import { Database } from 'sqlite3';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { SCHEMA as TASK_SCHEMA } from '../src/tasks/db/schema';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'app.db');

const NOW = Date.now();

const CRON_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_fired_at INTEGER,
  recurring INTEGER DEFAULT 1,
  permanent INTEGER DEFAULT 0,
  durable INTEGER DEFAULT 1,
  agent_id TEXT,
  task_type TEXT DEFAULT 'prompt',
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_cron ON scheduled_tasks(cron);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_created ON scheduled_tasks(created_at);
`;

const TEST_CRON_TASKS = [
  {
    id: `seed-cron-${randomUUID().slice(0, 8)}`,
    cron: '*/5 * * * *',
    prompt: '每5分钟检查系统健康状态并生成报告',
    created_at: NOW - 3600000,
    last_fired_at: NOW - 300000,
    recurring: 1,
    permanent: 0,
    durable: 1,
    agent_id: null,
    task_type: 'prompt',
    metadata: JSON.stringify({ tags: ['test', 'monitor'], source: 'seed' }),
  },
  {
    id: `seed-cron-${randomUUID().slice(0, 8)}`,
    cron: '0 * * * *',
    prompt: '每小时汇总知识库变更并发送通知',
    created_at: NOW - 7200000,
    last_fired_at: NOW - 3600000,
    recurring: 1,
    permanent: 0,
    durable: 1,
    agent_id: null,
    task_type: 'prompt',
    metadata: JSON.stringify({ tags: ['test', 'knowledge'], source: 'seed' }),
  },
  {
    id: `seed-cron-${randomUUID().slice(0, 8)}`,
    cron: '0 9 * * 1-5',
    prompt: '每个工作日早上9点生成日报摘要',
    created_at: NOW - 86400000,
    last_fired_at: null,
    recurring: 1,
    permanent: 0,
    durable: 1,
    agent_id: null,
    task_type: 'prompt',
    metadata: JSON.stringify({ tags: ['test', 'report'], source: 'seed' }),
  },
  {
    id: `seed-cron-${randomUUID().slice(0, 8)}`,
    cron: '0 0 1 * *',
    prompt: '每月1号凌晨生成月度分析报告',
    created_at: NOW - 2592000000,
    last_fired_at: null,
    recurring: 1,
    permanent: 0,
    durable: 0,
    agent_id: null,
    task_type: 'prompt',
    metadata: JSON.stringify({ tags: ['test', 'report', 'monthly'], source: 'seed' }),
  },
  {
    id: `seed-cron-${randomUUID().slice(0, 8)}`,
    cron: '*/30 * * * *',
    prompt: '每30分钟清理临时文件和过期缓存',
    created_at: NOW - 1800000,
    last_fired_at: NOW - 1800000,
    recurring: 1,
    permanent: 0,
    durable: 1,
    agent_id: null,
    task_type: 'skill',
    metadata: JSON.stringify({ tags: ['test', 'cleanup'], source: 'seed' }),
  },
];

const TEST_AGENT_TASKS = [
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'background_agent',
    status: 'pending',
    description: '前端测试任务-高优先级待执行',
    start_time: NOW - 60000,
    end_time: null,
    tool_use_count: 0,
    token_count: 0,
    output_file: '',
    output_offset: 0,
    notified: 0,
    error: null,
    metadata: JSON.stringify({ priority: 'high', tags: ['test', 'frontend'], source: 'seed' }),
    updated_at: NOW,
  },
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'local_agent',
    status: 'running',
    description: '前端测试任务-正在执行中',
    start_time: NOW - 120000,
    end_time: null,
    tool_use_count: 3,
    token_count: 1500,
    output_file: '',
    output_offset: 0,
    notified: 0,
    error: null,
    metadata: JSON.stringify({ priority: 'medium', tags: ['test', 'frontend'], source: 'seed' }),
    updated_at: NOW,
  },
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'local_agent',
    status: 'completed',
    description: '前端测试任务-已完成（成功）',
    start_time: NOW - 3600000,
    end_time: NOW - 1800000,
    tool_use_count: 12,
    token_count: 8500,
    output_file: '/tmp/test-output.md',
    output_offset: 0,
    notified: 0,
    error: null,
    metadata: JSON.stringify({ priority: 'low', tags: ['test', 'frontend'], source: 'seed' }),
    updated_at: NOW,
  },
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'remote_agent',
    status: 'failed',
    description: '前端测试任务-执行失败（网络超时）',
    start_time: NOW - 7200000,
    end_time: NOW - 7100000,
    tool_use_count: 2,
    token_count: 300,
    output_file: '',
    output_offset: 0,
    notified: 0,
    error: 'Network timeout: connection to remote agent failed after 30s',
    metadata: JSON.stringify({ priority: 'high', tags: ['test', 'frontend', 'error'], source: 'seed' }),
    updated_at: NOW,
  },
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'local_workflow',
    status: 'completed',
    description: '前端测试任务-工作流已完成',
    start_time: NOW - 86400000,
    end_time: NOW - 86000000,
    tool_use_count: 25,
    token_count: 32000,
    output_file: '/tmp/workflow-result.json',
    output_offset: 0,
    notified: 0,
    error: null,
    metadata: JSON.stringify({ priority: 'medium', tags: ['test', 'frontend', 'workflow'], source: 'seed' }),
    updated_at: NOW,
  },
  {
    id: `seed-agent-${randomUUID().slice(0, 8)}`,
    type: 'background_agent',
    status: 'pending',
    description: '前端测试任务-低优先级排队中',
    start_time: NOW - 30000,
    end_time: null,
    tool_use_count: 0,
    token_count: 0,
    output_file: '',
    output_offset: 0,
    notified: 0,
    error: null,
    metadata: JSON.stringify({ priority: 'low', tags: ['test', 'frontend'], source: 'seed' }),
    updated_at: NOW,
  },
];

function openDb(dbPath: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function execDb(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function runDb(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function createTables(db: Database): Promise<void> {
  console.log('[seed] 创建数据表（如不存在）...');
  await execDb(db, TASK_SCHEMA);
  await execDb(db, CRON_TABLE_SCHEMA);
  console.log('  数据表就绪');
}

async function seedCronTasks(db: Database): Promise<void> {
  console.log(`\n[seed] 插入 ${TEST_CRON_TASKS.length} 条 Cron 测试任务...`);

  for (const task of TEST_CRON_TASKS) {
    await runDb(
      db,
      `INSERT OR REPLACE INTO scheduled_tasks
       (id, cron, prompt, created_at, last_fired_at, recurring, permanent, durable, agent_id, task_type, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.cron,
        task.prompt,
        task.created_at,
        task.last_fired_at,
        task.recurring,
        task.permanent,
        task.durable,
        task.agent_id,
        task.task_type,
        task.metadata,
      ]
    );
    console.log(`  ✓ Cron: ${task.id} (${task.cron}) - ${task.prompt.slice(0, 30)}...`);
  }
}

async function seedAgentTasks(db: Database): Promise<void> {
  console.log(`\n[seed] 插入 ${TEST_AGENT_TASKS.length} 条 Agent 测试任务...`);

  for (const task of TEST_AGENT_TASKS) {
    await runDb(
      db,
      `INSERT OR REPLACE INTO task_states
       (id, type, status, description, start_time, end_time, tool_use_count, token_count, output_file, output_offset, notified, error, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.type,
        task.status,
        task.description,
        task.start_time,
        task.end_time,
        task.tool_use_count,
        task.token_count,
        task.output_file,
        task.output_offset,
        task.notified,
        task.error,
        task.metadata,
        task.updated_at,
      ]
    );
    console.log(`  ✓ Agent: ${task.id} [${task.status}] - ${task.description}`);
  }
}

async function verifyData(db: Database): Promise<void> {
  console.log('\n[verify] 验证数据...');

  const cronCount = await new Promise<number>((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM scheduled_tasks WHERE id LIKE 'seed-cron-%'`,
      (err, row: any) => {
        if (err) reject(err);
        else resolve(row?.count ?? 0);
      }
    );
  });
  console.log(`  Cron 测试任务: ${cronCount} 条`);

  const agentCount = await new Promise<number>((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM task_states WHERE id LIKE 'seed-agent-%'`,
      (err, row: any) => {
        if (err) reject(err);
        else resolve(row?.count ?? 0);
      }
    );
  });
  console.log(`  Agent 测试任务: ${agentCount} 条`);
}

async function main(): Promise<void> {
  console.log('=== 前端测试任务种子脚本 ===');
  console.log(`数据库路径: ${DB_PATH}`);

  let db: Database;
  try {
    db = await openDb(DB_PATH);
    console.log('数据库连接成功');
  } catch (err) {
    console.error('数据库连接失败:', err);
    process.exit(1);
  }

  try {
    await createTables(db);
    await seedCronTasks(db);
    await seedAgentTasks(db);
    await verifyData(db);
    console.log('\n种子数据插入完成！');
  } catch (err) {
    console.error('种子数据插入失败:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();