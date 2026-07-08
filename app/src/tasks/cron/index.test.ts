/**
 * Cron 模块单元测试
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from 'bun:test';
import { CronJobStore } from './CronJobStore';
import { CronScheduler } from './CronScheduler';
import { DeliveryQueue } from './DeliveryQueue';
import type {
  CronJob,
  CronJobResult,
  SchedulerCallbacks,
  DeliveryQueueEntry,
} from './index';
import {
  CRON_JOB_STATE_TRANSITIONS,
  isTerminalCronState,
  isValidCronTransition,
  validateCronTransition,
} from './index';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_DB_DIR = join(import.meta.dir, '.test_cron_db');

function makeTestJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: overrides.id ?? 'test-job-001',
    name: overrides.name ?? '测试作业',
    prompt: overrides.prompt ?? '执行测试任务',
    skills: overrides.skills ?? [],
    schedule: overrides.schedule ?? {
      kind: 'interval',
      minutes: 30,
      display: '每 30 分钟',
    },
    repeat: overrides.repeat ?? { times: null, completed: 0 },
    enabled: overrides.enabled ?? true,
    state: overrides.state ?? 'scheduled',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    deliver: overrides.deliver ?? 'local',
    nextRunAt: overrides.nextRunAt,
    lastRunAt: overrides.lastRunAt,
    lastStatus: overrides.lastStatus,
    lastError: overrides.lastError,
    noAgent: overrides.noAgent ?? false,
    ...overrides,
  };
}

async function createStore(dbName: string): Promise<CronJobStore> {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  const store = new CronJobStore(join(TEST_DB_DIR, dbName));
  await store.init();
  return store;
}

async function closeStore(store: CronJobStore | null): Promise<void> {
  if (store) {
    try {
      await store.close();
    } catch {
      /* ignore */
    }
  }
}

/** 清理测试数据库目录 */
function cleanTestDbDir(): void {
  if (existsSync(TEST_DB_DIR)) {
    const files = readdirSync(TEST_DB_DIR);
    for (const file of files) {
      if (file.endsWith('.db')) {
        rmSync(join(TEST_DB_DIR, file), { force: true });
      }
    }
  }
}

beforeAll(() => {
  cleanTestDbDir();
});

