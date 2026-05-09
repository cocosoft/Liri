import { describe, it, expect, beforeEach } from 'bun:test';
import {
  MultiSessionManager,
  SessionMode,
  SessionStatus,
} from './sessions/MultiSessionManager';
import { SmartCapacityManager } from './capacity/SmartCapacityManager';
import {
  DetailedSecurityChecker,
  SecurityLevel,
} from './security/DetailedSecurityChecker';

describe('MultiSessionManager', () => {
  let manager: MultiSessionManager;

  beforeEach(() => {
    manager = new MultiSessionManager();
  });

  it('creates a session', async () => {
    const session = await manager.createSession({
      id: 's1',
      mode: SessionMode.DEDICATED,
    });
    expect(session.config.id).toBe('s1');
    expect(session.config.mode).toBe(SessionMode.DEDICATED);
    expect(session.status).toBe(SessionStatus.ACTIVE);
  });

  it('creates session with default timeout', async () => {
    const session = await manager.createSession({
      id: 's2',
      mode: SessionMode.SHARED,
    });
    expect(session.config.timeoutMs).toBe(300000);
  });

  it('retrieves session by id', async () => {
    await manager.createSession({ id: 'find-me', mode: SessionMode.POOLED });
    const found = manager.getSession('find-me');
    expect(found).toBeDefined();
    expect(found!.config.id).toBe('find-me');
  });

  it('returns undefined for missing session', () => {
    const found = manager.getSession('nonexistent');
    expect(found).toBeUndefined();
  });

  it('lists all sessions', async () => {
    await manager.createSession({ id: 'a', mode: SessionMode.DEDICATED });
    await manager.createSession({ id: 'b', mode: SessionMode.SHARED });
    const list = manager.listSessions();
    expect(list.length).toBe(2);
  });

  it('filters sessions by mode', async () => {
    await manager.createSession({ id: 'd1', mode: SessionMode.DEDICATED });
    await manager.createSession({ id: 's1', mode: SessionMode.SHARED });
    const filtered = manager.listSessions({ mode: SessionMode.DEDICATED });
    expect(filtered.length).toBe(1);
    expect(filtered[0].config.id).toBe('d1');
  });

  it('filters sessions by status', async () => {
    await manager.createSession({ id: 'active1', mode: SessionMode.DEDICATED });
    await manager.createSession({ id: 'active2', mode: SessionMode.SHARED });
    const filtered = manager.listSessions({ status: SessionStatus.ACTIVE });
    expect(filtered.length).toBe(2);
  });

  it('updates session status', async () => {
    await manager.createSession({
      id: 'updatable',
      mode: SessionMode.DEDICATED,
    });
    const result = manager.updateSessionStatus('updatable', SessionStatus.IDLE);
    expect(result).toBe(true);
    expect(manager.getSession('updatable')!.status).toBe(SessionStatus.IDLE);
  });

  it('returns false when updating nonexistent session', () => {
    const result = manager.updateSessionStatus('ghost', SessionStatus.CLOSED);
    expect(result).toBe(false);
  });

  it('closes a session', async () => {
    await manager.createSession({
      id: 'close-me',
      mode: SessionMode.DEDICATED,
    });
    const closed = await manager.closeSession('close-me');
    expect(closed).toBe(true);
    expect(manager.getSession('close-me')!.status).toBe(SessionStatus.CLOSED);
  });

  it('returns false when closing nonexistent session', async () => {
    const result = await manager.closeSession('ghost');
    expect(result).toBe(false);
  });

  it('provides session stats', async () => {
    const s1 = await manager.createSession({
      id: 'stat1',
      mode: SessionMode.DEDICATED,
    });
    await manager.createSession({ id: 'stat2', mode: SessionMode.SHARED });
    await manager.closeSession(s1.config.id);
    const stats = manager.getStats();
    expect(stats.totalCreated).toBe(2);
    expect(stats.totalClosed).toBe(1);
    expect(stats.activeCount).toBe(1);
  });
});

