import { describe, it, expect, beforeEach, spyOn, afterEach } from 'bun:test';
import { ConfigDocGenerator } from '../../../src/config/schema/ConfigDocGenerator.js';
import { ConfigSchema } from '../../../src/config/schema/ConfigSchema.js';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function createPopulatedSchema(): ConfigSchema {
  const schema = new ConfigSchema();

  schema.registerItem('general', {
    key: 'theme',
    description: '应用主题',
    type: 'string',
    defaultValue: 'dark',
    enum: ['dark', 'light', 'system'],
    example: 'dark',
  });

  schema.registerItem('general', {
    key: 'language',
    description: '界面语言',
    type: 'string',
    defaultValue: 'zh-CN',
    enum: ['zh-CN', 'en', 'ja'],
  });

  schema.registerItem('network', {
    key: 'port',
    description: '监听端口',
    type: 'number',
    defaultValue: 8080,
    min: 1024,
    max: 65535,
    example: 3000,
  });

  schema.registerItem('network', {
    key: 'host',
    description: '监听地址',
    type: 'string',
    defaultValue: 'localhost',
    pattern: '^[\\w.-]+$',
  });

  return schema;
}

describe('ConfigDocGenerator', () => {

  let generator: ConfigDocGenerator;
  let emptyGenerator: ConfigDocGenerator;

  beforeEach(() => {
    generator = new ConfigDocGenerator(createPopulatedSchema());
    emptyGenerator = new ConfigDocGenerator(new ConfigSchema());
  });

  describe('generateMarkdown', () => {

    it('should generate markdown with title', () => {
      const md = generator.generateMarkdown();
      expect(md).toContain('# Liri 配置参考');
    });

    it('should include table of contents', () => {
      const md = generator.generateMarkdown();
      expect(md).toContain('## 目录');
      expect(md).toContain('[general]');
      expect(md).toContain('[network]');
    });

    it('should include category sections', () => {
      const md = generator.generateMarkdown();
      expect(md).toContain('## general');
      expect(md).toContain('## network');
    });

    it('should include configuration items', () => {
      const md = generator.generateMarkdown();
      expect(md).toContain('`theme`');
      expect(md).toContain('`port`');
      expect(md).toContain('`host`');
    });

    it('should include item details: type, default, enum', () => {
      const md = generator.generateMarkdown();
      expect(md).toContain('string');
      expect(md).toContain('dark');
      expect(md).toContain('`dark`');
      expect(md).toContain('`light`');
      expect(md).toContain('`system`');
    });

    it('should include validation constraints when showValidation is true', () => {
      const md = generator.generateMarkdown({ showValidation: true });
      expect(md).toContain('1024');
      expect(md).toContain('65535');
    });

    it('should include examples when showExamples is true', () => {
      const md = generator.generateMarkdown({ showExamples: true });
      expect(md).toContain('3000');
    });

    it('should exclude examples when showExamples is false', () => {
      const md = generator.generateMarkdown({ showExamples: false });
      expect(md).not.toContain('3000');
    });

    it('should exclude validation when showValidation is false', () => {
      const md = generator.generateMarkdown({ showValidation: false });
      expect(md).not.toContain('1024');
    });

    it('should include required marker for required items', () => {
      const schema = new ConfigSchema();
      schema.registerItem('test', {
        key: 'requiredKey',
        description: 'Required field',
        type: 'string',
        defaultValue: '',
        required: true,
      });
      const gen = new ConfigDocGenerator(schema);
      const md = gen.generateMarkdown();
      expect(md).toContain('必填');
    });

    it('should handle custom title option', () => {
      const md = generator.generateMarkdown({ title: 'Custom Title' });
      expect(md).toContain('# Custom Title');
    });

    it('should handle empty schema', () => {
      const md = emptyGenerator.generateMarkdown();
      expect(md).toContain('暂无注册的配置项');
    });

    it('should include item count in footer', () => {
      const md = generator.generateMarkdown();
      expect(md).toMatch(/共 \d+ 个分类，\d+ 个配置项/);
    });

  });

  describe('generateToFile', () => {

    it('should write markdown to file', () => {
      const tmpFile = join(tmpdir(), `test-config-doc-${Date.now()}.md`);
      try {
        const result = generator.generateToFile(tmpFile);
        expect(result).toBe(tmpFile);
        expect(existsSync(tmpFile)).toBe(true);
        const content = require('fs').readFileSync(tmpFile, 'utf-8');
        expect(content).toContain('Liri 配置参考');
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    });

  });

  describe('generateSummary', () => {

    it('should return summary table for populated schema', () => {
      const summary = generator.generateSummary();
      expect(summary).toContain('## 配置概览');
      expect(summary).toContain('| 配置键 |');
      expect(summary).toContain('`theme`');
      expect(summary).toContain('`port`');
    });

    it('should return empty message for empty schema', () => {
      const summary = emptyGenerator.generateSummary();
      expect(summary).toBe('暂无注册的配置项。');
    });

  });

  describe('generateItemDetail', () => {

    it('should return detail for existing key', () => {
      const detail = generator.generateItemDetail('theme');
      expect(detail).toBeTruthy();
      expect(detail!).toContain('theme');
      expect(detail!).toContain('应用主题');
    });

    it('should return null for non-existent key', () => {
      expect(generator.generateItemDetail('nonexistent')).toBeNull();
    });

  });

  describe('generateConfigDocs', () => {

    it('should be exported as a function', async () => {
      const mod = await import('../../../src/config/schema/ConfigDocGenerator.js');
      expect(typeof mod.generateConfigDocs).toBe('function');
      const result = mod.generateConfigDocs();
      expect(typeof result).toBe('string');
    });

  });

});
