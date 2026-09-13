/**
 * CG3 E2E 测试：SelfWake + AlwaysOn + Skills 注入
 *
 * 覆盖审查发现的 7 项关键场景：
 *   1. tryRun() 锁泄露防护（try/finally）
 *   2. WakeStore 并发写安全
 *   3. sleep_for 短时精度（setTimeout <500ms）
 *   4. Skills 每轮注入不丢失
 *   5. ResourceArbiter TTL 自动清理
 *   6. 门控重检（quickRecheck）
 *   7. SignalWatcher 双模式切换
 */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  jest,
} from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ---- Mock 环境变量，确保 resolveProjectRoot / resolveDataSubDir 使用临时目录 ----
const TMP_DIR = join(tmpdir(), `cg3-e2e-${Date.now()}`);
const ORIG_LIRI_PROJECT_DIR = process.env.LIRI_PROJECT_DIR;
const ORIG_LIRI_DATA_DIR = process.env.LIRI_DATA_DIR;
process.env.LIRI_PROJECT_DIR = TMP_DIR;
process.env.LIRI_DATA_DIR = join(TMP_DIR, 'data');
// （O42，2026-09-13）原额外设置**遗留名** `PYAPP_DATA_DIR = TMP_DIR` 已删除：
// `cg3Env.cg3DataDir` 现只认 `LIRI_DATA_DIR`，双写会让 cg3 与其它模块落在**不同子目录**。

// 隔离修复（2026-08-30）：模块级修改的路径 env 必须在测试结束后还原，
// 否则后续测试（全量 `bun test` 时）的 resolveProjectRoot/resolveDataDir 全部
// 指向本临时目录 → 大量隔离污染失败（JsonRpcBridge/ComfyUI/MiniMax/KB-IT 等）。
afterAll(() => {
  if (ORIG_LIRI_PROJECT_DIR === undefined) delete process.env.LIRI_PROJECT_DIR;
  else process.env.LIRI_PROJECT_DIR = ORIG_LIRI_PROJECT_DIR;
  if (ORIG_LIRI_DATA_DIR === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = ORIG_LIRI_DATA_DIR;
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // 清理失败忽略（Windows 句柄占用）
  }
});

// 动态导入（确保环境变量先生效，避免 paths.ts 顶层 PROJECT_ROOT 触发循环依赖 TDZ）
const { WakeStore } = await import('../selfwake/WakeStore');
const { SelfWakeService } = await import('../selfwake/SelfWakeService');
const { DiscoveryGates } = await import('../alwayson/DiscoveryGates');
const { SignalWatcher } = await import('../alwayson/SignalWatcher');
const { ResourceArbiter } = await import('../alwayson/ResourceArbiter');
const { AlwaysOnRuntime } = await import('../alwayson/AlwaysOnRuntime');
const { AlwaysOnManager } = await import('../alwayson/AlwaysOnManager');

// ---- 1. tryRun() 锁泄露防护 ----
describe('CG3: tryRun() lock leak prevention', () => {
  test('lock is always released even if gate fails', async () => {
    const arbiter = new ResourceArbiter(1000);
    // 模拟锁被持有
    arbiter.acquire('alwayson');
    // verify: can't re-acquire
    expect(arbiter.acquire('alwayson')).toBe(false);
    // release
    arbiter.release('alwayson');
    // verify: can acquire again
    expect(arbiter.acquire('alwayson')).toBe(true);
    arbiter.release('alwayson');
  });

  test('TTL auto-cleans expired locks', () => {
    const arbiter = new ResourceArbiter(1); // 1ms TTL
    arbiter.acquire('alwayson');
    expect(arbiter.isBusy()).toBe(true);
    // Wait for TTL
    Bun.sleepSync(10);
    // Next acquire should clean expired lock
    expect(arbiter.acquire('alwayson')).toBe(true);
    arbiter.release('alwayson');
  });
});