describe('CronJobStore', () => {
  let store: CronJobStore | null = null;

  afterEach(async () => {
    await closeStore(store);
  });

  it('应该成功初始化和关闭数据库', async () => {
    store = await createStore('init_test.db');
    expect(store).toBeDefined();
  });

  it('应该成功插入和读取作业', async () => {
    store = await createStore('crud_test.db');
    const job = makeTestJob({ id: 'insert-test' });
    await store.upsertJob(job);

    const loaded = await store.getJob('insert-test');
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe('insert-test');
    expect(loaded!.name).toBe('测试作业');
    expect(loaded!.enabled).toBe(true);
    expect(loaded!.state).toBe('scheduled');
  });

  it('应该正确存储和恢复 JSON 字段（schedule/skills/origin）', async () => {
    store = await createStore('json_test.db');
    const job = makeTestJob({
      id: 'json-fields',
      schedule: { kind: 'cron', expr: '0 */2 * * *', display: '每 2 小时' },
      skills: ['bash', 'fetch'],
      origin: { platform: 'slack', chatId: 'C12345', chatName: 'general' },
    });
    await store.upsertJob(job);

    const loaded = await store.getJob('json-fields');
    expect(loaded!.schedule.kind).toBe('cron');
    expect(loaded!.schedule.expr).toBe('0 */2 * * *');
    expect(loaded!.skills).toEqual(['bash', 'fetch']);
    expect(loaded!.origin!.platform).toBe('slack');
    expect(loaded!.origin!.chatId).toBe('C12345');
  });

  it('应该能获取到期作业', async () => {
    store = await createStore('due_test.db');
    const pastJob = makeTestJob({
      id: 'past-due',
      nextRunAt: '2020-01-01T00:00:00.000Z',
    });
    const futureJob = makeTestJob({
      id: 'not-due',
      nextRunAt: '2099-12-31T00:00:00.000Z',
    });
    await store.upsertJob(pastJob);
    await store.upsertJob(futureJob);

    const due = await store.getDueJobs('2025-01-01T00:00:00.000Z');
    expect(due.length).toBe(1);
    expect(due[0].id).toBe('past-due');
  });

  it('应该能标记作业运行状态', async () => {
    store = await createStore('mark_test.db');
    const job = makeTestJob({ id: 'mark-run' });
    await store.upsertJob(job);

    await store.markJobRun('mark-run', true);
    const loaded = await store.getJob('mark-run');
    expect(loaded!.lastStatus).toBe('ok');
    expect(loaded!.lastRunAt).toBeDefined();
    expect(loaded!.lastError).toBeUndefined();
  });

  it('应该能记录运行错误', async () => {
    store = await createStore('fail_test.db');
    const job = makeTestJob({ id: 'mark-fail' });
    await store.upsertJob(job);

    await store.markJobRun('mark-fail', false, '执行超时', '投递失败');
    const loaded = await store.getJob('mark-fail');
    expect(loaded!.lastStatus).toBe('failed');
    expect(loaded!.lastError).toBe('执行超时');
    expect(loaded!.lastDeliveryError).toBe('投递失败');
  });

  it('应该能更新下次运行时间', async () => {
    store = await createStore('nextrun_test.db');
    const job = makeTestJob({ id: 'next-run' });
    await store.upsertJob(job);

    const future = '2026-06-15T10:00:00.000Z';
    await store.updateNextRun('next-run', future);
    const loaded = await store.getJob('next-run');
    expect(loaded!.nextRunAt).toBe(future);
  });

  it('应该能暂停和恢复作业', async () => {
    store = await createStore('pause_test.db');
    const job = makeTestJob({ id: 'pause-resume' });
    await store.upsertJob(job);

    await store.pauseJob('pause-resume', '维护中');
    let loaded = await store.getJob('pause-resume');
    expect(loaded!.state).toBe('paused');
    expect(loaded!.pausedReason).toBe('维护中');
    expect(loaded!.pausedAt).toBeDefined();

    const future = new Date(Date.now() + 3600000).toISOString();
    await store.resumeJob('pause-resume', future);
    loaded = await store.getJob('pause-resume');
    expect(loaded!.state).toBe('scheduled');
    expect(loaded!.nextRunAt).toBe(future);
    expect(loaded!.pausedAt).toBeUndefined();
  });

  it('应该能删除作业', async () => {
    store = await createStore('delete_test.db');
    const job = makeTestJob({ id: 'delete-me' });
    await store.upsertJob(job);
    await store.deleteJob('delete-me');
    const loaded = await store.getJob('delete-me');
    expect(loaded).toBeUndefined();
  });

  it('应该能按条件过滤作业', async () => {
    store = await createStore('filter_test.db');
    const job1 = makeTestJob({ id: 'f1', enabled: true, state: 'scheduled' });
    const job2 = makeTestJob({ id: 'f2', enabled: false, state: 'paused' });
    const job3 = makeTestJob({ id: 'f3', enabled: true, state: 'scheduled' });
    await store.upsertJob(job1);
    await store.upsertJob(job2);
    await store.upsertJob(job3);

    const enabled = await store.loadJobs({ enabled: true });
    expect(enabled.length).toBe(2);

    const paused = await store.loadJobs({ state: 'paused' });
    expect(paused.length).toBe(1);
    expect(paused[0].id).toBe('f2');
  });

  it('应该返回正确的统计信息', async () => {
    store = await createStore('stats_test.db');
    const jobs = [
      makeTestJob({ id: 's1', enabled: true, state: 'scheduled' }),
      makeTestJob({ id: 's2', enabled: true, state: 'scheduled' }),
      makeTestJob({ id: 's3', enabled: false, state: 'paused' }),
      makeTestJob({ id: 's4', enabled: true, state: 'completed' }),
    ];
    for (const j of jobs) await store.upsertJob(j);

    const stats = await store.getStats();
    expect(stats.total).toBe(4);
    expect(stats.enabled).toBe(3);
    expect(stats.paused).toBe(1);
    expect(stats.completed).toBe(1);
  });
});

