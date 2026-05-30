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
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[INFO\] \[app\] hello world/)
    );
  });

  it('should handle single argument', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test message');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[INFO\] \[app\] test message/)
    );
  });

  it('should handle object arguments by serializing them', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('data:', { key: 'value' });
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[INFO\] \[app\] data: \{["]?key["]?:["]?value["]?\}/)
    );
  });

  it('should handle error method', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logger.error('something went wrong');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[ERROR\] \[app\] something went wrong/)
    );
  });

  it('should handle warn method', () => {
    const spy = spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning message');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[WARN\] \[app\] warning message/)
    );
  });

  it('should handle debug method', () => {
    expect(typeof logger.debug).toBe('function');
  });

  it('should handle fatal method', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    logger.fatal('fatal message');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[FATAL\] \[app\] fatal message/)
    );
  });

  it('should filter out undefined/null args', () => {
    const spy = spyOn(console, 'info').mockImplementation(() => {});
    logger.info('a', undefined, 'b', null, 'c');
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] \[INFO\] \[app\] a b c/)
    );
  });

});
