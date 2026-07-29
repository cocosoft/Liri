// MIT License
// Copyright (c) 2026 190615273@qq.com
import { describe, it, expect } from 'bun:test';
import {
  buildSelectionPrompt,
  parseSelectionResult,
  applySelection,
  type MemoryItem,
} from '../../src/memory/MemoryLLMSelector';

const sampleMemories: MemoryItem[] = [
  { id: 'm1', type: 'project_knowledge', content: '本项目使用 TypeScript + React，数据库为 SQLite', createdAt: 1000 },
  { id: 'm2', type: 'user_preference', content: '用户偏好简洁的代码风格，不喜欢过度抽象', createdAt: 2000 },
  { id: 'm3', type: 'decision', content: '决定使用 Zustand 作为状态管理方案', createdAt: 3000 },
  { id: 'm4', type: 'code_pattern', content: '所有 API 路由必须以 /v1/ 为前缀', createdAt: 4000 },
  { id: 'm5', type: 'user_fact', content: '用户名为张三，在腾讯工作', createdAt: 5000 },
];

describe('MemoryLLMSelector', () => {
  describe('buildSelectionPrompt', () => {
    it('generates prompt with memory list', () => {
      const prompt = buildSelectionPrompt('状态管理', sampleMemories);

      expect(prompt).toContain('memory selector');
      expect(prompt).toContain('状态管理');
      expect(prompt).toContain('m3');
      expect(prompt).toContain('Zustand');
    });

    it('truncates long content to 200 chars', () => {
      const longMemory: MemoryItem = {
        id: 'ml',
        type: 'project_knowledge',
        content: 'A'.repeat(500),
        createdAt: 0,
      };
      const prompt = buildSelectionPrompt('test', [longMemory]);
      // Content should be sliced to 200 chars
      expect(prompt).toContain('A'.repeat(200));
      expect(prompt).not.toContain('A'.repeat(201));
    });

    it('includes memory type in output', () => {
      const prompt = buildSelectionPrompt('test', [sampleMemories[0]]);
      expect(prompt).toContain('project_knowledge');
    });
  });

  describe('parseSelectionResult', () => {
    it('parses JSON array of IDs', () => {
      const result = parseSelectionResult('["m1", "m3", "m5"]');
      expect(result).toEqual(['m1', 'm3', 'm5']);
    });

    it('parses bracket notation without JSON quotes', () => {
      const result = parseSelectionResult('[m1, m3, m5]');
      expect(result).toEqual(['m1', 'm3', 'm5']);
    });

    it('handles JSON with extra whitespace', () => {
      const result = parseSelectionResult('  [ "m1" , "m2" ]  ');
      expect(result).toEqual(['m1', 'm2']);
    });

    it('returns empty array for completely invalid input', () => {
      expect(parseSelectionResult('not a json')).toEqual([]);
      expect(parseSelectionResult('')).toEqual([]);
    });

    it('returns empty for object JSON', () => {
      // Valid JSON but not an array — regex also won't match
      expect(parseSelectionResult('{ "key": "value" }')).toEqual([]);
    });

    it('extracts IDs from natural language with brackets', () => {
      const result = parseSelectionResult('Sure! Here are the IDs: [m1, m2, m3]');
      expect(result).toEqual(['m1', 'm2', 'm3']);
    });
  });

  describe('applySelection', () => {
    it('filters memories by selected IDs', () => {
      const selected = applySelection(sampleMemories, ['m2', 'm4']);

      expect(selected).toHaveLength(2);
      expect(selected[0].id).toBe('m2');
      expect(selected[1].id).toBe('m4');
    });

    it('returns top 5 when no IDs selected', () => {
      const selected = applySelection(sampleMemories, []);

      expect(selected).toHaveLength(5); // all 5 memories
    });

    it('returns empty when no matches', () => {
      const selected = applySelection(sampleMemories, ['nonexistent']);

      expect(selected).toHaveLength(0);
    });

    it('returns partial matches', () => {
      const selected = applySelection(sampleMemories, ['m1', 'nonexistent', 'm3']);

      expect(selected).toHaveLength(2);
      expect(selected[0].id).toBe('m1');
      expect(selected[1].id).toBe('m3');
    });

    it('limits to maxItems when no selection', () => {
      const manyMemories: MemoryItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        type: 'user_fact',
        content: `Memory ${i}`,
        createdAt: i * 1000,
      }));

      const selected = applySelection(manyMemories, []);
      expect(selected).toHaveLength(5); // DEFAULT_CONFIG.maxItems = 5
    });
  });
});