describe('CronScheduler', () => {
  let store: CronJobStore | null = null;
  let scheduler: CronScheduler | null = null;
  let executedJobs: string[] = [];
  let deliveredJobs: string[] = [];

  const createExecutor = (): SchedulerCallbacks => ({
    executeJob: async (job: CronJob): Promise<CronJobResult> => {
      executedJobs.push(job.id);
      return {
        success: true,
        output: `输出: ${job.name}`,
        finalResponse: `最终: ${job.name}`,
        durationMs: 100,
      };
    },
    dispatchDelivery: async (job: CronJob) => {
      deliveredJobs.push(job.id);
    },
  });

  afterEach(async () => {
    if (scheduler) {
      scheduler.stop();
      scheduler = null;
    }
    await closeStore(store);
    store = null;
    executedJobs = [];
    deliveredJobs = [];
  });

  it('应该正确初始化和停止', async () => {
    store = await createStore('sched_lifecycle.db');
    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
    });
    expect(scheduler.isRunning()).toBe(false);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('tick 应该获取并执行到期作业', async () => {
    store = await createStore('sched_tick.db');
    const job = makeTestJob({
      id: 'tick-test',
      nextRunAt: '2020-01-01T00:00:00.000Z',
    });
    await store.upsertJob(job);

    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
      jobTimeoutMs: 5000,
    });
    scheduler.start();

    const fired = await scheduler.tick();
    expect(fired).toBe(1);
    await scheduler.waitForAllJobs();

    expect(executedJobs).toContain('tick-test');
    expect(deliveredJobs).toContain('tick-test');

    const loaded = await store.getJob('tick-test');
    expect(loaded!.lastStatus).toBe('ok');
    expect(loaded!.lastRunAt).toBeDefined();
  });

  it('tick 应该跳过未来到期的作业', async () => {
    store = await createStore('sched_future.db');
    const job = makeTestJob({
      id: 'future-job',
      nextRunAt: '2099-12-31T00:00:00.000Z',
    });
    await store.upsertJob(job);

    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
    });
    scheduler.start();

    const fired = await scheduler.tick();
    expect(fired).toBe(0);
    expect(executedJobs).not.toContain('future-job');
  });

  it('达到重复次数上限后应标记完成', async () => {
    store = await createStore('sched_repeat.db');
    const job = makeTestJob({
      id: 'repeat-limit',
      nextRunAt: '2020-01-01T00:00:00.000Z',
      repeat: { times: 1, completed: 0 },
    });
    await store.upsertJob(job);

    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
      jobTimeoutMs: 5000,
    });
    scheduler.start();

    await scheduler.tick();
    await scheduler.waitForAllJobs();

    const loaded = await store.getJob('repeat-limit');
    expect(loaded!.state).toBe('completed');
  });

  it('tick 在调度器停止时应返回 0', async () => {
    store = await createStore('sched_stopped.db');
    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
    });
    scheduler.start();
    scheduler.stop();

    const result = await scheduler.tick();
    expect(result).toBe(0);
  });

  it('应该正确 report 调度器状态', async () => {
    store = await createStore('sched_status.db');
    scheduler = new CronScheduler(store, createExecutor(), {
      checkIntervalMs: 60000,
      enableLock: false,
    });

    const statusBefore = scheduler.getStatus();
    expect(statusBefore.running).toBe(false);
    expect(statusBefore.activeJobs).toBe(0);
    expect(statusBefore.uptimeMs).toBe(0);

    scheduler.start();
    const statusAfter = scheduler.getStatus();
    expect(statusAfter.running).toBe(true);
    expect(statusAfter.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('作业执行失败时应记录错误', async () => {
    store = await createStore('sched_fail.db');
    const failExecutor: SchedulerCallbacks = {
      executeJob: async (): Promise<CronJobResult> => {
        throw new Error('模拟执行异常');
      },
    };

    const job = makeTestJob({
      id: 'exec-fail',
      nextRunAt: '2020-01-01T00:00:00.000Z',
    });
    await store.upsertJob(job);

    scheduler = new CronScheduler(store, failExecutor, {
      checkIntervalMs: 60000,
      enableLock: false,
      jobTimeoutMs: 5000,
    });
    scheduler.start();

    await scheduler.tick();
    await scheduler.waitForAllJobs();

    const loaded = await store.getJob('exec-fail');
    expect(loaded!.lastStatus).toBe('failed');
    expect(loaded!.lastError).toBe('模拟执行异常');
  });
});

describe('CronScheduler - Cron 表达式解析', () => {
  let store: CronJobStore | null = null;
  let scheduler: CronScheduler | null = null;

  afterEach(async () => {
    if (scheduler) {
      scheduler.stop();
      scheduler = null;
    }
    await closeStore(store);
    store = null;
  });

  it('interval 调度应计算正确的下次运行时间', async () => {
    store = await createStore('cron_interval.db');
    const dummyExecutor: SchedulerCallbacks = {
      executeJob: async () => ({
        success: true,
        output: '',
        finalResponse: '',
        durationMs: 0,
      }),
    };
    scheduler = new CronScheduler(store, dummyExecutor, {
      enableLock: false,
      checkIntervalMs: 60000,
    });

    const job = makeTestJob({
      schedule: { kind: 'interval', minutes: 30, display: '每 30 分钟' },
    });

    const computeNext = (scheduler as any).computeNextRun.bind(scheduler);
    const next = computeNext(job);
    expect(next).not.toBeNull();
    if (next) {
      const diff = new Date(next).getTime() - Date.now();
      expect(diff).toBeGreaterThan(25 * 60 * 1000);
      expect(diff).toBeLessThan(35 * 60 * 1000);
    }
  });

  it('一次性作业应返回 null', async () => {
    store = await createStore('cron_once.db');
    const dummyExecutor: SchedulerCallbacks = {
      executeJob: async () => ({
        success: true,
        output: '',
        finalResponse: '',
        durationMs: 0,
      }),
    };
    scheduler = new CronScheduler(store, dummyExecutor, {
      enableLock: false,
      checkIntervalMs: 60000,
    });

    const job = makeTestJob({
      schedule: {
        kind: 'once',
        runAt: '2026-06-01T00:00:00.000Z',
        display: '一次性',
      },
    });

    const computeNext = (scheduler as any).computeNextRun.bind(scheduler);
    const next = computeNext(job);
    expect(next).toBeNull();
  });
});

describe('CronJob 状态流转守卫', () => {
  describe('isValidCronTransition', () => {
    it('scheduled → running 应合法', () => {
      expect(isValidCronTransition('scheduled', 'running')).toBe(true);
    });

    it('running → completed 应合法', () => {
      expect(isValidCronTransition('running', 'completed')).toBe(true);
    });

    it('running → failed 应合法', () => {
      expect(isValidCronTransition('running', 'failed')).toBe(true);
    });

    it('paused → scheduled 应合法', () => {
      expect(isValidCronTransition('paused', 'scheduled')).toBe(true);
    });

    it('completed → scheduled 应非法', () => {
      expect(isValidCronTransition('completed', 'scheduled')).toBe(false);
    });

    it('paused → running 应非法', () => {
      expect(isValidCronTransition('paused', 'running')).toBe(false);
    });

    it('completed → failed 应非法', () => {
      expect(isValidCronTransition('completed', 'failed')).toBe(false);
    });
  });

  describe('validateCronTransition', () => {
    it('合法转移不应抛出', () => {
      expect(() =>
        validateCronTransition('scheduled', 'running')
      ).not.toThrow();
      expect(() =>
        validateCronTransition('running', 'completed')
      ).not.toThrow();
      expect(() => validateCronTransition('paused', 'scheduled')).not.toThrow();
      expect(() => validateCronTransition('failed', 'scheduled')).not.toThrow();
    });

    it('非法转移应抛出错误', () => {
      expect(() => validateCronTransition('completed', 'scheduled')).toThrow(
        '非法状态转移'
      );
      expect(() => validateCronTransition('completed', 'running')).toThrow(
        '非法状态转移'
      );
      expect(() => validateCronTransition('paused', 'running')).toThrow(
        '非法状态转移'
      );
    });
  });

  describe('isTerminalCronState', () => {
    it('completed 应为终止状态', () => {
      expect(isTerminalCronState('completed')).toBe(true);
    });

    it('scheduled/running/paused/failed 不应为终止状态', () => {
      expect(isTerminalCronState('scheduled')).toBe(false);
      expect(isTerminalCronState('running')).toBe(false);
      expect(isTerminalCronState('paused')).toBe(false);
      expect(isTerminalCronState('failed')).toBe(false);
    });
  });

  describe('CRON_JOB_STATE_TRANSITIONS 表结构', () => {
    it('每个状态都有定义', () => {
      const states: Array<keyof typeof CRON_JOB_STATE_TRANSITIONS> = [
        'scheduled',
        'running',
        'completed',
        'paused',
        'failed',
      ];
      for (const s of states) {
        expect(CRON_JOB_STATE_TRANSITIONS[s]).toBeDefined();
        expect(Array.isArray(CRON_JOB_STATE_TRANSITIONS[s])).toBe(true);
      }
    });

    it('completed 的转移列表应为空', () => {
      expect(CRON_JOB_STATE_TRANSITIONS.completed).toEqual([]);
    });
  });

  describe('集成测试：CronJobStore 状态守卫', () => {
    let store: CronJobStore | null = null;

    afterEach(async () => {
      await closeStore(store);
    });

    it('pauseJob 在非法状态上应抛出', async () => {
      store = await createStore('guard_pause.db');
      const job = makeTestJob({
        id: 'guard-pause',
        state: 'completed',
      });
      await store.upsertJob(job);

      await expect(
        store.pauseJob('guard-pause', '不该暂停已完成')
      ).rejects.toThrow('非法状态转移');
    });

    it('resumeJob 在非法状态上应抛出', async () => {
      store = await createStore('guard_resume.db');
      const job = makeTestJob({
        id: 'guard-resume',
        state: 'running',
      });
      await store.upsertJob(job);

      const future = new Date(Date.now() + 3600000).toISOString();
      await expect(store.resumeJob('guard-resume', future)).rejects.toThrow(
        '非法状态转移'
      );
    });

    it('updateJobState 应拒绝非法转移', async () => {
      store = await createStore('guard_update.db');
      const job = makeTestJob({
        id: 'guard-update',
        state: 'completed',
      });
      await store.upsertJob(job);

      await expect(
        store.updateJobState('guard-update', 'scheduled')
      ).rejects.toThrow('非法状态转移');
    });

    it('updateJobState 应接受合法转移', async () => {
      store = await createStore('guard_ok.db');
      const job = makeTestJob({
        id: 'guard-ok',
        state: 'scheduled',
      });
      await store.upsertJob(job);

      await store.updateJobState('guard-ok', 'running');
      const loaded = await store.getJob('guard-ok');
      expect(loaded!.state).toBe('running');

      await store.updateJobState('guard-ok', 'completed');
      const loaded2 = await store.getJob('guard-ok');
      expect(loaded2!.state).toBe('completed');
    });

    it('updateJobState 对不存在的作业应抛出', async () => {
      store = await createStore('guard_nonexist.db');
      await expect(
        store.updateJobState('no-such-job', 'running')
      ).rejects.toThrow('作业不存在');
    });
  });
});

describe('DeliveryQueue', () => {
  let queue: DeliveryQueue | null = null;

  afterEach(async () => {
    if (queue) {
      await queue.close();
      queue = null;
    }
  });

  async function makeQueue(
    dbName: string,
    config?: Record<string, unknown>
  ): Promise<DeliveryQueue> {
    const q = new DeliveryQueue(join(TEST_DB_DIR, dbName), {
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 1000,
      defaultMaxAttempts: 3,
      ...config,
    } as any);
    await q.init();
    return q;
  }

  it('应该成功初始化和关闭', async () => {
    queue = await makeQueue('dq_init.db');
    expect(queue).toBeDefined();
  });

  it('应该能入队投递任务', async () => {
    queue = await makeQueue('dq_enqueue.db');
    const job = makeTestJob({ id: 'dq-job-1' });
    const result: CronJobResult = {
      success: true,
      output: '测试输出',
      finalResponse: '最终响应',
      durationMs: 100,
    };

    const entryId = await queue.enqueue(job, result);
    expect(entryId).toBeDefined();
    expect(entryId).toContain('dq-job-1');

    const stats = await queue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(1);
  });

  it('应该能获取待处理投递', async () => {
    queue = await makeQueue('dq_pending.db');
    const job = makeTestJob({ id: 'dq-pending' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    const pending = await queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0].jobId).toBe('dq-pending');
    expect(pending[0].status).toBe('pending');
    expect(pending[0].attempts).toBe(0);
    expect(pending[0].maxAttempts).toBe(3);
  });

  it('processNext 应处理待投递并标记完成', async () => {
    queue = await makeQueue('dq_process.db');
    const job = makeTestJob({ id: 'dq-process' });
    const result: CronJobResult = {
      success: true,
      output: 'ok',
      finalResponse: 'done',
      durationMs: 50,
    };
    await queue.enqueue(job, result);

    const processed = await queue.processNext(async (entry) => {
      expect(entry.jobId).toBe('dq-process');
      expect(entry.payload.result.output).toBe('ok');
      return true;
    });

    expect(processed).toBe(1);

    const stats = await queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.completed).toBe(1);
  });

  it('processNext 在 handler 返回 false 时应触发重试', async () => {
    queue = await makeQueue('dq_retry.db');
    const job = makeTestJob({ id: 'dq-retry' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    await queue.processNext(async () => false);

    const stats = await queue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(0);
  });

  it('超过最大重试次数后应标记为失败', async () => {
    queue = await makeQueue('dq_maxretry.db', {
      defaultMaxAttempts: 2,
      baseRetryDelayMs: 1,
    });
    const job = makeTestJob({ id: 'dq-maxretry' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    // 第一次重试（attempt 0 -> 1）
    await queue.processNext(async () => false);
    let stats = await queue.getStats();
    expect(stats.pending).toBe(1);

    // 等待 retryAt 到期（baseRetryDelayMs=1ms）
    await new Promise((r) => setTimeout(r, 10));

    // 第二次重试（attempt 1 -> 2, >= maxAttempts=2）
    await queue.processNext(async () => false);
    stats = await queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.failed).toBe(1);
  });

  it('应该能查询统计信息', async () => {
    queue = await makeQueue('dq_stats.db');

    let stats = await queue.getStats();
    expect(stats.total).toBe(0);

    const job = makeTestJob({ id: 'dq-stats' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    stats = await queue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.total).toBe(1);
  });

  it('should retryAllFailed reset failed entries to pending', async () => {
    queue = await makeQueue('dq_retryall.db', { defaultMaxAttempts: 1 });
    const job = makeTestJob({ id: 'dq-retryall' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    await queue.processNext(async () => false);
    let stats = await queue.getStats();
    expect(stats.failed).toBe(1);

    const count = await queue.retryAllFailed();
    expect(count).toBe(1);

    stats = await queue.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('应该能按 jobId 查询投递记录', async () => {
    queue = await makeQueue('dq_byjob.db');
    const job = makeTestJob({ id: 'dq-byjob' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    const entries = await queue.getEntriesByJobId('dq-byjob');
    expect(entries.length).toBe(1);
    expect(entries[0].jobId).toBe('dq-byjob');
  });

  it('应该能清理过期记录', async () => {
    queue = await makeQueue('dq_clean.db');
    const job = makeTestJob({ id: 'dq-clean' });
    const result: CronJobResult = {
      success: true,
      output: '',
      finalResponse: '',
      durationMs: 0,
    };
    await queue.enqueue(job, result);

    await queue.processNext(async () => true);
    const removed = await queue.cleanOlderThan(0);
    expect(removed).toBe(1);

    const stats = await queue.getStats();
    expect(stats.total).toBe(0);
  });

  describe('集成测试：CronScheduler + DeliveryQueue', () => {
    let store: CronJobStore | null = null;
    let scheduler: CronScheduler | null = null;
    let dq: DeliveryQueue | null = null;

    afterEach(async () => {
      if (scheduler) {
        scheduler.stop();
        scheduler = null;
      }
      if (dq) {
        await dq.close();
        dq = null;
      }
      await closeStore(store);
      store = null;
    });

    it('投递失败时应自动入队重试队列', async () => {
      store = await createStore('sched_dq_fail.db');
      dq = await makeQueue('sched_dq_fail_q.db');

      const failDispatch: SchedulerCallbacks = {
        executeJob: async () => ({
          success: true,
          output: 'ok',
          finalResponse: 'done',
          durationMs: 10,
        }),
        dispatchDelivery: async () => {
          throw new Error('投递失败');
        },
      };

      scheduler = new CronScheduler(
        store,
        failDispatch,
        {
          checkIntervalMs: 60000,
          enableLock: false,
          jobTimeoutMs: 5000,
        },
        dq
      );

      const job = makeTestJob({
        id: 'dq-integration',
        nextRunAt: '2020-01-01T00:00:00.000Z',
      });
      await store.upsertJob(job);

      scheduler.start();
      await scheduler.tick();
      await scheduler.waitForAllJobs();

      const entries = await dq.getEntriesByJobId('dq-integration');
      expect(entries.length).toBe(1);
      expect(entries[0].status).toBe('pending');
      expect(entries[0].lastError).toContain('投递失败');
    });

    it('投递成功时不应入队重试队列', async () => {
      store = await createStore('sched_dq_ok.db');
      dq = await makeQueue('sched_dq_ok_q.db');

      const okDispatch: SchedulerCallbacks = {
        executeJob: async () => ({
          success: true,
          output: 'ok',
          finalResponse: 'done',
          durationMs: 10,
        }),
        dispatchDelivery: async () => {},
      };

      scheduler = new CronScheduler(
        store,
        okDispatch,
        {
          checkIntervalMs: 60000,
          enableLock: false,
          jobTimeoutMs: 5000,
        },
        dq
      );

      const job = makeTestJob({
        id: 'dq-no-retry',
        nextRunAt: '2020-01-01T00:00:00.000Z',
      });
      await store.upsertJob(job);

      scheduler.start();
      await scheduler.tick();
      await scheduler.waitForAllJobs();

      const entries = await dq.getEntriesByJobId('dq-no-retry');
      expect(entries.length).toBe(0);
    });
  });
});

describe('P1-3: ownerKey/sessionKey 归属机制', () => {
  let store: CronJobStore | null = null;

  afterEach(async () => {
    await closeStore(store);
    store = null;
  });

  it('upsertJob 应保存 ownerKey 和 sessionKey', async () => {
    store = await createStore('owner_save.db');
    const job = makeTestJob({
      id: 'owner-test',
      ownerKey: 'user_abc',
      sessionKey: 'sess:u_abc:repl:1712345678:a1b2c3d4',
    });
    await store.upsertJob(job);

    const loaded = await store.getJob('owner-test');
    expect(loaded).toBeDefined();
    expect(loaded!.ownerKey).toBe('user_abc');
    expect(loaded!.sessionKey).toBe('sess:u_abc:repl:1712345678:a1b2c3d4');
  });

  it('ownerKey 和 sessionKey 默认应为 undefined', async () => {
    store = await createStore('owner_default.db');
    const job = makeTestJob({ id: 'owner-default' });
    delete (job as any).ownerKey;
    delete (job as any).sessionKey;
    await store.upsertJob(job);

    const loaded = await store.getJob('owner-default');
    expect(loaded!.ownerKey).toBeUndefined();
    expect(loaded!.sessionKey).toBeUndefined();
  });

  it('loadJobs 应支持按 ownerKey 筛选', async () => {
    store = await createStore('owner_filter.db');

    const jobAlice = makeTestJob({ id: 'alice-job', ownerKey: 'alice' });
    const jobBob = makeTestJob({ id: 'bob-job', ownerKey: 'bob' });
    await store.upsertJob(jobAlice);
    await store.upsertJob(jobBob);

    const aliceJobs = await store.loadJobs({ ownerKey: 'alice' });
    expect(aliceJobs.length).toBe(1);
    expect(aliceJobs[0].id).toBe('alice-job');

    const bobJobs = await store.loadJobs({ ownerKey: 'bob' });
    expect(bobJobs.length).toBe(1);
    expect(bobJobs[0].id).toBe('bob-job');
  });

  it('loadJobs 应支持按 sessionKey 筛选', async () => {
    store = await createStore('owner_session_filter.db');

    const job1 = makeTestJob({
      id: 'sess-1',
      sessionKey: 'sess:u1:repl:100:abc',
    });
    const job2 = makeTestJob({
      id: 'sess-2',
      sessionKey: 'sess:u2:cli:200:def',
    });
    await store.upsertJob(job1);
    await store.upsertJob(job2);

    const result = await store.loadJobs({ sessionKey: 'sess:u1:repl:100:abc' });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('sess-1');
  });

  it('loadJobs 应支持按 ownerKey + sessionKey 联合筛选', async () => {
    store = await createStore('owner_combined.db');

    const job = makeTestJob({
      id: 'combined',
      ownerKey: 'user_x',
      sessionKey: 'sess:x:web:300:xyz',
    });
    await store.upsertJob(job);

    const result = await store.loadJobs({
      ownerKey: 'user_x',
      sessionKey: 'sess:x:web:300:xyz',
    });
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('combined');

    const noMatch = await store.loadJobs({
      ownerKey: 'user_x',
      sessionKey: 'wrong-session',
    });
    expect(noMatch.length).toBe(0);
  });

  it('loadJobs 中不设置 ownerKey/sessionKey 应返回所有作业', async () => {
    store = await createStore('owner_all.db');
    await store.upsertJob(makeTestJob({ id: 'all-1', ownerKey: 'a' }));
    await store.upsertJob(makeTestJob({ id: 'all-2', ownerKey: 'b' }));

    const all = await store.loadJobs();
    expect(all.length).toBe(2);
  });
});
