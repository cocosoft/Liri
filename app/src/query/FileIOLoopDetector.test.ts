/**
 * FileIOLoopDetector 单元测试
 *
 * Phase 2 新增。覆盖读循环、写循环、跨文件交替循环、分页重置。
 *
 * 2026-09-29：工具名对齐**真实注册名**（read_file→file_read、write_file→file_write）。
 * 此前用 CC 旧名 ⇒ 检测器**不追踪**它们 ⇒ 计数从不递增 ⇒ 4 例断言**空过**（"warning=false" 恒真），
 * 而要求"应触发"的 4 例则长期失败（D-12）。
 */
import { describe, test, expect } from 'bun:test';
import { FileIOLoopDetector } from './FileIOLoopDetector';

describe('FileIOLoopDetector', () => {
  describe('读循环检测', () => {
    test('连续读同一文件 3 次应触发 warning', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');

      const result = detector.checkBeforeAccess('file_read', '/test.txt');
      expect(result.warning).toBe(true);
      expect(result.blocked).toBe(false);
    });

    test('连续读同一文件 4 次应触发 block', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');

      const result = detector.checkBeforeAccess('file_read', '/test.txt');
      expect(result.blocked).toBe(true);
      expect(result.warning).toBe(false);
    });

    test('读取不同文件应重置计数', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/other.txt');

      const result = detector.checkBeforeAccess('file_read', '/test.txt');
      expect(result.warning).toBe(false);
      expect(result.blocked).toBe(false);
    });

    test('分页读取（不同 offset/limit）不计为重复', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt', 0, 100);
      detector.checkBeforeAccess('file_read', '/test.txt', 100, 100);

      const result = detector.checkBeforeAccess(
        'file_read',
        '/test.txt',
        200,
        100
      );
      expect(result.warning).toBe(false);
      expect(result.blocked).toBe(false);
    });
  });

  describe('写循环检测', () => {
    test('连续写同一文件 4 次应触发 block', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_write', '/test.txt');
      detector.checkBeforeAccess('file_write', '/test.txt');
      detector.checkBeforeAccess('file_write', '/test.txt');

      const result = detector.checkBeforeAccess('file_write', '/test.txt');
      expect(result.blocked).toBe(true);
    });
  });

  describe('跨文件交替循环检测', () => {
    test('A→B→A→B→A→B 交替读取应触发 block', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      for (let i = 0; i < 3; i++) {
        detector.checkBeforeAccess('file_read', '/a.txt');
        detector.checkBeforeAccess('file_read', '/b.txt');
      }

      const result = detector.checkBeforeAccess('file_read', '/a.txt');
      expect(result.blocked).toBe(true);
    });
  });

  describe('非 IO 工具', () => {
    test('非读写工具调用应重置计数器', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');
      // 非 IO 工具
      detector.checkBeforeAccess('web_search', '/test.txt');

      const result = detector.checkBeforeAccess('file_read', '/test.txt');
      expect(result.warning).toBe(false);
    });
  });

  describe('reset', () => {
    test('reset 后所有计数归零', () => {
      const detector = new FileIOLoopDetector({
        warningThreshold: 3,
        blockThreshold: 4,
      });

      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.checkBeforeAccess('file_read', '/test.txt');
      detector.reset();

      const result = detector.checkBeforeAccess('file_read', '/test.txt');
      expect(result.warning).toBe(false);
    });
  });
});
