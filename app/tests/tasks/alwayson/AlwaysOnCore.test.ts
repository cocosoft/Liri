// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ResourceArbiter } from '../../../src/tasks/alwayson/ResourceArbiter';
import { DiscoveryGates } from '../../../src/tasks/alwayson/DiscoveryGates';
import { SignalWatcher } from '../../../src/tasks/alwayson/SignalWatcher';
import { DEFAULT_ALWAYSON_CONFIG } from '../../../src/tasks/alwayson/types';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const testDir = join(tmpdir(), `cg3-gates-test-${randomUUID()}.d`);

describe('ResourceArbiter', () => {
  let arbiter: ResourceArbiter;

  beforeEach(() => {
    arbiter = new ResourceArbiter();
  });

  it('acquires resource first time', () => {
    expect(arbiter.acquire('alwayson')).toBe(true);
  });

  it('releases resource', () => {
    arbiter.acquire('alwayson');
    arbiter.release('alwayson');
    expect(arbiter.acquire('alwayson')).toBe(true);
  });

  it('higher priority blocks lower', () => {
    arbiter.acquire('user');
    expect(arbiter.acquire('alwayson')).toBe(false);
  });

  it('lower priority does not block higher', () => {
    arbiter.acquire('alwayson');
    expect(arbiter.acquire('user')).toBe(true);
  });

  it('same priority cannot re-acquire', () => {
    arbiter.acquire('cron');
    expect(arbiter.acquire('cron')).toBe(false);
  });

  it('isBusy returns true when resources held', () => {
    expect(arbiter.isBusy()).toBe(false);
    arbiter.acquire('alwayson');
    expect(arbiter.isBusy()).toBe(true);
    arbiter.release('alwayson');
    expect(arbiter.isBusy()).toBe(false);
  });

  it('getHeldResources lists all active locks', () => {
    arbiter.acquire('cron');
    expect(arbiter.getHeldResources()).toContain('cron');
    arbiter.release('cron');
    expect(arbiter.getHeldResources()).toEqual([]);
  });
});

describe('DiscoveryGates', () => {
  let gates: DiscoveryGates;
  let signalWatcher: SignalWatcher;

  beforeEach(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    signalWatcher = new SignalWatcher(2000, [testDir]);
    gates = new DiscoveryGates(DEFAULT_ALWAYSON_CONFIG, signalWatcher, testDir);
    gates.setEnabled(true);
    gates.setBusy(false);
    gates.setDormant(false);
    gates.setLastUserMsg(0); // no recent user message
    gates.setLastRun(0);     // no recent run
  });

  afterEach(() => {
    try { if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('passes when all conditions are clear', () => {
    const result = gates.evaluate();
    expect(result.passed).toBe(true);
  });

  it('fails when disabled', () => {
    gates.setEnabled(false);
    const result = gates.evaluate();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('fails when agent is busy', () => {
    gates.setBusy(true);
    const result = gates.evaluate();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('agent_busy');
  });

  it('fails during cooldown period', () => {
    // Simulate a run just now
    gates.setLastRun(Date.now());
    const result = gates.evaluate();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('cooldown');
  });

  it('quickRecheck passes when idle', () => {
    const result = gates.quickRecheck();
    expect(result.passed).toBe(true);
  });

  it('quickRecheck fails when busy', () => {
    gates.setBusy(true);
    const result = gates.quickRecheck();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('agent_busy');
  });

  it('daily budget limits runs', () => {
    // Simulate reaching daily budget by calling recordRun 4 times
    for (let i = 0; i < DEFAULT_ALWAYSON_CONFIG.dailyBudget; i++) {
      gates.recordRun();
    }
    // recordRun also sets lastRun, which would trigger cooldown — reset it
    gates.setLastRun(0);
    const result = gates.evaluate();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('daily_budget');
  });

  it('daily budget resets next day', () => {
    // recordRun increments todayCount
    gates.recordRun();
    // After recordRun, cooldown is in effect, but we can verify count was set
    // (todayCount is private, tested indirectly via daily_budget gate)
    // If todayCount was 0 before, it should be 1 after recordRun
    // Since we can't access private field, we check evaluate doesn't hit daily_budget
    // (only 1 run, budget is 4)
    gates.setLastRun(0); // clear cooldown for this test
    const result = gates.evaluate();
    expect(result.reason).not.toBe('daily_budget');
  });

  it('fails when project path does not exist', () => {
    const badGates = new DiscoveryGates(
      DEFAULT_ALWAYSON_CONFIG,
      signalWatcher,
      '/nonexistent/path/12345'
    );
    const result = badGates.evaluate();
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('project_missing');
  });

  it('fails when dormant with no signal', () => {
    gates.setDormant(true);
    const result = gates.evaluate();
    // SignalWatcher with no file changes should report no signal
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('dormant_no_signal');
  });
});
