import { describe, it, expect, beforeEach } from 'bun:test';
import { ConfigSchema, configSchema } from '../../../src/config/schema/ConfigSchema.js';

describe('ConfigSchema', () => {

  let schema: ConfigSchema;

  beforeEach(() => {
    schema = new ConfigSchema();
  });

  it('should start with no categories', () => {
    expect(schema.getAllCategories()).toHaveLength(0);
  });

  it('should register a single item and create category automatically', () => {
    schema.registerItem('general', {
      key: 'theme',
      description: 'Theme setting',
      type: 'string',
      defaultValue: 'dark',
    });

    const categories = schema.getAllCategories();
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('general');
    expect(categories[0].items).toHaveLength(1);
    expect(categories[0].items[0].key).toBe('theme');
  });

  it('should retrieve registered item by key', () => {
    schema.registerItem('general', {
      key: 'theme',
      description: 'Theme setting',
      type: 'string',
      defaultValue: 'dark',
    });

    const item = schema.getItem('theme');
    expect(item).toBeDefined();
    expect(item!.key).toBe('theme');
    expect(item!.defaultValue).toBe('dark');
  });

  it('should return undefined for non-existent key', () => {
    expect(schema.getItem('nonexistent')).toBeUndefined();
  });

  it('should get category by name', () => {
    schema.registerItem('network', {
      key: 'port',
      description: 'Network port',
      type: 'number',
      defaultValue: 8080,
    });

    const cat = schema.getCategory('network');
    expect(cat).toBeDefined();
    expect(cat!.name).toBe('network');
  });

  it('should return undefined for non-existent category', () => {
    expect(schema.getCategory('nonexistent')).toBeUndefined();
  });

  it('should register multiple items in same category', () => {
    schema.registerItem('general', { key: 'a', description: 'A', type: 'string', defaultValue: '1' });
    schema.registerItem('general', { key: 'b', description: 'B', type: 'number', defaultValue: 2 });

    const cat = schema.getCategory('general');
    expect(cat!.items).toHaveLength(2);
    expect(schema.getItem('a')).toBeDefined();
    expect(schema.getItem('b')).toBeDefined();
  });

  it('should register items in different categories', () => {
    schema.registerItem('cat1', { key: 'k1', description: 'desc1', type: 'string', defaultValue: 'v1' });
    schema.registerItem('cat2', { key: 'k2', description: 'desc2', type: 'number', defaultValue: 2 });

    expect(schema.getAllCategories()).toHaveLength(2);
  });

});

describe('ConfigSchema - registerCategory', () => {

  it('should register a full category with multiple items', () => {
    const schema = new ConfigSchema();
    schema.registerCategory({
      name: 'features',
      description: 'Feature flags',
      items: [
        {
          key: 'autoSave',
          description: 'Auto save',
          type: 'boolean',
          defaultValue: true,
        },
        {
          key: 'autoSync',
          description: 'Auto sync',
          type: 'boolean',
          defaultValue: false,
        },
      ],
    });

    expect(schema.getAllCategories()).toHaveLength(1);
    expect(schema.getItem('autoSave')).toBeDefined();
    expect(schema.getItem('autoSync')).toBeDefined();
    expect(schema.getCategory('features')!.items).toHaveLength(2);
  });

});

describe('ConfigSchema - validate', () => {

  let schema: ConfigSchema;

  beforeEach(() => {
    schema = new ConfigSchema();
    schema.registerItem('test', { key: 'str', description: 's', type: 'string', defaultValue: '' });
    schema.registerItem('test', { key: 'num', description: 'n', type: 'number', defaultValue: 0 });
    schema.registerItem('test', { key: 'bool', description: 'b', type: 'boolean', defaultValue: false });
    schema.registerItem('test', { key: 'arr', description: 'a', type: 'array', defaultValue: [] });
    schema.registerItem('test', { key: 'obj', description: 'o', type: 'object', defaultValue: {} });
  });

  it('should validate string type', () => {
    expect(schema.validate('str', 'hello').valid).toBe(true);
    expect(schema.validate('str', 42).valid).toBe(false);
  });

  it('should validate number type', () => {
    expect(schema.validate('num', 42).valid).toBe(true);
    expect(schema.validate('num', '42').valid).toBe(false);
  });

  it('should validate boolean type', () => {
    expect(schema.validate('bool', true).valid).toBe(true);
    expect(schema.validate('bool', 'true').valid).toBe(false);
  });

  it('should validate array type', () => {
    expect(schema.validate('arr', [1, 2]).valid).toBe(true);
    expect(schema.validate('arr', 'not-array').valid).toBe(false);
  });

  it('should validate object type', () => {
    expect(schema.validate('obj', { a: 1 }).valid).toBe(true);
    expect(schema.validate('obj', null).valid).toBe(false);
    expect(schema.validate('obj', [1, 2]).valid).toBe(false);
  });

  it('should validate enum constraint for strings', () => {
    schema.registerItem('test', {
      key: 'color',
      description: 'Color',
      type: 'string',
      defaultValue: 'red',
      enum: ['red', 'green', 'blue'],
    });

    expect(schema.validate('color', 'red').valid).toBe(true);
    expect(schema.validate('color', 'yellow').valid).toBe(false);
  });

  it('should validate min/max for numbers', () => {
    schema.registerItem('test', {
      key: 'age',
      description: 'Age',
      type: 'number',
      defaultValue: 18,
      min: 0,
      max: 150,
    });

    expect(schema.validate('age', 25).valid).toBe(true);
    expect(schema.validate('age', -1).valid).toBe(false);
    expect(schema.validate('age', 200).valid).toBe(false);
  });

  it('should validate pattern for strings', () => {
    schema.registerItem('test', {
      key: 'email',
      description: 'Email',
      type: 'string',
      defaultValue: '',
      pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
    });

    expect(schema.validate('email', 'test@example.com').valid).toBe(true);
    expect(schema.validate('email', 'invalid').valid).toBe(false);
  });

  it('should return valid for unknown keys', () => {
    expect(schema.validate('unknown_key', 'anything').valid).toBe(true);
  });

});

describe('ConfigSchema - getDefault', () => {

  it('should return default value for registered key', () => {
    const schema = new ConfigSchema();
    schema.registerItem('test', {
      key: 'timeout',
      description: 'Timeout',
      type: 'number',
      defaultValue: 5000,
    });

    expect(schema.getDefault('timeout')).toBe(5000);
  });

  it('should return undefined for unknown key', () => {
    const schema = new ConfigSchema();
    expect(schema.getDefault('unknown')).toBeUndefined();
  });

});

describe('ConfigSchema - getAllDefaults', () => {

  it('should return all defaults as a flat record', () => {
    const schema = new ConfigSchema();
    schema.registerItem('a', { key: 'k1', description: 'd1', type: 'string', defaultValue: 'v1' });
    schema.registerItem('b', { key: 'k2', description: 'd2', type: 'number', defaultValue: 42 });

    const defaults = schema.getAllDefaults();
    expect(defaults).toEqual({ k1: 'v1', k2: 42 });
  });

  it('should return empty object for empty schema', () => {
    const schema = new ConfigSchema();
    expect(schema.getAllDefaults()).toEqual({});
  });

});

describe('configSchema singleton', () => {

  it('should be a ConfigSchema instance', () => {
    expect(configSchema).toBeInstanceOf(ConfigSchema);
  });

});
