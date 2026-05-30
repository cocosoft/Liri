import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import {
  sleep,
  deepClone,
  deepMerge,
  formatDate,
  generateId,
  truncate,
  ensureArray,
  isObject,
  safeJsonParse,
  retry,
  debounce,
  throttle,
  lazySingleton,
} from '../../src/utils/common.js';

describe('sleep', () => {

  it('should resolve after specified ms', async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it('should resolve with 0ms', async () => {
    await sleep(0);
    expect(true).toBe(true);
  });

});

describe('deepClone', () => {

  it('should clone a simple object', () => {
    const obj = { a: 1, b: 'hello', c: true };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it('should clone nested objects', () => {
    const obj = { a: { b: { c: 42 } } };
    const cloned = deepClone(obj);
    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a.b).not.toBe(obj.a.b);
  });

  it('should clone arrays', () => {
    const arr = [1, [2, 3], { a: 4 }];
    const cloned = deepClone(arr);
    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[1]).not.toBe(arr[1]);
  });

  it('should return primitives as-is', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone('hello')).toBe('hello');
    expect(deepClone(null)).toBeNull();
    expect(deepClone(undefined)).toBeUndefined();
    expect(deepClone(true)).toBe(true);
  });

  it('should not share references between clone and original', () => {
    const obj = { items: [{ id: 1 }] };
    const cloned = deepClone(obj);
    cloned.items[0].id = 999;
    expect(obj.items[0].id).toBe(1);
  });

});

describe('deepMerge', () => {

  it('should merge two flat objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('should merge nested objects recursively', () => {
    const result = deepMerge(
      { config: { theme: 'dark', size: 10 } },
      { config: { theme: 'light' } }
    );
    expect(result).toEqual({ config: { theme: 'light', size: 10 } });
  });

  it('should override with later values for same key (non-object)', () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result).toEqual({ a: 2 });
  });

  it('should handle arrays by overriding', () => {
    const result = deepMerge({ items: [1, 2] }, { items: [3, 4] });
    expect(result).toEqual({ items: [3, 4] });
  });

  it('should merge multiple objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 }, { c: 3 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('should handle single object', () => {
    const result = deepMerge({ a: 1 });
    expect(result).toEqual({ a: 1 });
  });

});

describe('formatDate', () => {

  it('should format date as YYYY-MM-DD HH:mm:ss', () => {
    const date = new Date(2024, 0, 15, 8, 30, 45);
    expect(formatDate(date)).toBe('2024-01-15 08:30:45');
  });

  it('should pad single digit months and days', () => {
    const date = new Date(2024, 2, 5, 3, 7, 9);
    expect(formatDate(date)).toBe('2024-03-05 03:07:09');
  });

  it('should handle December date', () => {
    const date = new Date(2024, 11, 25, 23, 59, 59);
    expect(formatDate(date)).toBe('2024-12-25 23:59:59');
  });

});

