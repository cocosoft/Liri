import { describe, it, expect } from 'bun:test';
import {
  isAntUser,
  isSimpleMode,
} from '../../src/utils/features.js';

describe('isAntUser', () => {

  it('should return false when USER_TYPE is not set', () => {
    const orig = process.env.USER_TYPE;
    delete process.env.USER_TYPE;
    expect(isAntUser()).toBe(false);
    process.env.USER_TYPE = orig;
  });

  it('should return true when USER_TYPE is ant', () => {
    const orig = process.env.USER_TYPE;
    process.env.USER_TYPE = 'ant';
    expect(isAntUser()).toBe(true);
    process.env.USER_TYPE = orig;
  });

});

describe('isSimpleMode', () => {

  it('should return false when env not set', () => {
    const orig = process.env.CLAUDE_CODE_SIMPLE;
    delete process.env.CLAUDE_CODE_SIMPLE;
    expect(isSimpleMode()).toBe(false);
    process.env.CLAUDE_CODE_SIMPLE = orig;
  });

  it('should return true when CLAUDE_CODE_SIMPLE is true', () => {
    const orig = process.env.CLAUDE_CODE_SIMPLE;
    process.env.CLAUDE_CODE_SIMPLE = 'true';
    expect(isSimpleMode()).toBe(true);
    process.env.CLAUDE_CODE_SIMPLE = orig;
  });

  it('should return false when CLAUDE_CODE_SIMPLE is false', () => {
    const orig = process.env.CLAUDE_CODE_SIMPLE;
    process.env.CLAUDE_CODE_SIMPLE = 'false';
    expect(isSimpleMode()).toBe(false);
    process.env.CLAUDE_CODE_SIMPLE = orig;
  });

});
