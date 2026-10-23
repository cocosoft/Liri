import { describe, it, expect } from 'bun:test';
import {
  jsonStringify,
  jsonParse,
  parseModelJsonObject,
} from '../../src/utils/json.js';

describe('jsonStringify', () => {
  it('should stringify a basic object', () => {
    const result = jsonStringify({ a: 1, b: 2 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('should stringify with spacing', () => {
    const result = jsonStringify({ a: 1 }, 2);
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it('should stringify null', () => {
    const result = jsonStringify(null);
    expect(result).toBe('null');
  });

  it('should stringify undefined values as null in objects', () => {
    const result = jsonStringify({ a: undefined });
    expect(result).toBe('{}');
  });
});

describe('jsonParse', () => {
  it('should parse valid JSON', () => {
    const result = jsonParse<{ a: number }>('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  it('should return null for invalid JSON', () => {
    const result = jsonParse('invalid json');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = jsonParse('');
    expect(result).toBeNull();
  });

  it('should parse array JSON', () => {
    const result = jsonParse<number[]>('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('should parse primitive JSON values', () => {
    expect(jsonParse('42')).toBe(42);
    expect(jsonParse('"hello"')).toBe('hello');
    expect(jsonParse('true')).toBe(true);
    expect(jsonParse('null')).toBeNull();
  });
});

describe('parseModelJsonObject', () => {
  it('should parse a valid tool-arguments object', () => {
    expect(parseModelJsonObject('{"file_path":"a.md"}')).toEqual({
      file_path: 'a.md',
    });
  });

  it('should repair Windows paths written with single backslashes', () => {
    // 2026-10-22 真机：模型写 "C:\Users\..." ⇒ `\U` 非法转义 ⇒ 裸 JSON.parse 失败
    expect(
      parseModelJsonObject('{"file_path":"C:\\Users\\csdnc\\PRD.md"}')
    ).toEqual({ file_path: 'C:\\Users\\csdnc\\PRD.md' });
  });

  it('should return undefined for unrepairable or non-object payloads', () => {
    expect(parseModelJsonObject('{"file_path":')).toBeUndefined();
    expect(parseModelJsonObject('[1,2,3]')).toBeUndefined();
    expect(parseModelJsonObject('')).toBeUndefined();
  });
});
