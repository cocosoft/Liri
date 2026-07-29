// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DiscoveryScheduler } from '../../../src/tasks/alwayson/DiscoveryScheduler';

describe('DiscoveryScheduler', () => {
  let scheduler: DiscoveryScheduler;
  let tickCount = 0;

  beforeEach(() => {
    tickCount = 0;
    // Create with 100ms interval for fast tests
    scheduler = new DiscoveryScheduler(0.001, () => {
      tickCount++;
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('starts and stops', async () => {
    expect(scheduler.isRunning()).toBe(false);

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('start is idempotent', () => {
    scheduler.start();
    scheduler.start(); // should not throw or create duplicate timers
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('fires callback on tick', async () => {
    scheduler.start();

    // Wait for at least one tick (100ms interval + buffer)
    await new Promise(r => setTimeout(r, 150));

    scheduler.stop();
    expect(tickCount).toBeGreaterThan(0);
  });

  it('does not fire callback after stop', async () => {
    scheduler.start();

    await new Promise(r => setTimeout(r, 50));
    scheduler.stop();

    const countAtStop = tickCount;

    // Wait more — should not increase
    await new Promise(r => setTimeout(r, 150));
    expect(tickCount).toBe(countAtStop);
  });

  it('stop is idempotent', () => {
    // stop on not-started scheduler should not throw
    scheduler.stop();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });
});
