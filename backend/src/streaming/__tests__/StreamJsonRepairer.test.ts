import { describe, it, expect } from 'bun:test';
import {
  repairIncompleteJson,
  repairToolCallArguments,
} from '../StreamJsonRepairer';

describe('StreamJsonRepairer', () => {
  describe('repairIncompleteJson', () => {
    it('完整 JSON 不修改', () => {
      expect(repairIncompleteJson('{"a":1}')).toBe('{"a":1}');
    });

    it('缺少闭合括号', () => {
      const result = repairIncompleteJson('{"a":1');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('嵌套对象缺括号', () => {
      const result = repairIncompleteJson('{"outer":{"inner":42}');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('数组缺括号', () => {
      const result = repairIncompleteJson('{"items":["a","b"');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('空字符串返回原值', () => {
      expect(repairIncompleteJson('')).toBe('');
    });

    it('尾部逗号修复', () => {
      const result = repairIncompleteJson('{"a":1,');
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('repairToolCallArguments', () => {
    it('完整参数不修改', () => {
      expect(repairToolCallArguments('{"path":"/test"}')).toBe(
        '{"path":"/test"}'
      );
    });

    it('截断的参数修复为可解析 JSON', () => {
      const result = repairToolCallArguments('{"path":"/test","l');
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('完全损坏返回 {}', () => {
      expect(repairToolCallArguments('not json at all')).toBe('{}');
    });
  });
});
