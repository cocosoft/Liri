/**
 * 多租户 P3：AlwaysOn 归属配额与执行作用域
 *
 * 锁六件事：
 *  ① 配额按**归属**计数：同一租户的多个项目共享「每天 N 次 / 同时 M 个」；
 *  ② 不同归属互不影响（一个租户用满，另一个仍可运行）；
 *  ③ 每日次数**只在整轮跑完时**计入（无计划 / 中途失败不消耗）；并发位**整轮持有**；
 *  ④ 跨天惰性重置；
 *  ⑤ 有归属的项目在**归属者身份作用域内**执行（工具 cwd / 存储 / 事件随身份落位）；
 *  ⑥ 无归属（本地项目）⇒ 不查配额、不加作用域，行为与改造前一致。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AlwaysOnQuota } from '../../../src/tasks/alwayson/AlwaysOnQuota';
import { AlwaysOnManager } from '../../../src/tasks/alwayson/AlwaysOnManager';
import { AlwaysOnRuntime } from '../../../src/tasks/alwayson/AlwaysOnRuntime';
import { bootstrapAlwaysOn } from '../../../src/tasks/alwayson/AlwaysOnBootstrap';
import type { AlwaysOnBridge } from '../../../src/tasks/alwayson/AlwaysOnBridge';
import type { DiscoveryPlan } from '../../../src/tasks/alwayson/types';
import {
  getRequestPrincipal,
  isLocalPrincipal,
} from '../../../src/core/identity/requestScope';

const PLAN: DiscoveryPlan = {
  id: 'p1',
  summary: 's',
  actions: [{ type: 'inspect', description: 'd', params: {} }],
  riskLevel: 'low',
};

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'alwayson-quota-'));
});

afterEach(() => {
  try {
    rmSync(projectDir, { recursive: true, force: true });
  } catch {
    // Windows：句柄占用时交给系统清理
  }
});

/** 注入 4 阶段实现；discovery 时记录一次调用与当时的身份 */
function primeRuntime(runtime: AlwaysOnRuntime, onDiscovery: () => void): void {
  runtime.setDiscoveryFn(async () => {
    onDiscovery();
    return PLAN;
  });
  runtime.setWorkspaceFn(async () => '/tmp/alwayson-wt');
  runtime.setExecutionFn(async () => ({
    success: true,
    output: '',
    errors: [],
    toolCalls: 0,
    durationMs: 0,
  }));
  runtime.setReportFn(async () => '/tmp/alwayson-report.md');
}

describe('AlwaysOnQuota（按归属的配额账本）', () => {
  it('并发位整轮持有；每日次数只在成功完成后计入；异归属互不影响', () => {
    const quota = new AlwaysOnQuota({
      dailyRunsPerOwner: 2,
      maxConcurrentPerOwner: 1,
    });

    expect(quota.tryAcquire('acme:alice').allowed).toBe(true);
    // 并发位已被占（整轮持有）
    expect(quota.tryAcquire('acme:alice')).toEqual({
      allowed: false,
      reason: 'concurrent_quota',
    });
    // 只开始不完成 ⇒ 不消耗每日次数
    expect(quota.usageOf('acme:alice')).toEqual({ runsToday: 0, running: 1 });

    quota.recordRun('acme:alice'); // runsToday=1
    quota.release('acme:alice');
    expect(quota.tryAcquire('acme:alice').allowed).toBe(true);
    quota.recordRun('acme:alice'); // runsToday=2
    quota.release('acme:alice');

    expect(quota.tryAcquire('acme:alice')).toEqual({
      allowed: false,
      reason: 'daily_quota',
    });

    // 另一归属不受影响
    expect(quota.tryAcquire('acme:bob').allowed).toBe(true);
    expect(quota.usageOf('acme:alice')).toEqual({
      runsToday: 2,
      running: 0,
    });
  });

  it('release 幂等：不会把并发位减成负数', () => {
    const quota = new AlwaysOnQuota({ maxConcurrentPerOwner: 1 });
    quota.release('acme:alice');
    quota.release('acme:alice');
    expect(quota.usageOf('acme:alice')).toEqual({ runsToday: 0, running: 0 });
    expect(quota.tryAcquire('acme:alice').allowed).toBe(true);
  });

  it('跨天惰性重置（无需定时器）', () => {
    let now = Date.now();
    const quota = new AlwaysOnQuota(
      { dailyRunsPerOwner: 1, maxConcurrentPerOwner: 1 },
      () => now
    );

    expect(quota.tryAcquire('acme:alice').allowed).toBe(true);
    quota.recordRun('acme:alice');
    quota.release('acme:alice');
    expect(quota.tryAcquire('acme:alice')).toEqual({
      allowed: false,
      reason: 'daily_quota',
    });

    now += 24 * 60 * 60 * 1000;
    expect(quota.tryAcquire('acme:alice').allowed).toBe(true);
    quota.release('acme:alice');
    expect(quota.usageOf('acme:alice')).toEqual({ runsToday: 0, running: 0 });
  });
});