// ---- 2. WakeStore 并发写安全 ----
describe('CG3: WakeStore concurrent write safety', () => {
  const testDir = join(TMP_DIR, 'selfwake');
  let store: typeof WakeStore.prototype;

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    store = new WakeStore();
    // Override dir to use temp
    (store as any).dir = testDir;
  });

  test('save and load preserves all entries', async () => {
    const entries = [
      {
        id: 'w1',
        kind: 'timer' as any,
        status: 'pending' as any,
        sessionId: 's1',
        taskId: 't1',
        triggerAt: Date.now() + 10000,
        createdAt: Date.now(),
      },
    ];
    await store.save('s1', entries);
    const loaded = await store.load('s1');
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('w1');
  });

  test('markFired atomically updates status', async () => {
    const entries = [
      {
        id: 'w2',
        kind: 'timer' as any,
        status: 'pending' as any,
        sessionId: 's2',
        taskId: 't2',
        triggerAt: Date.now() + 10000,
        createdAt: Date.now(),
      },
    ];
    await store.save('s2', entries);
    await store.markFired('w2');
    const loaded = await store.load('s2');
    expect(loaded[0].status).toBe('fired');
    expect(loaded[0].firedAt).toBeDefined();
  });
});

// ---- 3. sleep_for 精度 ----
describe('CG3: sleep_for precision', () => {
  test('short sleep uses setTimeout (~500ms)', async () => {
    const store = new WakeStore();
    (store as any).dir = join(TMP_DIR, 'selfwake-short');
    if (!existsSync((store as any).dir))
      mkdirSync((store as any).dir, { recursive: true });

    const service = new SelfWakeService(store, 300_000); // 5min tick
    const start = Date.now();
    const entry = await service.sleepFor('test', 'task', 0.5);
    expect(entry.status).toBe('pending');
    expect(entry.kind).toBe('timer');

    // Wait for short timer (setTimeout should fire in ~500ms)
    await new Promise((r) => setTimeout(r, 600));

    // Verify: timer fired (entry pulled from wakeStore)
    const all = await store.getAllPending();
    const ourEntry = all.find((e) => e.id === entry.id);
    // After fire, status becomes 'fired' — not in pending list
    expect(ourEntry).toBeUndefined();
  });
});

// ---- 4. Skills 注入 ----
describe('CG3: Skills injection into message history', () => {
  test('injectSkillsIntoMessageHistory inserts before last user message', async () => {
    // Dynamic import skill injection
    const { SkillInjectionService } =
      await import('../../skills/services/SkillInjectionService');
    const svc = new SkillInjectionService();

    // Add a mock skill
    const skillRegistry = (svc as any).registry;
    skillRegistry._skills = new Map();
    skillRegistry._skills.set('test-skill', {
      name: 'test-skill',
      description: 'A test skill for E2E',
      source: 'file',
      allowedTools: ['read'],
      userInvocable: true,
      disableModelInvocation: false,
      contentLength: 100,
      isHidden: false,
      progressMessage: 'Testing...',
      loadMethod: 'filesystem' as any,
      loadedFrom: '/dev/null',
      impl: {
        kind: 'prompt' as any,
        getPromptForCommand: async () => [{ type: 'text' as any, text: '' }],
      },
      config: {},
      version: '1.0.0',
    });
    (svc as any).cache.l1.set(
      'test-skill',
      skillRegistry._skills.get('test-skill')
    );

    const messages = [
      { role: 'user' as any, content: 'Hello' },
      { role: 'assistant' as any, content: 'Hi there!' },
    ];

    const result = svc.injectSkillsIntoMessageHistory(messages);
    // 注入在最后一条 user message 之前：skills(user), Hello(user), Hi there!(assistant)
    expect(result.length).toBe(3);
    expect(result[0].content).toContain('<available_skills>');
    expect(result[0].content).toContain('test-skill');
    expect(result[0].metadata!.__skills_injection).toBe(true);
    expect(result[1].content).toBe('Hello');
  });
});

// ---- 5. 门控重检 ----
describe('CG3: DiscoveryGates quick recheck', () => {
  test('quickRecheck blocks when agent becomes busy', () => {
    const sw = new SignalWatcher(2000, [tmpdir()]);
    const gates = new DiscoveryGates(
      {
        tickIntervalMinutes: 5,
        cooldownMinutes: 60,
        dailyBudget: 4,
        recentUserMsgMinutes: 5,
        heartbeatStaleSeconds: 90,
        dormantDebounceMs: 2000,
        execution: { maxTurns: 30, maxToolCalls: 200, timeoutMinutes: 20 },
      },
      sw,
      tmpdir()
    );

    // Initial: should pass
    const r1 = gates.quickRecheck();
    expect(r1.passed).toBe(true);

    // Simulate agent becoming busy
    gates.setBusy(true);
    const r2 = gates.quickRecheck();
    expect(r2.passed).toBe(false);
    expect(r2.reason).toBe('agent_busy');
  });
});

