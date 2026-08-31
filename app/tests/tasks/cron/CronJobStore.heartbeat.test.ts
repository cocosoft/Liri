/**
 * CronJobStore 执行期心跳续租测试（P1-8，对标 Hermes heartbeat_run_claim）
 *
 * 覆盖：
 * - updateHeartbeat：更新 heartbeat_at，getJob 可读
 * - 心跳不改变作业状态（仅续租）
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CronJobStore } from '../../../src/tasks/cron/CronJobStore';
import type { CronJob, CronJobState } from '../../../src/tasks/cron/types';

let dbPath: string;
let store: CronJobStore;

function makeJob(id: string, state: CronJobState): CronJob {
  return {
    id,
    name: `job-${id}`,
    skills: [],
    schedule: { kind: 'interval', display: '每 60 分钟', minutes: 60 },
    repeat: { times: null, completed: 0 },
    enabled: true,
    state,
    deliver: 'local',
    createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  dbPath = join(tmpdir(), `cron-heartbeat-test-${Date.now()}.db`);
  store = new CronJobStore(dbPath);
  await store.init();
  await store.upsertJob(makeJob('job-1', 'scheduled'));
});

afterAll(async () => {
  await store.close();
  try {
    rmSync(dbPath, { force: true });
  } catch {
    // @ignore-catch
  }
});

describe('CronJobStore 执行期心跳（P1-8）', () => {
  test('updateHeartbeat：更新 heartbeat_at 且 getJob 可读', async () => {
    expect((await store.getJob('job-1'))?.heartbeatAt).toBeUndefined();
    await store.updateHeartbeat('job-1');
    const job = await store.getJob('job-1');
    expect(job?.heartbeatAt).toBeGreaterThan(0);
  });

  test('心跳不改变作业状态（仅续租）', async () => {
    await store.updateHeartbeat('job-1');
    const job = await store.getJob('job-1');
    expect(job?.state).toBe('scheduled');
  });

  test('heartbeatAt 持久化到行（cronJobToRow 往返）', async () => {
    const job = await store.getJob('job-1');
    const snapshot = job?.heartbeatAt;
    expect(snapshot).toBeGreaterThan(0);
    // upsert 后仍保留
    await store.upsertJob({ ...(job as CronJob) });
    expect((await store.getJob('job-1'))?.heartbeatAt).toBe(snapshot);
  });
});
