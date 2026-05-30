import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import {
  isDebugMode,
  logForDebugging,
  getHasFormattedOutput,
  logError,
} from '../../src/utils/debug.js';

describe('isDebugMode', () => {

  it('should return false when DEBUG env is not set', () => {
    const origDebug = process.env.DEBUG;
    const origPyAppDebug = process.env.PY_APP_DEBUG;
    delete process.env.DEBUG;
    delete process.env.PY_APP_DEBUG;
    const result = isDebugMode();
    expect(result).toBe(false);
    process.env.DEBUG = origDebug;
    process.env.PY_APP_DEBUG = origPyAppDebug;
  });

});

describe('logForDebugging', () => {

  afterEach(() => {
    spyOn(console, 'log').mockRestore();
    spyOn(console, 'error').mockRestore();
    spyOn(console, 'warn').mockRestore();
    spyOn(console, 'info').mockRestore();
  });

  it('should not log when debug mode is off', () => {
    const origDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    logForDebugging('test message');
    expect(spy).not.toHaveBeenCalled();
    process.env.DEBUG = origDebug;
  });

  it('should log to console.log by default when debug mode is on', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    logForDebugging('test message');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('test message'));
    process.env.DEBUG = origDebug;
  });

  it('should log to console.error when level is error', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logForDebugging('error message', { level: 'error' });
    expect(spy).toHaveBeenCalledTimes(1);
    process.env.DEBUG = origDebug;
  });

  it('should log to console.warn when level is warn', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    logForDebugging('warn message', { level: 'warn' });
    expect(spy).toHaveBeenCalledTimes(1);
    process.env.DEBUG = origDebug;
  });

  it('should log to console.info when level is info', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logForDebugging('info message', { level: 'info' });
    expect(spy).toHaveBeenCalledTimes(1);
    process.env.DEBUG = origDebug;
  });

  it('should include timestamp and level in log message', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    logForDebugging('test');
    const logged = spy.mock.calls[0][0] as string;
    expect(logged).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(logged).toContain('[DEBUG]');
    expect(logged).toContain('test');
    process.env.DEBUG = origDebug;
  });

});

describe('getHasFormattedOutput', () => {

  it('should return a boolean', () => {
    expect(typeof getHasFormattedOutput()).toBe('boolean');
  });

  it('should return true when PY_APP_STREAM_JSON is not set', () => {
    const orig = process.env.PY_APP_STREAM_JSON;
    delete process.env.PY_APP_STREAM_JSON;
    expect(getHasFormattedOutput()).toBe(true);
    process.env.PY_APP_STREAM_JSON = orig;
  });

  it('should return false when PY_APP_STREAM_JSON is true', () => {
    const orig = process.env.PY_APP_STREAM_JSON;
    process.env.PY_APP_STREAM_JSON = 'true';
    expect(getHasFormattedOutput()).toBe(false);
    process.env.PY_APP_STREAM_JSON = orig;
  });

});

describe('logError', () => {

  afterEach(() => {
    spyOn(console, 'error').mockRestore();
  });

  it('should log Error instance details', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logError(new Error('test error'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('test error')
    );
    process.env.DEBUG = origDebug;
  });

  it('should log non-Error values as string', () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = 'true';
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logError('string error');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('string error')
    );
    process.env.DEBUG = origDebug;
  });

});
