import { describe, it, expect } from 'bun:test';
import {
  partiallySanitizeUnicode,
  recursivelySanitizeUnicode,
  sanitizeHTML,
  validateInput,
} from '../../src/utils/sanitization.js';

describe('partiallySanitizeUnicode', () => {

  it('should return normal text unchanged', () => {
    const result = partiallySanitizeUnicode('Hello, World!');
    expect(result).toBe('Hello, World!');
  });

  it('should remove zero-width spaces', () => {
    const input = 'Hello\u200BWorld';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('HelloWorld');
  });

  it('should remove LTR/RTL marks', () => {
    const input = 'Hello\u200EWorld';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('HelloWorld');
  });

  it('should remove directional formatting characters', () => {
    const input = 'Hello\u202EWorld';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('HelloWorld');
  });

  it('should remove byte order mark', () => {
    const input = '\uFEFFHello';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('Hello');
  });

  it('should remove private use area characters', () => {
    const input = 'Hello\uE000World';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('HelloWorld');
  });

  it('should apply NFKC normalization', () => {
    const input = '\uFF34\u0065\u0073\u0074';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('Test');
  });

  it('should preserve normal CJK characters', () => {
    const input = '你好世界';
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('你好世界');
  });

  it('should sanitize dangerous characters without throwing', () => {
    const input = '\u200B'.repeat(20);
    const result = partiallySanitizeUnicode(input);
    expect(result).toBe('');
  });

});

describe('recursivelySanitizeUnicode', () => {

  it('should sanitize string values', () => {
    const result = recursivelySanitizeUnicode('Hello\u200BWorld');
    expect(result).toBe('HelloWorld');
  });

  it('should sanitize array elements', () => {
    const result = recursivelySanitizeUnicode([
      'Hello\u200BWorld',
      'Normal',
    ]);
    expect(result).toEqual(['HelloWorld', 'Normal']);
  });

  it('should sanitize object values recursively', () => {
    const result = recursivelySanitizeUnicode({
      name: 'Test\u200BName',
      nested: { value: 'Nested\uFEFFValue' },
    });
    expect(result).toEqual({
      name: 'TestName',
      nested: { value: 'NestedValue' },
    });
  });

  it('should sanitize object keys', () => {
    const result = recursivelySanitizeUnicode({
      '\u200Bkey': 'value',
    });
    expect(result).toEqual({ key: 'value' });
  });

  it('should return primitives unchanged', () => {
    expect(recursivelySanitizeUnicode(42)).toBe(42);
    expect(recursivelySanitizeUnicode(true)).toBe(true);
    expect(recursivelySanitizeUnicode(null)).toBeNull();
  });

  it('should handle empty inputs', () => {
    expect(recursivelySanitizeUnicode('')).toBe('');
    expect(recursivelySanitizeUnicode([])).toEqual([]);
    expect(recursivelySanitizeUnicode({})).toEqual({});
  });

});