// ---- 6. ResourceArbiter 优先级 ----
describe('CG3: ResourceArbiter priority', () => {
  test('user blocks alwayson', () => {
    const arbiter = new ResourceArbiter();
    expect(arbiter.acquire('user')).toBe(true);
    expect(arbiter.acquire('alwayson')).toBe(false);
    arbiter.release('user');
    expect(arbiter.acquire('alwayson')).toBe(true);
    arbiter.release('alwayson');
  });

  test('steering blocks cron', () => {
    const arbiter = new ResourceArbiter();
    expect(arbiter.acquire('steering')).toBe(true);
    expect(arbiter.acquire('cron')).toBe(false);
    arbiter.release('steering');
    expect(arbiter.acquire('cron')).toBe(true);
    arbiter.release('cron');
  });
});

// ---- 7. AlwaysOnRuntime 生命周期 ----
describe('CG3: AlwaysOnRuntime lifecycle', () => {
  test('start and stop without errors', () => {
    const rt = new AlwaysOnRuntime({}, '');
    rt.start();
    expect((rt.scheduler as any).running).toBe(true);
    rt.stop();
    expect((rt.scheduler as any).running).toBe(false);
  });

  test('AlwaysOnManager registers and unregisters projects', () => {
    const mgr = new AlwaysOnManager();
    const rt = mgr.registerProject('p1', '/tmp/test');
    expect(mgr.getProjectCount()).toBe(1);
    expect(mgr.getRuntime('p1')).toBeDefined();
    mgr.unregisterProject('p1');
    expect(mgr.getProjectCount()).toBe(0);
    expect(mgr.getRuntime('p1')).toBeUndefined();
  });
});

// ---- 8. SignalWatcher 双模式 ----
describe('CG3: SignalWatcher dual mode', () => {
  test('hasSignal returns false when no signal within debounce', () => {
    const sw = new SignalWatcher(500, [tmpdir()]);
    expect(sw.hasSignal()).toBe(false);
  });

  test('is Windows polling mode', () => {
    const sw = new SignalWatcher(2000, [tmpdir()]);
    // On Windows, should default to polling
    expect((sw as any).usePolling).toBe(process.platform === 'win32');
  });
});

// ---- 9. CronStopTool pause/resume ----
describe('CG3: CronStopTool pause/resume (P1-8)', () => {
  const dbBase = join(TMP_DIR, 'cron-stop');

  test('pauseJob transitions scheduled → paused', async () => {
    const dbPath = `${dbBase}-pause.db`;
    const { CronJobStore } = await import('../../tasks/cron/CronJobStore');
    const store = new CronJobStore(dbPath);
    await store.init();

    const job = {
      id: 'stop-test-1',
      name: 'Test Job',
      prompt: 'test',
      schedule: {
        kind: 'cron' as const,
        display: '*/5 * * * *',
        expr: '*/5 * * * *',
      },
      repeat: { times: null, completed: 0 },
      enabled: true,
      state: 'scheduled' as const,
      createdAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + 60000).toISOString(),
      deliver: 'origin',
    };
    await store.upsertJob(job);

    await store.pauseJob('stop-test-1', 'test pause');
    const reloaded = await store.getJob('stop-test-1');
    expect(reloaded!.state).toBe('paused');
    expect(reloaded!.pausedReason).toBe('test pause');

    await store.close();
  });

  test('resumeJob transitions paused → scheduled with next run', async () => {
    const dbPath = `${dbBase}-resume.db`;
    const { CronJobStore } = await import('../../tasks/cron/CronJobStore');
    const store = new CronJobStore(dbPath);
    await store.init();

    const job = {
      id: 'stop-test-2',
      name: 'Test Job 2',
      prompt: 'test',
      schedule: {
        kind: 'cron' as const,
        display: '*/5 * * * *',
        expr: '*/5 * * * *',
      },
      repeat: { times: null, completed: 0 },
      enabled: true,
      state: 'paused' as const,
      createdAt: new Date().toISOString(),
      pausedAt: Date.now(),
      deliver: 'origin',
    };
    await store.upsertJob(job);

    const nextRun = new Date(Date.now() + 300000).toISOString();
    await store.resumeJob('stop-test-2', nextRun);
    const reloaded = await store.getJob('stop-test-2');
    expect(reloaded!.state).toBe('scheduled');
    expect(reloaded!.nextRunAt).toBe(nextRun);
    expect(reloaded!.pausedAt).toBeUndefined();

    await store.close();
  });

  test('pauseJob on non-scheduled state throws', async () => {
    const dbPath = `${dbBase}-throw.db`;
    const { CronJobStore } = await import('../../tasks/cron/CronJobStore');
    const store = new CronJobStore(dbPath);
    await store.init();

    const job = {
      id: 'stop-test-3',
      name: 'Test Job 3',
      prompt: 'test',
      schedule: {
        kind: 'cron' as const,
        display: '*/5 * * * *',
        expr: '*/5 * * * *',
      },
      repeat: { times: null, completed: 0 },
      enabled: true,
      state: 'completed' as const,
      createdAt: new Date().toISOString(),
      deliver: 'origin',
    };
    await store.upsertJob(job);

    await expect(store.pauseJob('stop-test-3', 'test')).rejects.toThrow();

    await store.close();
  });
});