describe('SmartCapacityManager', () => {
  let capacity: SmartCapacityManager;

  beforeEach(() => {
    capacity = new SmartCapacityManager();
  });

  it('returns empty analysis with no sessions', async () => {
    const status = await capacity.analyze();
    expect(status.currentLoad).toBe(0);
    expect(status.maxCapacity).toBe(100);
    expect(status.availableResources.sessionSlots).toBe(0);
  });

  it('registers sessions', () => {
    capacity.registerSession('sess1');
    capacity.registerSession('sess2');
    const metrics = capacity.getMetrics();
    expect(metrics.sessionSlots).toBe(2);
  });

  it('unregisters sessions', () => {
    capacity.registerSession('sess1');
    capacity.registerSession('sess2');
    capacity.unregisterSession('sess1');
    const metrics = capacity.getMetrics();
    expect(metrics.sessionSlots).toBe(1);
  });

  it('updates session load', async () => {
    capacity.registerSession('busy');
    capacity.updateSessionLoad('busy', 0.85);
    const status = await capacity.analyze();
    expect(status.currentLoad).toBe(85);
  });

  it('clamps load to valid range', () => {
    capacity.registerSession('over');
    capacity.updateSessionLoad('over', 1.5);
    const metrics = capacity.getMetrics();
    expect(metrics.cpuUsage).toBeLessThanOrEqual(100);
  });

  it('generates recommendations under load', async () => {
    capacity.registerSession('heavy');
    capacity.updateSessionLoad('heavy', 0.9);
    const status = await capacity.analyze();
    expect(status.recommendations.length).toBeGreaterThan(0);
    expect(status.recommendations[0]).not.toBe('系统运行正常，无需调整');
  });

  it('generates normal recommendation when idle', async () => {
    const status = await capacity.analyze();
    expect(status.recommendations).toContain('系统运行正常，无需调整');
  });

  it('generates load balance actions', async () => {
    capacity.registerSession('high1');
    capacity.registerSession('low1');
    capacity.updateSessionLoad('high1', 0.95);
    capacity.updateSessionLoad('low1', 0.1);
    const actions = await capacity.balanceLoad();
    expect(actions.length).toBeGreaterThan(0);
    expect(
      actions.some((a) => a.action === 'redirect' || a.action === 'throttle')
    ).toBe(true);
  });

  it('sets custom thresholds', () => {
    capacity.setThresholds({
      cpuPercent: 60,
      memoryPercent: 70,
      slotPercent: 80,
    });
    capacity.registerSession('heavy');
    capacity.updateSessionLoad('heavy', 0.7);
    const metrics = capacity.getMetrics();
    expect(metrics.cpuUsage).toBe(70);
  });
});

