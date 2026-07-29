// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-11: Few-shot 示例管理系统测试
import { describe, it, expect } from 'bun:test';
import {
  BUILTIN_EXAMPLES,
  renderFewShotPrompt,
  findFewShotEntry,
  getFewShotToolNames,
  type FewShotEntry,
} from '../../src/tools/FewShotRegistry';

describe('FewShotRegistry — 示例管理系统', () => {
  describe('BUILTIN_EXAMPLES', () => {
    it('covers 10 core tools', () => {
      expect(BUILTIN_EXAMPLES.length).toBeGreaterThanOrEqual(10);
    });

    it('each tool has >= 3 examples', () => {
      for (const entry of BUILTIN_EXAMPLES) {
        expect(entry.examples.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('each example has required fields', () => {
      for (const entry of BUILTIN_EXAMPLES) {
        for (const ex of entry.examples) {
          expect(ex.scenario).toBeTruthy();
          expect(ex.expectedBehavior).toBeTruthy();
          expect(Array.isArray(ex.commonMistakes)).toBe(true);
        }
      }
    });

    it('each entry has usage guide', () => {
      for (const entry of BUILTIN_EXAMPLES) {
        expect(entry.usageGuide.length).toBeGreaterThan(0);
      }
    });

    it('all tool names are unique', () => {
      const names = BUILTIN_EXAMPLES.map((e) => e.toolName);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('renderFewShotPrompt', () => {
    it('renders prompt with tool name and usage guide', () => {
      const result = renderFewShotPrompt(BUILTIN_EXAMPLES[0]);
      expect(result).toContain('## read_file');
      expect(result).toContain('Usage:');
      expect(result).toContain('### Examples');
    });

    it('renders examples with common mistakes', () => {
      const result = renderFewShotPrompt(BUILTIN_EXAMPLES[0]);
      expect(result).toContain('Avoid:');
    });

    it('renders without examples section when empty', () => {
      const emptyEntry: FewShotEntry = {
        toolName: 'empty',
        usageGuide: 'No examples',
        examples: [],
      };
      const result = renderFewShotPrompt(emptyEntry);
      expect(result).not.toContain('### Examples');
    });
  });

  describe('findFewShotEntry', () => {
    it('finds entry by tool name', () => {
      const entry = findFewShotEntry('read_file');
      expect(entry).toBeDefined();
      expect(entry!.toolName).toBe('read_file');
    });

    it('returns undefined for unknown tool', () => {
      const entry = findFewShotEntry('nonexistent_tool');
      expect(entry).toBeUndefined();
    });

    it('finds all registered tools', () => {
      const names = ['read_file', 'write_file', 'grep', 'bash', 'edit_file',
        'glob', 'web_search', 'web_fetch', 'todo_write', 'ask_user_question'];
      for (const name of names) {
        expect(findFewShotEntry(name)).toBeDefined();
      }
    });
  });

  describe('getFewShotToolNames', () => {
    it('returns all registered tool names', () => {
      const names = getFewShotToolNames();
      expect(names).toContain('read_file');
      expect(names).toContain('glob');
      expect(names).toContain('todo_write');
    });

    it('count matches BUILTIN_EXAMPLES', () => {
      expect(getFewShotToolNames().length).toBe(BUILTIN_EXAMPLES.length);
    });
  });
});
