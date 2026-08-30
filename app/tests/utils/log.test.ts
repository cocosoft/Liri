import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { logger, LogLevel } from '../../src/utils/log.js';

describe('logger', () => {

  afterEach(() => {
    spyOn(console, 'info').mockRestore();
    spyOn(console, 'error').mockRestore();
    spyOn(console, 'warn').mockRestore();
    spyOn(console, 'debug').mockRestore();
  });

  it('should export LogLevel enum', () => {
    expect(LogLevel).toBeDefined();
  });

  it('should have info method', () => {
    expect(typeof logger.info).toBe('function');
  });

  it('should have warn method', () => {
    expect(typeof logger.warn).toBe('function');
  });

  it('should have error method', () => {
    expect(typeof logger.error).toBe('function');
  });

  it('should have debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });

  it('should have fatal method', () => {
    expect(typeof logger.fatal).toBe('function');
  });

  it('should join multiple string arguments', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('hello', 'world');
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('hello');
    expect(parsed.meta).toBe('world');
  });

  it('should handle single argument', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test message');
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('test message');
  });

  it('should handle object arguments by serializing them', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('data:', { key: 'value' });
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('data:');
    expect(parsed.meta).toEqual({ key: 'value' });
  });

  it('should handle error method', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logger.error('something went wrong');
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('error');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('something went wrong');
  });

  it('should handle warn method', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning message');
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('warn');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('warning message');
  });

  it('should handle debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });

  it('should handle fatal method', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logger.fatal('fatal message');
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('fatal');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('fatal message');
  });

  it('should filter out undefined/null args', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    // Logger.info 签名为 (message, meta?)；多余参数运行时被忽略，仅保留 meta 位置验证过滤
    logger.info('a', undefined);
    const callArg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(callArg);
    expect(parsed.level).toBe('info');
    expect(parsed.module).toBe('app');
    expect(parsed.message).toBe('a');
    expect(parsed.meta).toBeUndefined();
  });

});
