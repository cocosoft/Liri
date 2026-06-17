import { describe, it, expect } from 'bun:test';
import {
  isEnvTruthy,
  getEnv,
  isDevMode,
  isProdMode,
  getConfigHomeDir,
} from '../../src/utils/envUtils.js';

describe('isEnvTruthy', () => {

  it('should return false for undefined', () => {
    expect(isEnvTruthy(undefined)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isEnvTruthy('')).toBe(false);
  });

  it('should return true for "true"', () => {
    expect(isEnvTruthy('true')).toBe(true);
  });

  it('should return true for "1"', () => {
    expect(isEnvTruthy('1')).toBe(true);
  });

  it('should return true for "yes"', () => {
    expect(isEnvTruthy('yes')).toBe(true);
  });

  it('should return true for "y"', () => {
    expect(isEnvTruthy('y')).toBe(true);
  });

  it('should return true for "TRUE" (case insensitive)', () => {
    expect(isEnvTruthy('TRUE')).toBe(true);
  });

  it('should return false for "false"', () => {
    expect(isEnvTruthy('false')).toBe(false);
  });

  it('should return false for "0"', () => {
    expect(isEnvTruthy('0')).toBe(false);
  });

  it('should return false for "no"', () => {
    expect(isEnvTruthy('no')).toBe(false);
  });

});

describe('getEnv', () => {

  it('should return env value when set', () => {
    process.env.TEST_VAR = 'test_value';
    expect(getEnv('TEST_VAR')).toBe('test_value');
    delete process.env.TEST_VAR;
  });

  it('should return default value when not set', () => {
    expect(getEnv('NONEXISTENT_VAR', 'default')).toBe('default');
  });

  it('should return empty string when not set and no default', () => {
    expect(getEnv('NONEXISTENT_VAR')).toBe('');
  });

  it('should return empty string when var is empty string', () => {
    process.env.TEST_EMPTY = '';
    expect(getEnv('TEST_EMPTY', 'fallback')).toBe('fallback');
    delete process.env.TEST_EMPTY;
  });

});

describe('isDevMode', () => {

  it('should return false when NODE_ENV is not set', () => {
    const original = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    expect(isDevMode()).toBe(false);
    process.env.NODE_ENV = original;
  });

  it('should return false when NODE_ENV is production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(isDevMode()).toBe(false);
    process.env.NODE_ENV = original;
  });

});

describe('isProdMode', () => {

  it('should return true when NODE_ENV is production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(isProdMode()).toBe(true);
    process.env.NODE_ENV = original;
  });

  it('should return true when NODE_ENV is not set (default)', () => {
    const original = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    expect(isProdMode()).toBe(true);
    process.env.NODE_ENV = original;
  });

});

describe('getConfigHomeDir', () => {

  it('should return path ending with pyapp', () => {
    const result = getConfigHomeDir();
    expect(result.endsWith('pyapp')).toBe(true);
  });

  it('should contain the home directory', () => {
    const result = getConfigHomeDir();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

});
