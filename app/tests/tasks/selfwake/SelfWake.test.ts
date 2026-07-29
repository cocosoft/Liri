// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { WakeKind } from '../../../src/tasks/selfwake/types';
import type { WakeEntry } from '../../../src/tasks/selfwake/types';

// 覆盖 PYAPP_DATA_DIR，避免污染真实数据
const testDataDir = join(tmpdir(), `cg3-selfwake-test-${randomUUID()}.d`);
process.env.PYAPP_DATA_DIR = testDataDir;

// 动态导入：确保 env 在模块初始化前生效
const { WakeStore } = await import('../../../src/tasks/selfwake/WakeStore');
const { SelfWakeService } = await import('../../../src/tasks/selfwake/SelfWakeService');

describe('SelfWake', () => {
  beforeEach(() => {
    if (!existsSync(testDataDir)) mkdirSync(testDataDir, { recursive: true });
  });

  afterEach(() => {
    try {
      if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  describe('WakeStore', () => {
    it('saves and loads entries', async () => {
      const store = new WakeStore();
      const sessionId = 'test-session-1';
      const entry: WakeEntry = {
        id: randomUUID(),
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId,
        taskId: randomUUID(),
        triggerAt: Date.now() + 60_000,
        createdAt: Date.now(),
      };

      await store.save(sessionId, [entry]);
      const loaded = await store.load(sessionId);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(entry.id);
      expect(loaded[0].kind).toBe(WakeKind.TIMER);
      expect(loaded[0].status).toBe('pending');
    });

    it('marks entry as fired', async () => {
      const store = new WakeStore();
      const sessionId = 'test-session-2';
      const entry: WakeEntry = {
        id: randomUUID(),
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId,
        taskId: randomUUID(),
        triggerAt: Date.now() + 60_000,
        createdAt: Date.now(),
      };

      await store.save(sessionId, [entry]);
      await store.markFired(entry.id);

      const loaded = await store.load(sessionId);
      expect(loaded[0].status).toBe('fired');
      expect(loaded[0].firedAt).toBeGreaterThan(0);
    });

    it('filters due wakes', async () => {
      const store = new WakeStore();
      const sessionId = 'test-session-3';

      const due: WakeEntry = {
        id: randomUUID(),
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId,
        taskId: randomUUID(),
        triggerAt: Date.now() - 10_000,
        createdAt: Date.now() - 20_000,
      };

      const future: WakeEntry = {
        id: randomUUID(),
        kind: WakeKind.TIMER,
        status: 'pending',
        sessionId,
        taskId: randomUUID(),
        triggerAt: Date.now() + 3600_000,
        createdAt: Date.now(),
      };

      await store.save(sessionId, [due, future]);

      const dueWakes = await store.getDueWakes();
      expect(dueWakes).toHaveLength(1);
      expect(dueWakes[0].id).toBe(due.id);
    });

    it('gc removes old fired entries', async () => {
      const store = new WakeStore();
      const sessionId = 'test-session-4';
      const old: WakeEntry = {
        id: randomUUID(),
        kind: WakeKind.TIMER,
        status: 'fired',
        sessionId,
        taskId: randomUUID(),
        triggerAt: Date.now() - 100_000,
        createdAt: Date.now() - 200_000,
        firedAt: Date.now() - 100_000,
      };

      await store.save(sessionId, [old]);

      // gc with 1ms maxAge
      store.gc(1);

      const loaded = await store.load(sessionId);
      expect(loaded).toHaveLength(0);
    });
  });

  describe('SelfWakeService', () => {
    it('sleepFor creates a pending entry', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);
      const sessionId = 'svc-test-1';
      const taskId = randomUUID();

      const entry = await svc.sleepFor(sessionId, taskId, 30);

      expect(entry.status).toBe('pending');
      expect(entry.kind).toBe(WakeKind.TIMER);
      expect(entry.sessionId).toBe(sessionId);
      expect(entry.triggerAt).toBeGreaterThan(Date.now() + 25_000);
      expect(entry.triggerAt).toBeLessThan(Date.now() + 35_000);
    });

    it('sleepFor rejects >24h', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);

      await expect(
        svc.sleepFor('s', 't', 86401)
      ).rejects.toThrow('max is 24h');
    });

    it('sleepFor accepts exactly 24h', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);

      const entry = await svc.sleepFor('s', 't', 86400);
      expect(entry.status).toBe('pending');
    });

    it('sleepUntil parses ISO and delegates to sleepFor', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);
      const future = new Date(Date.now() + 120_000).toISOString();

      const entry = await svc.sleepUntil('svc-test-2', randomUUID(), future);

      expect(entry.status).toBe('pending');
      expect(entry.kind).toBe(WakeKind.TIMER);
    });

    it('sleepUntil rejects past time', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);
      const past = new Date(Date.now() - 60_000).toISOString();

      await expect(
        svc.sleepUntil('s', 't', past)
      ).rejects.toThrow('future');
    });

    it('wakeOnJob creates completion entry', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);
      const jobId = randomUUID();

      const entry = await svc.wakeOnJob('svc-test-3', randomUUID(), jobId);

      expect(entry.kind).toBe(WakeKind.COMPLETION);
      expect(entry.jobId).toBe(jobId);
    });

    it('wakeOnEvent creates event entry', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);

      const entry = await svc.wakeOnEvent('svc-test-4', randomUUID(), 'file_changed');

      expect(entry.kind).toBe(WakeKind.EVENT);
      expect(entry.eventKey).toBe('file_changed');
    });

    it('fire marks entry as fired', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);
      const sessionId = 'svc-test-5';
      const taskId = randomUUID();

      const entry = await svc.sleepFor(sessionId, taskId, 30);
      await svc.fire(entry.id);

      const loaded = await store.load(sessionId);
      expect(loaded[0].status).toBe('fired');
    });

    it('getDueWakes returns only due entries', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 300_000);

      // Create a fired entry (should not appear in due list)
      const firedEntry = await svc.sleepFor('s1', randomUUID(), 30);
      await svc.fire(firedEntry.id);

      // Create a pending entry with past triggerAt
      const pastEntry = await svc.sleepFor('s2', randomUUID(), 86400);
      // Manually set it as past via store
      const loaded = await store.load('s2');
      loaded[0].triggerAt = Date.now() - 10_000;
      await store.save('s2', loaded);

      const due = await svc.getDueWakes();
      const dueIds = due.map(d => d.id);
      expect(dueIds).toContain(pastEntry.id);
      expect(dueIds).not.toContain(firedEntry.id);
    });

    it('destroy cleans up short timers', async () => {
      const store = new WakeStore();
      const svc = new SelfWakeService(store, 50); // 50ms tick interval = very low

      // sleepFor with below-tick-interval duration → creates setTimeout
      await svc.sleepFor('s', 't', 0.01); // 10ms, below 50ms tick

      // destroy should clean up
      svc.destroy();
      // No assertion needed — verify no uncaught timer exception on destroy
    });
  });
});