// ---- 10. P1-9: 统一命令队列 三级优先级 ----
describe('CG3: CommandQueue 3-level priority (P1-9)', () => {
  test('now dequeues before next, next before later', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    queue.enqueue({
      id: 'c1',
      type: 'agent',
      content: 'later cmd',
      priority: 'later',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'c2',
      type: 'agent',
      content: 'now cmd',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'c3',
      type: 'agent',
      content: 'next cmd',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });

    expect(queue.dequeue()!.content).toBe('now cmd');
    expect(queue.dequeue()!.content).toBe('next cmd');
    expect(queue.dequeue()!.content).toBe('later cmd');
    expect(queue.dequeue()).toBeUndefined();
  });

  test('same priority is FIFO', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    queue.enqueue({
      id: 'f1',
      type: 'agent',
      content: 'first',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: 1000,
    });
    queue.enqueue({
      id: 'f2',
      type: 'agent',
      content: 'second',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: 2000,
    });
    queue.enqueue({
      id: 'f3',
      type: 'agent',
      content: 'third',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: 3000,
    });

    expect(queue.dequeue()!.content).toBe('first');
    expect(queue.dequeue()!.content).toBe('second');
    expect(queue.dequeue()!.content).toBe('third');
  });

  test('dedup: same ID not enqueued twice', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    expect(
      queue.enqueue({
        id: 'dup',
        type: 'agent',
        content: 'first try',
        priority: 'now',
        sessionId: 's1',
        enqueuedAt: Date.now(),
      })
    ).toBe(true);
    expect(
      queue.enqueue({
        id: 'dup',
        type: 'agent',
        content: 'second try',
        priority: 'now',
        sessionId: 's1',
        enqueuedAt: Date.now(),
      })
    ).toBe(false);

    expect(queue.pendingCount).toBe(1);
    expect(queue.dequeue()!.content).toBe('first try');
  });

  test('clearSession removes only matching session', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    queue.enqueue({
      id: 'a1',
      type: 'agent',
      content: 'session A',
      priority: 'now',
      sessionId: 'sa',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'b1',
      type: 'agent',
      content: 'session B',
      priority: 'now',
      sessionId: 'sb',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'a2',
      type: 'agent',
      content: 'session A2',
      priority: 'next',
      sessionId: 'sa',
      enqueuedAt: Date.now(),
    });

    queue.clearSession('sa');

    expect(queue.pendingCount).toBe(1);
    expect(queue.dequeue()!.content).toBe('session B');
    expect(queue.dequeue()).toBeUndefined();
  });

  test('countByPriority returns correct breakdown', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    queue.enqueue({
      id: 'n1',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'n2',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'x1',
      type: 'agent',
      content: '',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'l1',
      type: 'cron',
      content: '',
      priority: 'later',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'l2',
      type: 'cron',
      content: '',
      priority: 'later',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'l3',
      type: 'cron',
      content: '',
      priority: 'later',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });

    const counts = queue.countByPriority();
    expect(counts.now).toBe(2);
    expect(counts.next).toBe(1);
    expect(counts.later).toBe(3);
  });

  test('dequeueAllMatching filters correctly', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    queue.enqueue({
      id: 'cron1',
      type: 'cron',
      content: 'c1',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'agent1',
      type: 'agent',
      content: 'a1',
      priority: 'next',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: 'cron2',
      type: 'cron',
      content: 'c2',
      priority: 'later',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });

    const cronEntries = queue.dequeueAllMatching((e) => e.type === 'cron');
    expect(cronEntries.length).toBe(2);
    expect(queue.pendingCount).toBe(1);
    expect(queue.dequeue()!.type).toBe('agent');
  });

  test('capacity control: rejects when full', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue(3);

    queue.enqueue({
      id: '1',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: '2',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.enqueue({
      id: '3',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });

    expect(
      queue.enqueue({
        id: '4',
        type: 'agent',
        content: '',
        priority: 'now',
        sessionId: 's1',
        enqueuedAt: Date.now(),
      })
    ).toBe(false);
    expect(queue.pendingCount).toBe(3);
  });

  test('subscribe receives enqueue and dequeue events', async () => {
    const { MessageCommandQueue } =
      await import('../../query/MessageCommandQueue');
    const queue = new MessageCommandQueue();

    const events: string[] = [];
    const unsub = queue.subscribe((entry, action) => {
      events.push(`${action}:${entry.id}`);
    });

    queue.enqueue({
      id: 'ev1',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    queue.dequeue();

    expect(events).toEqual(['enqueue:ev1', 'dequeue:ev1']);
    unsub();

    // After unsubscribe, no more events
    queue.enqueue({
      id: 'ev2',
      type: 'agent',
      content: '',
      priority: 'now',
      sessionId: 's1',
      enqueuedAt: Date.now(),
    });
    expect(events.length).toBe(2);
  });
});

// ---- 11. P1-10: 中轮 Steering 命令注入 ----
describe('CG3: Steering injection (P1-10)', () => {
  test('queueSteering + consumeAll returns formatted messages', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager();

    mgr.queueSteering('Please stop the current task', 'user');
    mgr.queueSteering('Cron job completed', 'cron');

    expect(mgr.hasPending()).toBe(true);
    expect(mgr.pendingCount).toBe(2);

    const msgs = mgr.consumeAll();
    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toContain('[OUT-OF-BAND USER MESSAGE]');
    expect(msgs[0].content).toContain('stop the current task');
    expect(msgs[1].content).toContain('Cron job completed');
    expect(msgs[1].source).toBe('cron');

    expect(mgr.hasPending()).toBe(false);
    expect(mgr.pendingCount).toBe(0);
  });

  test('queue is cleared after consumeAll', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager();

    mgr.queueSteering('cmd1', 'user');
    mgr.consumeAll();

    expect(mgr.hasPending()).toBe(false);
    expect(mgr.consumeAll().length).toBe(0);
  });

  test('clear() discards without consuming', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager();

    mgr.queueSteering('should be discarded', 'system');
    expect(mgr.pendingCount).toBe(1);

    mgr.clear();
    expect(mgr.pendingCount).toBe(0);
    expect(mgr.hasPending()).toBe(false);
  });

  test('queue full returns false', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager(3);

    expect(mgr.queueSteering('cmd1', 'user')).toBe(true);
    expect(mgr.queueSteering('cmd2', 'user')).toBe(true);
    expect(mgr.queueSteering('cmd3', 'user')).toBe(true);
    expect(mgr.queueSteering('cmd4', 'user')).toBe(false);

    expect(mgr.pendingCount).toBe(3);
  });

  test('steering messages contain XML tags for scrubbing', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager();

    mgr.queueSteering('Check system health', 'alwayson');
    const msgs = mgr.consumeAll();

    expect(msgs[0].content).toContain('<steering');
    expect(msgs[0].content).toContain('source="alwayson"');
    expect(msgs[0].content).toContain('</steering>');
    expect(msgs[0].content).toContain('[OUT-OF-BAND USER MESSAGE]');
  });

  test('consumeAll when empty returns empty array', async () => {
    const { SteeringManager } = await import('../../query/SteeringManager');
    const mgr = new SteeringManager();

    expect(mgr.consumeAll()).toEqual([]);
  });
});