describe('sanitizeHTML', () => {

  it('should escape & to &amp;', () => {
    expect(sanitizeHTML('a & b')).toBe('a &amp; b');
  });

  it('should escape < to &lt;', () => {
    expect(sanitizeHTML('<script>')).toBe('&lt;script&gt;');
  });

  it('should escape > to &gt;', () => {
    expect(sanitizeHTML('a > b')).toBe('a &gt; b');
  });

  it('should escape double quotes', () => {
    expect(sanitizeHTML('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('should escape single quotes', () => {
    expect(sanitizeHTML("it's")).toBe('it&#039;s');
  });

  it('should handle text with no special characters', () => {
    expect(sanitizeHTML('Hello World')).toBe('Hello World');
  });

  it('should handle empty string', () => {
    expect(sanitizeHTML('')).toBe('');
  });

});

describe('validateInput', () => {

  it('should pass valid string', () => {
    const result = validateInput('hello', 'string');
    expect(result).toEqual({ result: true });
  });

  it('should fail invalid type', () => {
    const result = validateInput(42, 'string');
    expect(result.result).toBe(false);
    if (!result.result) {
      expect(result.message).toContain('Invalid type');
    }
  });

  it('should validate string minLength', () => {
    const result = validateInput('ab', 'string', { minLength: 3 });
    expect(result.result).toBe(false);
    if (!result.result) {
      expect(result.message).toContain('at least 3');
    }
  });

  it('should validate string maxLength', () => {
    const result = validateInput('abcdef', 'string', { maxLength: 3 });
    expect(result.result).toBe(false);
    if (!result.result) {
      expect(result.message).toContain('at most 3');
    }
  });

  it('should validate string pattern', () => {
    const result = validateInput('123', 'string', {
      pattern: /^[a-z]+$/,
    });
    expect(result.result).toBe(false);
  });

  it('should validate number type', () => {
    expect(validateInput(42, 'number').result).toBe(true);
    expect(validateInput('42', 'number').result).toBe(false);
  });

  it('should validate number range', () => {
    expect(validateInput(100, 'number', { min: 0, max: 50 }).result).toBe(
      false
    );
    expect(validateInput(25, 'number', { min: 0, max: 50 }).result).toBe(true);
  });

  it('should validate number min boundary', () => {
    expect(validateInput(5, 'number', { min: 10 }).result).toBe(false);
    expect(validateInput(15, 'number', { min: 10 }).result).toBe(true);
  });

  it('should validate number max boundary', () => {
    expect(validateInput(30, 'number', { max: 20 }).result).toBe(false);
    expect(validateInput(10, 'number', { max: 20 }).result).toBe(true);
  });

  it('should validate boolean type', () => {
    expect(validateInput(true, 'boolean').result).toBe(true);
    expect(validateInput(1, 'boolean').result).toBe(false);
  });

  it('should return true for arrays validated as object (type coersion)', () => {
    expect(validateInput({}, 'object').result).toBe(true);
    expect(validateInput([], 'object').result).toBe(true);
  });

  it('should fail null for object type', () => {
    expect(validateInput(null, 'object').result).toBe(false);
  });

  it('should validate array type', () => {
    expect(validateInput([1, 2], 'array').result).toBe(true);
    expect(validateInput({}, 'array').result).toBe(false);
  });

  it('should validate null type', () => {
    expect(validateInput(null, 'null').result).toBe(true);
    expect(validateInput(undefined, 'null').result).toBe(false);
  });

  it('should validate undefined type', () => {
    expect(validateInput(undefined, 'undefined').result).toBe(true);
    expect(validateInput(null, 'undefined').result).toBe(false);
  });

  it('should reject invalid type specifier', () => {
    const result = validateInput('x', 'unknown');
    expect(result.result).toBe(false);
  });

  it('should check required', () => {
    expect(validateInput(null, 'string', { required: true }).result).toBe(
      false
    );
    expect(
      validateInput(undefined, 'string', { required: true }).result
    ).toBe(false);
    expect(validateInput('', 'string', { required: true }).result).toBe(false);
    expect(validateInput('hello', 'string', { required: true }).result).toBe(
      true
    );
  });

  it('should validate array minLength', () => {
    expect(
      validateInput([1], 'array', { minLength: 3 }).result
    ).toBe(false);
    expect(
      validateInput([1, 2, 3], 'array', { minLength: 3 }).result
    ).toBe(true);
  });

  it('should validate array maxLength', () => {
    expect(
      validateInput([1, 2, 3, 4], 'array', { maxLength: 3 }).result
    ).toBe(false);
    expect(
      validateInput([1, 2], 'array', { maxLength: 3 }).result
    ).toBe(true);
  });

  it('should support custom validation', () => {
    expect(
      validateInput(4, 'number', {
        validate: (v) => (v as number) % 2 === 0,
      }).result
    ).toBe(true);
    expect(
      validateInput(3, 'number', {
        validate: (v) => (v as number) % 2 === 0,
      }).result
    ).toBe(false);
  });

  it('should handle NaN as invalid number', () => {
    expect(validateInput(NaN, 'number').result).toBe(false);
  });

  it('should validate object required', () => {
    expect(validateInput(null, 'object', { required: true }).result).toBe(
      false
    );
  });

});
