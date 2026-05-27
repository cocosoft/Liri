/**
 * 告警系统单元测试
 * 覆盖 AlertManager、AlertRule、告警通知、冷却机制
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  AlertManager,
  AlertLevel,
  createAlertManager,
} from '../../src/monitoring/alerts/AlertManager.js';
import type { AlertRule, AlertNotification } from '../../src/monitoring/alerts/AlertManager.js';

describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager({
      enabled: true,
      maxAlerts: 50,
      defaultCooldown: 100, // 测试用短冷却
    });
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  it('创建告警管理器实例', () => {
    expect(manager).toBeDefined();
  });

  it('createAlertManager 工厂函数', () => {
    const m = createAlertManager({ enabled: false });
    expect(m).toBeDefined();
  });

  it('注册默认规则（4条内置规则）', () => {
    const rules = manager.getRules();
    expect(rules.length).toBe(4);

    const ids = rules.map((r) => r.id);
    expect(ids).toContain('memory-high');
    expect(ids).toContain('cpu-high');
    expect(ids).toContain('response-time-high');
    expect(ids).toContain('error-rate-high');
  });

  it('注册自定义规则', () => {
    const rule: AlertRule = {
      id: 'custom-rule',
      name: '自定义规则',
      description: '测试用自定义规则',
      level: AlertLevel.INFO,
      condition: () => true,
      message: '自定义告警触发',
      enabled: true,
      cooldown: 0,
    };

    manager.registerRule(rule);
    const rules = manager.getRules();
    expect(rules.length).toBe(5);
    expect(rules.find((r) => r.id === 'custom-rule')).toBeDefined();
  });

  it('注销规则', () => {
    manager.unregisterRule('memory-high');
    const rules = manager.getRules();
    expect(rules.find((r) => r.id === 'memory-high')).toBeUndefined();
  });

  it('启用/禁用规则', () => {
    manager.disableRule('memory-high');
    let rule = manager.getRule('memory-high');
    expect(rule!.enabled).toBe(false);

    manager.enableRule('memory-high');
    rule = manager.getRule('memory-high');
    expect(rule!.enabled).toBe(true);
  });

  it('禁用规则后不触发告警', () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    manager.disableRule('memory-high');

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(triggered.length).toBe(0);
  });

  it('禁用管理器后不评估规则', () => {
    const disabledManager = new AlertManager({ enabled: false });

    const triggered: AlertNotification[] = [];
    disabledManager.on('alert', (n) => { triggered.push(n); });

    disabledManager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(triggered.length).toBe(0);
  });

  it('条件满足时触发告警', () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(triggered.length).toBe(1);
    expect(triggered[0].ruleId).toBe('memory-high');
    expect(triggered[0].level).toBe(AlertLevel.WARNING);
  });

  it('多个条件同时满足时触发多个告警', () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
      'cpu.user': [90],
      'response.time': [2000],
      'error.rate': [10],
    });

    expect(triggered.length).toBe(4);
  });

  it('冷却期内不重复触发同一规则', () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    const metrics = { 'memory.heapUsed': [1024 * 1024 * 1024 + 1] };

    manager.evaluateRules(metrics);
    expect(triggered.length).toBe(1);

    manager.evaluateRules(metrics);
    expect(triggered.length).toBe(1);
  });

  it('冷却期过后可再次触发', async () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    // 注册一个自定义规则，cooldown 短于默认值
    manager.registerRule({
      id: 'test-cooldown',
      name: '冷却测试',
      description: '',
      level: AlertLevel.INFO,
      condition: (m) => (m['test.value']?.[0] ?? 0) > 0,
      message: 'cooldown test',
      enabled: true,
      cooldown: 100,
    });

    const metrics = { 'test.value': [1] };

    // 第一次触发
    manager.evaluateRules(metrics);
    expect(triggered.length).toBe(1);

    // 冷却期内不重复触发
    manager.evaluateRules(metrics);
    expect(triggered.length).toBe(1);

    // 等待冷却期过后
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 冷却期后可再次触发
    manager.evaluateRules(metrics);
    expect(triggered.length).toBe(2);
  });

  it('添加处理器接收告警通知', () => {
    const handled: AlertNotification[] = [];

    manager.addHandler((notification) => {
      handled.push(notification);
    });

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(handled.length).toBe(1);
    expect(handled[0].ruleName).toBe('内存使用过高');
  });

  it('移除处理器后不再接收通知', () => {
    const handled: AlertNotification[] = [];

    const handler = (notification: AlertNotification) => {
      handled.push(notification);
    };

    manager.addHandler(handler);
    manager.removeHandler(handler);

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(handled.length).toBe(0);
  });

  it('获取告警列表', () => {
    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
      'cpu.user': [90],
    });

    const alerts = manager.getAlerts();
    expect(alerts.length).toBe(2);
  });

  it('获取最近告警', () => {
    for (let i = 0; i < 5; i++) {
      manager.evaluateRules({
        'memory.heapUsed': [1024 * 1024 * 1024 + 1],
      });
      // 等待冷却期过后再触发
    }

    const recent = manager.getRecentAlerts(1);
    expect(recent.length).toBe(1);
  });

  it('清除告警列表', () => {
    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(manager.getAlerts().length).toBe(1);

    manager.clearAlerts();
    expect(manager.getAlerts().length).toBe(0);
  });

  it('获取告警统计', () => {
    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
      'cpu.user': [90],
    });

    const stats = manager.getStats();
    expect(stats.totalAlerts).toBe(2);
    expect(stats.totalRules).toBe(4);
    expect(stats.activeRules).toBe(4);
    expect(stats.alertsByLevel[AlertLevel.WARNING]).toBe(2);
  });

  it('告警数量超过上限时丢弃最早告警', () => {
    const smallManager = new AlertManager({ maxAlerts: 2, defaultCooldown: 0 });

    // 注册一个始终触发的规则
    smallManager.registerRule({
      id: 'always-trigger',
      name: '始终触发',
      description: '',
      level: AlertLevel.INFO,
      condition: () => true,
      message: 'always',
      enabled: true,
      cooldown: 0,
    });

    smallManager.evaluateRules({ 'test': [1] });
    smallManager.evaluateRules({ 'test': [1] });
    smallManager.evaluateRules({ 'test': [1] });

    expect(smallManager.getAlerts().length).toBe(2);
  });

  it('条件异常时不中断其他规则', () => {
    const triggered: AlertNotification[] = [];
    manager.on('alert', (n) => { triggered.push(n); });

    manager.registerRule({
      id: 'failing-rule',
      name: '会失败的规则',
      description: '',
      level: AlertLevel.INFO,
      condition: () => { throw new Error('oops'); },
      message: 'should not trigger',
      enabled: true,
      cooldown: 0,
    });

    manager.evaluateRules({
      'memory.heapUsed': [1024 * 1024 * 1024 + 1],
    });

    expect(triggered.length).toBe(1);
    expect(triggered[0].ruleId).toBe('memory-high');
  });

});