describe('AlwaysOnRuntime：归属配额与身份作用域', () => {
  it('同一租户的多个项目共享归属配额；不消耗他人配额', async () => {
    const manager = new AlwaysOnManager(
      {},
      { dailyRunsPerOwner: 1, maxConcurrentPerOwner: 1 }
    );
    const alice1 = manager.registerProject('p1', projectDir, 'acme:alice');
    const alice2 = manager.registerProject('p2', projectDir, 'acme:alice');
    const bob = manager.registerProject('p3', projectDir, 'acme:bob');

    const calls: string[] = [];
    const principals: string[] = [];
    const capture = (tag: string) => () => {
      calls.push(tag);
      const p = getRequestPrincipal();
      principals.push(`${p.tenantId}:${p.userId}`);
    };
    primeRuntime(alice1, capture('alice1'));
    primeRuntime(alice2, capture('alice2'));
    primeRuntime(bob, capture('bob'));

    await alice1.tryRun();
    await alice2.tryRun(); // 同一归属配额已用尽 ⇒ 不进入 discovery
    await bob.tryRun(); // 另一归属 ⇒ 放行

    expect(calls).toEqual(['alice1', 'bob']);
    expect(principals).toEqual(['acme:alice', 'acme:bob']);
  });

  it('本地项目（无归属）⇒ 不查配额、保持本地身份（零变更）', async () => {
    const quota = new AlwaysOnQuota({
      dailyRunsPerOwner: 1,
      maxConcurrentPerOwner: 1,
    });
    const runtime = new AlwaysOnRuntime({}, projectDir, undefined, quota);

    let runs = 0;
    let stayedLocal = true;
    primeRuntime(runtime, () => {
      runs += 1;
      if (!isLocalPrincipal()) stayedLocal = false;
    });

    await runtime.tryRun();
    // 跳过项目自身的 60 分钟冷却（与本用例无关的既有门控），让第二次真正开跑
    runtime.gates.setLastRun(0);
    await runtime.tryRun();

    expect(runs).toBe(2);
    expect(stayedLocal).toBe(true);
    // 本地项目不占用任何归属配额
    expect(quota.usageOf('local:local')).toEqual({
      runsToday: 0,
      running: 0,
    });
  });
  it('无计划的轮次不消耗归属次数（成功完成才计数）', async () => {
    const manager = new AlwaysOnManager(
      {},
      { dailyRunsPerOwner: 1, maxConcurrentPerOwner: 1 }
    );
    const runtime = manager.registerProject('p1', projectDir, 'acme:alice');

    let discoveries = 0;
    runtime.setDiscoveryFn(async () => {
      discoveries += 1;
      return null; // 本轮无计划 ⇒ 不应计入归属次数
    });

    await runtime.tryRun();
    // 跳过项目自身冷却（与本用例无关的既有门控），验证配额**没有**被消耗
    runtime.gates.setLastRun(0);
    await runtime.tryRun();

    expect(discoveries).toBe(2);
  });
});

describe('bootstrapAlwaysOn：归属随项目注册', () => {
  it('项目 ownerKey 传给运行时；本地项目保持空', () => {
    const manager = new AlwaysOnManager();
    const bridge = {
      discovery: async () => null,
      workspace: async () => '',
      execution: async () => ({
        success: true,
        output: '',
        errors: [],
        toolCalls: 0,
        durationMs: 0,
      }),
      report: async () => '',
    } as unknown as AlwaysOnBridge;

    const result = bootstrapAlwaysOn({
      enabled: true,
      manager,
      projects: [
        { id: 'owned', name: 'a', path: projectDir, ownerKey: 'acme:alice' },
        { id: 'local', name: 'b', path: projectDir },
      ],
      createBridge: () => bridge,
    });

    expect(result.started).toBe(true);
    expect(manager.getRuntime('owned')?.ownerKey).toBe('acme:alice');
    expect(manager.getRuntime('local')?.ownerKey).toBeUndefined();
  });
});
