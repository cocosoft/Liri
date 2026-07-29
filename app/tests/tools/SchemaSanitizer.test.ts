// MIT License
// Copyright (c) 2026 190615273@qq.com

// P2-3: SchemaSanitizer 跨模型 JSON Schema 兼容性净化测试
import { describe, it, expect } from 'bun:test';
import { sanitizeSchema } from '../../src/tools/SchemaSanitizer';

describe('SchemaSanitizer — Schema 兼容性净化', () => {
  describe('Rule 1: 移除 $defs/$ref', () => {
    it('removes $defs for ollama provider', () => {
      const result = sanitizeSchema(
        { type: 'object', $defs: { foo: { type: 'string' } } },
        { provider: 'ollama' }
      );
      expect(result.modified).toBe(true);
      expect('$defs' in result.schema).toBe(false);
    });

    it('removes $ref for non-anthropic provider', () => {
      const result = sanitizeSchema(
        { type: 'object', $ref: '#/$defs/foo' },
        { provider: 'ollama' }
      );
      expect('$ref' in result.schema).toBe(false);
    });
  });

  describe('Rule 2: 移除 oneOf/anyOf/allOf', () => {
    it('removes oneOf for ollama', () => {
      const result = sanitizeSchema(
        { oneOf: [{ type: 'string' }, { type: 'number' }] },
        { provider: 'ollama' }
      );
      expect('oneOf' in result.schema).toBe(false);
    });

    it('removes anyOf for local provider', () => {
      const result = sanitizeSchema(
        { anyOf: [{ type: 'string' }] },
        { provider: 'local' }
      );
      expect('anyOf' in result.schema).toBe(false);
    });
  });

  describe('Rule 3: 扁平化深层嵌套', () => {
    it('flattens deeply nested object (sub-object at maxDepth)', () => {
      // Nesting depth: root→config→database→settings→connection (depth 4, >= maxDepth 3)
      // connection 的 host/port 应在 settings 层级被扁平化
      const schema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              database: {
                type: 'object',
                properties: {
                  settings: {
                    type: 'object',
                    properties: {
                      connection: {
                        type: 'object',
                        properties: {
                          host: { type: 'string' },
                          port: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const result = sanitizeSchema(schema, { provider: 'ollama' });
      expect(result.modified).toBe(true);
      expect(result.changes).toContain('flattened deep nesting (>3 levels)');
    });

    it('keeps shallow nesting intact', () => {
      const result = sanitizeSchema(
        {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'integer' },
          },
        },
        { provider: 'ollama' }
      );
      const props = result.schema.properties as Record<string, unknown>;
      expect(props.name).toBeDefined();
      expect(props.count).toBeDefined();
    });
  });

  describe('Rule 4: 移除 format 字段', () => {
    it('removes format from ollama provider', () => {
      const result = sanitizeSchema(
        { type: 'object', format: 'json', properties: { email: { type: 'string', format: 'email' } } },
        { provider: 'ollama' }
      );
      expect('format' in result.schema).toBe(false);
      const props = result.schema.properties as Record<string, unknown>;
      const email = props.email as Record<string, unknown>;
      expect('format' in email).toBe(false);
    });
  });

  describe('Rule 5: 移除 default 值', () => {
    it('removes default values for local provider', () => {
      const result = sanitizeSchema(
        {
          type: 'object',
          properties: { count: { type: 'integer', default: 10 } },
        },
        { provider: 'local' }
      );
      const props = result.schema.properties as Record<string, unknown>;
      expect('default' in (props.count as Record<string, unknown>)).toBe(false);
    });
  });

  describe('Rule 6: 截断大 enum', () => {
    it('truncates enum with >50 values', () => {
      const values = Array.from({ length: 100 }, (_, i) => `option_${i}`);
      const result = sanitizeSchema(
        { type: 'object', properties: { choice: { type: 'string', enum: values } } },
        { provider: 'ollama' }
      );
      const props = result.schema.properties as Record<string, unknown>;
      const choice = props.choice as Record<string, unknown>;
      expect((choice.enum as unknown[]).length).toBeLessThanOrEqual(50);
    });

    it('keeps small enum intact', () => {
      const result = sanitizeSchema(
        { type: 'object', properties: { color: { type: 'string', enum: ['red', 'green', 'blue'] } } },
        { provider: 'ollama' }
      );
      const props = result.schema.properties as Record<string, unknown>;
      const color = props.color as Record<string, unknown>;
      expect((color.enum as unknown[]).length).toBe(3);
    });
  });

  describe('Rule 7: 移除 patternProperties', () => {
    it('removes patternProperties', () => {
      const result = sanitizeSchema(
        { type: 'object', patternProperties: { '^S_': { type: 'integer' } } },
        { provider: 'ollama' }
      );
      expect('patternProperties' in result.schema).toBe(false);
    });
  });

  describe('不修改干净 schema', () => {
    it('returns unchanged when no violations', () => {
      const clean = {
        type: 'object',
        properties: { name: { type: 'string' }, count: { type: 'integer' } },
      };
      const result = sanitizeSchema(clean, { provider: 'ollama' });
      expect(result.modified).toBe(false);
    });
  });

  describe('provider 过滤', () => {
    it('skips ollama-only rules for openai', () => {
      const result = sanitizeSchema(
        { type: 'object', format: 'json', $defs: { x: { type: 'string' } } },
        { provider: 'openai' }
      );
      // $defs removal is ollama/local only, so should be kept for openai
      expect('$defs' in result.schema).toBe(true);
    });
  });
});
