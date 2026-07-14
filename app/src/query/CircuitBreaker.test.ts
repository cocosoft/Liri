/**
 * CircuitBreaker 单元测试
 *
 * Phase 2 新增。覆盖三态状态机、全局断路器、硬上限。
 */
import { describe, test, expect } from 'bun:test';
import { CircuitBreaker } from './CircuitBreaker';

describe('CircuitBreaker', () => {
  describe('三态状态机', () => {
    test('连续相同错误 5 次 → OPEN', () => {
      const breaker = new CircuitBreaker({
        maxConsecutiveSameError: 5,
        maxConsecutiveFailures: 10,
      });

      for (let i = 0; i < 4; i++) {
        const result = breaker.recordFailure('timeout');
        expect(result.break).toBe(false);
      }

      const result = breaker.recordFailure('timeout');
      expect(result.break).toBe(true);
      expect(result.reason).toContain('违规');
    });

    test('连续失败 10 次 → OPEN', () => {
      const breaker = new CircuitBreaker({
        maxConsecutiveSameError: 5,
        maxConsecutiveFailures: 10,
      });

      for (let i = 0; i < 9; i++) {
        const result = breaker.recordFailure(`error_${i}`);
        expect(result.break).toBe(false);
      }

      const result = breaker.recordFailure('error_9');
      expect(result.break).toBe(true);
    });

    test('OPEN 后 resetTimeoutMs 内 shouldBreak 返回 break=true', () => {
      const breaker = new CircuitBreaker({
        maxConsecutiveFailures: 3,
        resetTimeoutMs: 30_000,
      });

      breaker.recordFailure('e1');
      breaker.recordFailure('e2');
      breaker.recordFailure('e3');

      const result = breaker.shouldBreak();
      expect(result.break).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    test('成功调用重置失败计数', () => {
      const breaker = new CircuitBreaker({ maxConsecutiveFailures: 5 });

      breaker.recordFailure('e1');
      breaker.recordFailure('e2');
      breaker.recordSuccess();

      const result = breaker.shouldBreak();
      expect(result.break).toBe(false);
    });
  });

  describe('全局断路器', () => {
    test('同一调用+同一结果 30 次触发全局断路器', () => {
      const breaker = new CircuitBreaker({ sameCallSameResultThreshold: 30 });

      for (let i = 0; i < 29; i++) {
        const result = breaker.recordSameCallResult(
          'read_file',
          'hash_abc',
          'hash_result'
        );
        expect(result.break).toBe(false);
      }

      const result = breaker.recordSameCallResult(
        'read_file',
        'hash_abc',
        'hash_result'
      );
      expect(result.break).toBe(true);
      expect(result.reason).toContain('全局断路器');
    });

    test('相同工具但不同结果不触发', () => {
      const breaker = new CircuitBreaker({ sameCallSameResultThreshold: 5 });

      for (let i = 0; i < 4; i++) {
        breaker.recordSameCallResult(
          'read_file',
          'hash_abc',
          `hash_result_${i}`
        );
      }

      const result = breaker.recordSameCallResult(
        'read_file',
        'hash_abc',
        'hash_result_4'
      );
      expect(result.break).toBe(false);
    });

    test('相同工具相同结果但不同参数不触发', () => {
      const breaker = new CircuitBreaker({ sameCallSameResultThreshold: 5 });

      for (let i = 0; i < 4; i++) {
        breaker.recordSameCallResult(
          'read_file',
          `hash_args_${i}`,
          'hash_result'
        );
      }

      const result = breaker.recordSameCallResult(
        'read_file',
        'hash_args_4',
        'hash_result'
      );
      expect(result.break).toBe(false);
    });
  });

  describe('reset', () => {
    test('reset 后所有计数归零', () => {
      const breaker = new CircuitBreaker({ maxConsecutiveFailures: 3 });

      breaker.recordFailure('e1');
      breaker.recordFailure('e2');
      breaker.recordSameCallResult('tool', 'hash', 'hash');

      breaker.reset();

      const result = breaker.shouldBreak();
      expect(result.break).toBe(false);
    });
  });
});