describe('DetailedSecurityChecker', () => {
  let checker: DetailedSecurityChecker;

  beforeEach(() => {
    checker = new DetailedSecurityChecker();
  });

  it('classifies low security', () => {
    const cls = checker.classifySecurity(SecurityLevel.LOW);
    expect(cls.level).toBe(SecurityLevel.LOW);
    expect(cls.requiredChecks).toContain('basic_auth');
    expect(cls.maxSessionDuration).toBe(86400000);
    expect(cls.allowedOperations).toContain('read');
  });

  it('classifies critical security', () => {
    const cls = checker.classifySecurity(SecurityLevel.CRITICAL);
    expect(cls.requiredChecks).toContain('audit_log');
    expect(cls.maxSessionDuration).toBe(1800000);
    expect(cls.allowedOperations).toContain('admin');
  });

  it('performs checks successfully', async () => {
    const result = await checker.performChecks('sess1', SecurityLevel.LOW);
    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('performs checks with all levels', async () => {
    for (const level of Object.values(SecurityLevel)) {
      const result = await checker.performChecks(
        'sessX',
        level as SecurityLevel
      );
      expect(result.passed).toBe(true);
    }
  });

  it('logs security actions', () => {
    checker.logAction('s1', 'exec_command', 'allowed', '执行命令 ls');
    const logs = checker.getSecurityLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].sessionId).toBe('s1');
    expect(logs[0].action).toBe('exec_command');
    expect(logs[0].result).toBe('allowed');
  });

  it('filters logs by session id', () => {
    checker.logAction('s1', 'read_file', 'allowed', '读取文件');
    checker.logAction('s2', 'exec_command', 'denied', '命令被拒绝');
    const filtered = checker.getSecurityLogs({ sessionId: 's1' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].sessionId).toBe('s1');
  });

  it('filters logs by time', async () => {
    checker.logAction('s1', 'old_action', 'allowed', '旧操作');
    await new Promise((r) => setTimeout(r, 5));
    const since = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    checker.logAction('s1', 'new_action', 'denied', '新操作');
    const filtered = checker.getSecurityLogs({ since });
    expect(filtered.length).toBe(1);
    expect(filtered[0].action).toBe('new_action');
  });

  it('limits log size', () => {
    for (let i = 0; i < 1100; i++) {
      checker.logAction(`s${i}`, 'op', 'allowed', '批量操作');
    }
    const logs = checker.getSecurityLogs();
    expect(logs.length).toBeLessThanOrEqual(1000);
  });

  it('generates recommendations on failures', async () => {
    const result = await checker.performChecks('s1', SecurityLevel.LOW);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Bridge Integration', () => {
  it('integrates multi-session with capacity management', async () => {
    const sm = new MultiSessionManager();
    const cm = new SmartCapacityManager();

    const s1 = await sm.createSession({
      id: 'int1',
      mode: SessionMode.DEDICATED,
    });
    const s2 = await sm.createSession({ id: 'int2', mode: SessionMode.SHARED });

    cm.registerSession(s1.config.id);
    cm.registerSession(s2.config.id);
    cm.updateSessionLoad(s1.config.id, 0.7);
    cm.updateSessionLoad(s2.config.id, 0.4);

    const status = await cm.analyze();
    expect(status.availableResources.sessionSlots).toBe(2);
    expect(Math.round(status.currentLoad)).toBe(55);

    const sessionList = sm.listSessions();
    expect(sessionList.length).toBe(2);
  });

  it('integrates security with session management', async () => {
    const sm = new MultiSessionManager();
    const sc = new DetailedSecurityChecker();

    const session = await sm.createSession({
      id: 'secure1',
      mode: SessionMode.DEDICATED,
    });
    const checkResult = await sc.performChecks(
      session.config.id,
      SecurityLevel.HIGH
    );
    expect(checkResult.passed).toBe(true);

    sc.logAction(
      session.config.id,
      'session_create',
      'allowed',
      '安全会话已创建'
    );

    const logs = sc.getSecurityLogs({ sessionId: 'secure1' });
    expect(logs.length).toBe(1);
  });

  it('coordinates all three components', async () => {
    const sm = new MultiSessionManager();
    const cm = new SmartCapacityManager();
    const sc = new DetailedSecurityChecker();

    const sessions = await Promise.all([
      sm.createSession({ id: 'all1', mode: SessionMode.DEDICATED }),
      sm.createSession({ id: 'all2', mode: SessionMode.SHARED }),
      sm.createSession({ id: 'all3', mode: SessionMode.POOLED }),
    ]);

    for (const s of sessions) {
      cm.registerSession(s.config.id);
      cm.updateSessionLoad(s.config.id, 0.3);
      sc.logAction(s.config.id, 'session_create', 'allowed', '会话创建');
    }

    const status = await cm.analyze();
    expect(status.availableResources.sessionSlots).toBe(3);

    const checks = await Promise.all(
      sessions.map((s) => sc.performChecks(s.config.id, SecurityLevel.MEDIUM))
    );
    expect(checks.every((c) => c.passed)).toBe(true);

    const logs = sc.getSecurityLogs();
    expect(logs.length).toBe(3);

    const stats = sm.getStats();
    expect(stats.activeCount).toBe(3);
  });
});