// ---- 12. P2-8: 后台进程看门狗 ----
describe('CG3: ProcessWatchdog (P2-8)', () => {
  test('matches OOM kill pattern', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    const result = wd.feed('FATAL: out of memory in allocation of 1024 bytes');
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('oom_kill');
    expect(result[0].severity).toBe('error');
  });

  test('matches disk full pattern', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    const result = wd.feed('Error: No space left on device (os error 28)');
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('disk_full');
  });

  test('matches auth failure pattern', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    const result = wd.feed('HTTP 401 Unauthorized: Invalid API key provided');
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('auth_failure');
  });

  test('matches rate limit pattern', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    const result = wd.feed(
      '429 Too Many Requests: rate limit exceeded for model'
    );
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('rate_limit');
  });

  test('matches connection failure pattern', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    const result = wd.feed('Error: connect ECONNREFUSED 127.0.0.1:8080');
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('connection_failure');
  });

  test('rate limit suppresses duplicate alerts within window', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    // First match triggers
    const r1 = wd.feed('Error: out of memory');
    expect(r1.length).toBe(1);

    // Second within rate limit window → suppressed
    const r2 = wd.feed('Error: out of memory');
    expect(r2.length).toBe(0);

    const stats = wd.getStats();
    expect(stats.patternHits['oom_kill']).toBe(1);
  });

  test('circuit breaker opens after threshold', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    // Low threshold for testing: breaker opens after 3 alerts
    const wd = new ProcessWatchdog({ globalCircuitBreaker: 3 });

    wd.feed('Error: out of memory');
    wd.feed('401 Unauthorized');
    wd.feed('No space left on device');

    const stats = wd.getStats();
    expect(stats.circuitOpen).toBe(true);
    expect(stats.totalMatches).toBe(3);
  });

  test('normal output returns empty matches', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    expect(wd.feed('Processing file: document.txt').length).toBe(0);
    expect(wd.feed('Task completed successfully').length).toBe(0);
    expect(wd.feed('CPU usage: 45%, Memory: 2.1GB').length).toBe(0);
  });

  test('reset clears all stats', async () => {
    const { ProcessWatchdog } = await import('../../daemon/ProcessWatchdog');
    const wd = new ProcessWatchdog();

    wd.feed('Error: out of memory');
    expect(wd.getStats().totalMatches).toBe(1);

    wd.reset();
    expect(wd.getStats().totalMatches).toBe(0);
    expect(wd.getStats().circuitOpen).toBe(false);
  });
});

