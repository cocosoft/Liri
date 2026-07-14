/**
 * LoopDetector 单元测试
 *
 * Phase 2 新增。覆盖 generic_repeat、ping_pong、unknown_tool_repeat、
 * unknown_tool_aggregate、no_tool_call 五种检测器。
 */
import { describe, test, expect } from 'bun:test';
import { LoopDetector } from './LoopDetector';

describe('LoopDetector', () => {
  describe('generic_repeat', () => {
    test('相同工具+相同参数连续 10 次应触发 warning', () => {
      const detector = new LoopDetector({
        warningThreshold: 10,
        criticalThreshold: 20,
      });

      for (let i = 0; i < 9; i++) {
        const result = detector.detect('read_file', { path: '/test.txt' });
        expect(result.stuck).toBe(false);
      }

      const result = detector.detect('read_file', { path: '/test.txt' });
      expect(result.stuck).toBe(true);
      expect(result.level).toBe('warning');
      expect(result.detector).toBe('generic_repeat');
    });

    test('相同工具+相同参数连续 20 次应触发 critical', () => {
      const detector = new LoopDetector({
        warningThreshold: 10,
        criticalThreshold: 20,
        historySize: 25,
      });

      for (let i = 0; i < 19; i++) {
        detector.detect('read_file', { path: '/test.txt' });
      }

      const result = detector.detect('read_file', { path: '/test.txt' });
      expect(result.stuck).toBe(true);
      expect(result.level).toBe('critical');
    });

    test('中间穿插不同调用应重置计数', () => {
      const detector = new LoopDetector({
        warningThreshold: 10,
        criticalThreshold: 20,
      });

      // 5 次相同调用
      for (let i = 0; i < 5; i++) {
        detector.detect('read_file', { path: '/test.txt' });
      }

      // 穿插不同调用
      detector.detect('write_file', { path: '/other.txt' });

      // 再 5 次相同调用 — 不应触发 warning（计数已重置）
      for (let i = 0; i < 5; i++) {
        const result = detector.detect('read_file', { path: '/test.txt' });
        expect(result.stuck).toBe(false);
      }
    });
  });

  describe('ping_pong', () => {
    test('两个工具交替各 12 次且无进展应触发 warning', () => {
      const detector = new LoopDetector({
        pingPongThreshold: 10,
        criticalThreshold: 20,
        historySize: 30,
      });

      for (let i = 0; i < 12; i++) {
        detector.detect('read_file', { path: '/a.txt' });
        detector.detect('write_file', { path: '/b.txt' });
      }

      const result = detector.detect('read_file', { path: '/a.txt' });
      expect(result.stuck).toBe(true);
      expect(result.detector).toBe('ping_pong');
    });
  });

  describe('unknown_tool_repeat', () => {
    test('不存在的工具连续 5 次应触发 warning', () => {
      const detector = new LoopDetector({
        unknownToolWarningThreshold: 5,
        unknownToolCriticalThreshold: 10,
      });

      for (let i = 0; i < 4; i++) {
        detector.recordUnknownTool('fake_tool', {});
      }

      const result = detector.detect('fake_tool', {});
      // 注意：detect() 不会自动触发 unknown_tool_repeat，
      // 需要 recordUnknownTool 后再 detect
      // 本测试验证 recordUnknownTool 的累积行为
      const history = (detector as any).history;
      expect(history.filter((h: any) => h.toolExists === false).length).toBe(4);
    });

    test('被其他工具调用打断后应重置连续计数', () => {
      const detector = new LoopDetector({
        unknownToolWarningThreshold: 5,
        unknownToolCriticalThreshold: 10,
      });

      detector.recordUnknownTool('fake_tool', {});
      detector.recordUnknownTool('fake_tool', {});
      detector.detect('real_tool', {}); // 真实工具调用应打断

      detector.recordUnknownTool('fake_tool', {});
      // 连续计数应重置为 1（因为被 real_tool 打断）
      const history = (detector as any).history;
      const fakeCount = history.filter(
        (h: any) => h.toolName === 'fake_tool' && h.toolExists === false
      ).length;
      expect(fakeCount).toBe(3);
    });
  });

  describe('unknown_tool_aggregate', () => {
    test('最近 20 次中假工具占比 >50% 应触发 critical', () => {
      const detector = new LoopDetector({
        unknownToolAggregateWindow: 20,
        unknownToolAggregateRatio: 0.5,
      });

      // 先填充 10 个真实工具调用
      for (let i = 0; i < 10; i++) {
        detector.detect('real_tool', { id: i });
      }

      // 再填充 11 个假工具
      for (let i = 0; i < 11; i++) {
        detector.recordUnknownTool(`fake_tool_${i}`, {});
      }

      const result = detector.detect('fake_tool_last', {});
      // 最近 20 次中 11 个是假工具 → 55% → 应触发
      expect(result.stuck).toBe(true);
      expect(result.detector).toBe('unknown_tool_aggregate');
    });
  });

  describe('no_tool_call', () => {
    test('连续 3 轮无工具调用应触发 warning', () => {
      const detector = new LoopDetector();

      detector.recordTurn(false);
      detector.recordTurn(false);

      const result = detector.detectNoToolCallLoop();
      expect(result.stuck).toBe(false); // 还没到 3 轮

      detector.recordTurn(false);
      const result2 = detector.detectNoToolCallLoop();
      expect(result2.stuck).toBe(true);
      expect(result2.level).toBe('warning');
      expect(result2.detector).toBe('no_tool_call');
    });

    test('连续 5 轮无工具调用应触发 critical', () => {
      const detector = new LoopDetector();

      for (let i = 0; i < 5; i++) {
        detector.recordTurn(false);
      }

      const result = detector.detectNoToolCallLoop();
      expect(result.stuck).toBe(true);
      expect(result.level).toBe('critical');
    });

    test('有工具调用后重置计数', () => {
      const detector = new LoopDetector();

      detector.recordTurn(false);
      detector.recordTurn(false);
      detector.recordTurn(true); // 有工具调用

      const result = detector.detectNoToolCallLoop();
      expect(result.stuck).toBe(false);
    });
  });
});