describe('generateId', () => {

  it('should generate an id with the given prefix', () => {
    const id = generateId('user');
    expect(id.startsWith('user_')).toBe(true);
  });

  it('should use "id" as default prefix', () => {
    const id = generateId();
    expect(id.startsWith('id_')).toBe(true);
  });

  it('should generate unique ids', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('should include timestamp', () => {
    const id = generateId();
    const parts = id.split('_');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThan(0);
  });

});

describe('truncate', () => {

  it('should return string as-is when shorter than maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should truncate string longer than maxLength', () => {
    const result = truncate('hello world', 8);
    expect(result).toBe('hello...');
    expect(result.length).toBe(8);
  });

  it('should handle exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should handle empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

});

describe('ensureArray', () => {

  it('should wrap non-array value in array', () => {
    expect(ensureArray('hello')).toEqual(['hello']);
  });

  it('should return array as-is', () => {
    const arr = [1, 2, 3];
    expect(ensureArray(arr)).toBe(arr);
  });

  it('should return empty array for null', () => {
    expect(ensureArray(null)).toEqual([]);
  });

  it('should return empty array for undefined', () => {
    expect(ensureArray(undefined)).toEqual([]);
  });

  it('should wrap number in array', () => {
    expect(ensureArray(42)).toEqual([42]);
  });

  it('should wrap object in array', () => {
    const obj = { a: 1 };
    expect(ensureArray(obj)).toEqual([obj]);
  });

});

describe('isObject', () => {

  it('should return true for plain object', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it('should return false for arrays', () => {
    expect(isObject([])).toBe(false);
  });

  it('should return false for null', () => {
    expect(isObject(null)).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isObject(42)).toBe(false);
    expect(isObject('hello')).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });

  it('should return true for Date objects', () => {
    expect(isObject(new Date())).toBe(true);
  });

});

describe('safeJsonParse', () => {

  it('should parse valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('should return fallback for invalid JSON', () => {
    expect(safeJsonParse('invalid', { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it('should return fallback for empty string', () => {
    expect(safeJsonParse('', 'default')).toBe('default');
  });

  it('should parse array JSON', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

});

describe('debounce', () => {

  it('should delay function execution', async () => {
    let callCount = 0;
    const fn = debounce(() => {
      callCount++;
    }, 20);

    fn();
    fn();
    fn();

    expect(callCount).toBe(0);
    await sleep(30);
    expect(callCount).toBe(1);
  });

});

describe('throttle', () => {

  it('should limit function calls', () => {
    let callCount = 0;
    const fn = throttle(() => {
      callCount++;
    }, 50);

    fn();
    fn();
    fn();

    expect(callCount).toBe(1);
  });

});

describe('lazySingleton', () => {

  it('should create instance only on first access', () => {
    let created = false;
    const instance = lazySingleton(() => {
      created = true;
      return { name: 'test', value: 42 };
    });

    expect(created).toBe(false);
    expect(instance.name).toBe('test');
    expect(created).toBe(true);
  });

  it('should return same instance on repeated access', () => {
    const instance = lazySingleton(() => ({
      id: Math.random(),
    }));

    const firstId = instance.id;
    const secondId = instance.id;
    expect(firstId).toBe(secondId);
  });

  it('should forward method calls', () => {
    const instance = lazySingleton(() => ({
      name: 'counter',
      count: 0,
      increment(this: { count: number }) {
        this.count++;
        return this.count;
      },
    }));

    expect(instance.name).toBe('counter');
  });

  it('should support has operator', () => {
    const instance = lazySingleton(() => ({ foo: 'bar' }));
    expect('foo' in instance).toBe(true);
    expect('baz' in instance).toBe(false);
  });

  it('should support set operation', () => {
    const instance = lazySingleton(() => ({ value: 1 }));
    instance.value = 42;
    expect('value' in instance).toBe(true);
  });

  it('should support Object.keys enumeration', () => {
    const instance = lazySingleton(() => ({ a: 1, b: 2 }));
    const keys = Object.keys(instance);
    expect(keys).toContain('a');
    expect(keys).toContain('b');
  });

  it('should support getOwnPropertyDescriptor', () => {
    const instance = lazySingleton(() => ({ x: 42 }));
    const desc = Object.getOwnPropertyDescriptor(instance, 'x');
    expect(desc).toBeDefined();
    expect(desc!.value).toBe(42);
    expect(desc!.writable).toBe(true);
  });

});

describe('retry', () => {

  it('should resolve on successful call', async () => {
    const result = await retry(async () => 'success');
    expect(result).toBe('success');
  });

  it('should retry on failure and eventually succeed', async () => {
    let attempts = 0;
    const result = await retry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('temporary failure');
        return 'success';
      },
      { maxRetries: 3, delay: 5 }
    );
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should reject after max retries', async () => {
    const fn = async () => {
      throw new Error('persistent failure');
    };

    expect(
      retry(fn, { maxRetries: 2, delay: 5 })
    ).rejects.toThrow('persistent failure');
  });

});
