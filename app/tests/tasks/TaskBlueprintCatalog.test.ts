// MIT License
// Copyright (c) 2026 190615273@qq.com

// P3-1: TaskBlueprintCatalog 任务蓝图目录测试
import { describe, it, expect } from 'bun:test';
import {
  findBlueprint,
  renderBlueprintPrompt,
  BUILTIN_BLUEPRINTS,
  type TaskBlueprint,
} from '../../src/tasks/TaskBlueprintCatalog';

describe('TaskBlueprintCatalog — 任务蓝图目录', () => {
  describe('BUILTIN_BLUEPRINTS', () => {
    it('contains 6 built-in blueprints', () => {
      expect(BUILTIN_BLUEPRINTS.length).toBe(6);
    });

    it('each blueprint has required fields', () => {
      for (const bp of BUILTIN_BLUEPRINTS) {
        expect(bp.id).toBeTruthy();
        expect(bp.name).toBeTruthy();
        expect(bp.description).toBeTruthy();
        expect(bp.category).toBeTruthy();
        expect(bp.promptTemplate).toBeTruthy();
        expect(Array.isArray(bp.slots)).toBe(true);
      }
    });

    it('all blueprint ids are unique', () => {
      const ids = BUILTIN_BLUEPRINTS.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('findBlueprint', () => {
    it('finds blueprint by exact id', () => {
      const bp = findBlueprint('daily-briefing');
      expect(bp).toBeDefined();
      expect(bp!.id).toBe('daily-briefing');
    });

    it('finds blueprint by description keyword', () => {
      // description: "每天早上生成一份个人简报..."
      const bp = findBlueprint('简报');
      expect(bp).toBeDefined();
      expect(bp!.id).toBe('daily-briefing');
    });

    it('returns undefined for no match', () => {
      const bp = findBlueprint('nonexistent-task-xyz');
      expect(bp).toBeUndefined();
    });
  });

  describe('renderBlueprintPrompt', () => {
    it('renders prompt without slot values', () => {
      const bp = BUILTIN_BLUEPRINTS[0];
      const result = renderBlueprintPrompt(bp, {});
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('replaces slot placeholders', () => {
      const blueprint: TaskBlueprint = {
        id: 'test',
        name: 'Test',
        description: 'Test blueprint',
        category: 'test',
        slots: [
          { name: 'name', type: 'text', label: 'Name', required: true },
        ],
        promptTemplate: 'Hello, {name}!',
      };
      const result = renderBlueprintPrompt(blueprint, { name: 'World' });
      expect(result).toContain('Hello, World!');
      expect(result).not.toContain('{name}');
    });

    it('clears unfilled optional placeholders', () => {
      const blueprint: TaskBlueprint = {
        id: 'test2',
        name: 'Test2',
        description: 'Test',
        category: 'test',
        slots: [
          { name: 'greeting', type: 'text', label: 'Greeting', required: true },
          { name: 'suffix', type: 'text', label: 'Suffix', required: false },
        ],
        promptTemplate: '{greeting}! {suffix} end',
      };
      const result = renderBlueprintPrompt(blueprint, { greeting: 'Hi' });
      expect(result).toContain('Hi');
      expect(result).not.toContain('{suffix}');
    });

    it('renders all slot values from builtin template', () => {
      const daily = BUILTIN_BLUEPRINTS.find((b) => b.id === 'daily-briefing')!;
      const values: Record<string, string> = {};
      for (const slot of daily.slots) {
        values[slot.name] = `test_${slot.name}`;
      }
      const result = renderBlueprintPrompt(daily, values);
      for (const slot of daily.slots) {
        expect(result).not.toContain(`{${slot.name}}`);
      }
    });
  });
});
