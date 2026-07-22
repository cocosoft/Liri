/**
 * P3-2.15: 集成测试 — handleError EventBus + 错误统计验证
 *
 * 验证 handleError 发布 error:occurred 事件 + getErrorStats() 返回数据。
 */

import { describe, it, expect } from 'bun:test';
import { globalEventBus } from '../../src/core/events/EventBus';
import { handleError, getErrorStats } from '../../src/error/handleError';
import { AppError, ErrorCategory, ErrorSeverity } from '../../src/error/types';

describe('handleError EventBus 集成测试', () => {
  it('CRITICAL 错误发布 error:occurred 事件', async () => {
    const events: unknown[] = [];
    const sub = globalEventBus.on('error:occurred', (event: unknown) => {
      events.push(event);
    });

    const criticalError = new AppError(
      '测试 CRITICAL 错误',
      ErrorCategory.EXECUTION,
      ErrorSeverity.CRITICAL,
      'TEST_CRITICAL',
    );

    await handleError(criticalError, {
      module: 'test:integration',
      action: 'testCritical',
    });

    expect(events.length).toBe(1);

    const event = events[0] as Record<string, unknown>;
    expect(event.severity).toBe('critical');
    expect(event.module).toBe('test:integration');
    expect(event.action).toBe('testCritical');
    expect(event.code).toBe('TEST_CRITICAL');

    sub.unsubscribe();
  });

  it('HIGH 错误发布 error:occurred 事件', async () => {
    const events: unknown[] = [];
    const sub = globalEventBus.on('error:occurred', (event: unknown) => {
      events.push(event);
    });

    const highError = new AppError(
      '测试 HIGH 错误',
      ErrorCategory.OPERATION,
      ErrorSeverity.HIGH,
      'TEST_HIGH',
    );

    await handleError(highError, {
      module: 'test:integration',
      action: 'testHigh',
    });

    expect(events.length).toBe(1);
    const event = events[0] as Record<string, unknown>;
    expect(event.severity).toBe('high');

    sub.unsubscribe();
  });

  it('MEDIUM 错误不发布 error:occurred 事件', async () => {
    const events: unknown[] = [];
    const sub = globalEventBus.on('error:occurred', (event: unknown) => {
      events.push(event);
    });

    const mediumError = new AppError(
      '测试 MEDIUM 错误',
      ErrorCategory.VALIDATION,
      ErrorSeverity.MEDIUM,
      'TEST_MEDIUM',
    );

    await handleError(mediumError, {
      module: 'test:integration',
      action: 'testMedium',
    });

    // MEDIUM 不应发布
    expect(events.length).toBe(0);

    sub.unsubscribe();
  });

  it('getErrorStats 返回正确的统计结构', async () => {
    // 触发几个错误以填充统计
    await handleError(
      new AppError('错误1', ErrorCategory.EXECUTION, ErrorSeverity.CRITICAL, 'E001'),
      { module: 'test:a' }
    );
    await handleError(
      new AppError('错误2', ErrorCategory.OPERATION, ErrorSeverity.HIGH, 'E002'),
      { module: 'test:b' }
    );

    const stats = getErrorStats();

    expect(typeof stats.total).toBe('number');
    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(stats.recent)).toBe(true);
    expect(stats.recent.length).toBeGreaterThan(0);

    // 验证最近记录格式
    const recent = stats.recent[0];
    expect(typeof recent.module).toBe('string');
    expect(typeof recent.category).toBe('string');
    expect(typeof recent.severity).toBe('string');
    expect(typeof recent.message).toBe('string');
    expect(typeof recent.timestamp).toBe('number');
  });
});
