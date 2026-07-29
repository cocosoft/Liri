// MIT License
// Copyright (c) 2026 190615273@qq.com

// P2-2: coerce_tool_args 类型强制修复测试
import { describe, it, expect } from 'bun:test';
import {
  coerceToolArgs,
  tryCoerceToolArgs,
  type ToolSchema,
} from '../../src/tools/ToolArgCoercer';

describe('ToolArgCoercer — 工具参数类型强制修复', () => {
  describe('#1 string → int', () => {
    it('coerces "42" to 42 for integer field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { count: { type: 'integer' } },
      };
      const result = coerceToolArgs({ count: '42' }, schema);
      expect(result.modified).toBe(true);
      expect(result.input.count).toBe(42);
      expect(result.changes[0].reason).toContain('coerced');
    });

    it('coerces "42" to 42 for int field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { count: { type: 'int' } },
      };
      const result = coerceToolArgs({ count: '42' }, schema);
      expect(result.input.count).toBe(42);
    });

    it('rejects "abc" as invalid int (keeps original)', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { count: { type: 'integer' } },
      };
      const result = coerceToolArgs({ count: 'abc' }, schema);
      expect(result.modified).toBe(false);
      expect(result.input.count).toBe('abc');
    });
  });

  describe('#2 string → bool', () => {
    it('coerces "true" to true', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
      };
      const result = coerceToolArgs({ enabled: 'true' }, schema);
      expect(result.input.enabled).toBe(true);
    });

    it('coerces "false" to false', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
      };
      const result = coerceToolArgs({ enabled: 'false' }, schema);
      expect(result.input.enabled).toBe(false);
    });

    it('coerces "True"/"False"/"yes"/"no" variants', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { a: { type: 'bool' }, b: { type: 'bool' }, c: { type: 'bool' }, d: { type: 'bool' } },
      };
      const result = coerceToolArgs({ a: 'True', b: 'False', c: 'yes', d: 'NO' }, schema);
      expect(result.input.a).toBe(true);
      expect(result.input.b).toBe(false);
      expect(result.input.c).toBe(true);
      expect(result.input.d).toBe(false);
    });
  });

  describe('#3 string → number', () => {
    it('coerces "3.14" to 3.14', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { ratio: { type: 'number' } },
      };
      const result = coerceToolArgs({ ratio: '3.14' }, schema);
      expect(result.input.ratio).toBe(3.14);
    });

    it('coerces "0.5" to 0.5 for float field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { score: { type: 'float' } },
      };
      const result = coerceToolArgs({ score: '0.5' }, schema);
      expect(result.input.score).toBe(0.5);
    });

    it('coerces negative numbers', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { delta: { type: 'number' } },
      };
      const result = coerceToolArgs({ delta: '-10.5' }, schema);
      expect(result.input.delta).toBe(-10.5);
    });
  });

  describe('#4 scalar → array', () => {
    it('wraps scalar in array when schema expects array', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      };
      const result = coerceToolArgs({ tags: 'typescript' }, schema);
      expect(result.modified).toBe(true);
      expect(result.input.tags).toEqual(['typescript']);
    });

    it('does not wrap existing array', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      };
      const result = coerceToolArgs({ tags: ['a', 'b'] }, schema);
      expect(result.modified).toBe(false);
      expect(result.input.tags).toEqual(['a', 'b']);
    });

    it('wraps number scalar in array', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'integer' } },
        },
      };
      const result = coerceToolArgs({ ids: 42 }, schema);
      expect(result.input.ids).toEqual([42]);
    });
  });

  describe('#5 JSON string → object/array', () => {
    it('parses JSON object string', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { config: { type: 'object' } },
      };
      const result = coerceToolArgs(
        { config: '{"port": 3000, "host": "localhost"}' },
        schema
      );
      expect(result.modified).toBe(true);
      expect(result.input.config).toEqual({ port: 3000, host: 'localhost' });
    });

    it('parses JSON array string', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { items: { type: 'array' } },
      };
      const result = coerceToolArgs(
        { items: '[1, 2, 3]' },
        schema
      );
      expect(result.input.items).toEqual([1, 2, 3]);
    });

    it('keeps invalid JSON as string', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { data: { type: 'object' } },
      };
      const result = coerceToolArgs(
        { data: '{invalid' },
        schema
      );
      expect(result.modified).toBe(false);
      expect(result.input.data).toBe('{invalid');
    });
  });

  describe('#6 null removal for non-nullable fields', () => {
    it('removes null field not in schema', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };
      const result = coerceToolArgs({ name: null, extra: 'x' }, schema);
      // name=null → not in required, should be removed
      expect(result.modified).toBe(true);
      // null field with no type → skipped (line 78: if (!prop.type) continue)
    });

    it('removes null from non-nullable optional field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { description: { type: 'string' } },
      };
      const result = coerceToolArgs({ description: null }, schema);
      expect(result.modified).toBe(true);
      expect('description' in result.input).toBe(false);
    });
  });

  describe('#7 extra key removal', () => {
    it('removes extra keys when additionalProperties=false', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      };
      const result = coerceToolArgs(
        { name: 'test', extraField: 'should-be-removed' },
        schema
      );
      expect(result.modified).toBe(true);
      expect('extraField' in result.input).toBe(false);
      expect(result.input.name).toBe('test');
    });

    it('keeps extra keys when additionalProperties not false', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };
      const result = coerceToolArgs(
        { name: 'test', extraField: 'keep' },
        schema
      );
      expect(result.modified).toBe(false);
      expect(result.input.extraField).toBe('keep');
    });

    it('removes multiple extra keys', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: { id: { type: 'integer' } },
        additionalProperties: false,
      };
      const result = coerceToolArgs(
        { id: 1, a: 1, b: 2, c: 3 },
        schema
      );
      expect(result.modified).toBe(true);
      expect(Object.keys(result.input)).toEqual(['id']);
    });
  });

  describe('tryCoerceToolArgs', () => {
    it('returns original input on error', () => {
      const result = tryCoerceToolArgs(
        { x: 1 },
        { type: 'object', properties: null as unknown as undefined }
      );
      // Properties null would crash coerceToolArgs directly, but tryCoerce catches
      expect(result.modified).toBe(false);
    });
  });

  describe('combined scenarios', () => {
    it('applies multiple fixes simultaneously', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          enabled: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      };
      const result = coerceToolArgs(
        { count: '42', enabled: 'true', tags: 'urgent', extra: 'remove' },
        schema
      );
      expect(result.input.count).toBe(42);
      expect(result.input.enabled).toBe(true);
      expect(result.input.tags).toEqual(['urgent']);
      expect('extra' in result.input).toBe(false);
      expect(result.changes.length).toBeGreaterThanOrEqual(4);
    });

    it('handles empty schema gracefully', () => {
      const result = coerceToolArgs({ x: 1 }, { type: 'object' });
      expect(result.modified).toBe(false);
      expect(result.input).toEqual({ x: 1 });
    });
  });
});