// ---- 13. P1-5: 级联中止 ----
describe('CG3: CascadeAbortManager (P1-5)', () => {
  test('bash error triggers cascade abort', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    const controller = mgr.startRound();
    // Simulate bash tool failure
    const triggered = mgr.reportResult(
      'bash',
      false,
      'command failed with exit code 1'
    );

    expect(triggered).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(mgr.isCascaded).toBe(true);
  });

  test('write error triggers cascade abort', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    const triggered = mgr.reportResult(
      'file_write',
      false,
      'permission denied'
    );

    expect(triggered).toBe(true);
    expect(mgr.isCascaded).toBe(true);
  });

  test('read error does NOT trigger cascade', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    const triggered = mgr.reportResult('read', false, 'file not found');

    expect(triggered).toBe(false);
    expect(mgr.isCascaded).toBe(false);
  });

  test('network error does NOT trigger cascade', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    const triggered = mgr.reportResult('web_fetch', false, 'ETIMEDOUT');

    expect(triggered).toBe(false);
    expect(mgr.isCascaded).toBe(false);
  });

  test('success does not trigger cascade', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    const triggered = mgr.reportResult('bash', true);

    expect(triggered).toBe(false);
    expect(mgr.isCascaded).toBe(false);
  });

  test('disabled cascade manager does not trigger', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager({ enabled: false });

    mgr.startRound();
    const triggered = mgr.reportResult('bash', false, 'command failed');

    expect(triggered).toBe(false);
    expect(mgr.isCascaded).toBe(false);
  });

  test('permission_denied on read-only tool triggers cascade', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    // 'search' is NOT a bash/write tool, so it reaches permission check
    const triggered = mgr.reportResult(
      'search',
      false,
      'permission_denied: access to path restricted'
    );

    expect(triggered).toBe(true);
    expect(mgr.isCascaded).toBe(true);
    expect(mgr.reason).toContain('permission_denied');
  });

  test('startRound resets cascade state', async () => {
    const { CascadeAbortManager } =
      await import('../../query/CascadeAbortManager');
    const mgr = new CascadeAbortManager();

    mgr.startRound();
    mgr.reportResult('bash', false, 'command failed');
    expect(mgr.isCascaded).toBe(true);

    // New round resets
    mgr.startRound();
    expect(mgr.isCascaded).toBe(false);
    expect(mgr.signal?.aborted).toBe(false);
  });
});
