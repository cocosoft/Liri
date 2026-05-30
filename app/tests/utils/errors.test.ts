import { describe, it, expect } from 'bun:test';
import {
  PYAppError,
  MalformedCommandError,
  AbortError,
  ConfigParseError,
  ShellError,
  PluginError,
  ToolError,
  SecurityError,
  isAbortError,
  toError,
  errorMessage,
  getErrnoCode,
  isENOENT,
  getErrnoPath,
  shortErrorStack,
  isFsInaccessible,
  formatError,
  getErrorParts,
} from '../../src/utils/errors.js';

describe('PYAppError', () => {

  it('should create error with message', () => {
    const err = new PYAppError('test error');
    expect(err.message).toBe('test error');
    expect(err.name).toBe('PYAppError');
    expect(err).toBeInstanceOf(Error);
  });

});

describe('MalformedCommandError', () => {

  it('should create with message', () => {
    const err = new MalformedCommandError('bad command');
    expect(err.message).toBe('bad command');
    expect(err).toBeInstanceOf(PYAppError);
  });

});

describe('AbortError', () => {

  it('should create with default message', () => {
    const err = new AbortError();
    expect(err.message).toBe('Operation aborted');
    expect(err.name).toBe('AbortError');
  });

  it('should create with custom message', () => {
    const err = new AbortError('cancelled by user');
    expect(err.message).toBe('cancelled by user');
  });

});

describe('ConfigParseError', () => {

  it('should store filePath and defaultConfig', () => {
    const defaultConfig = { theme: 'dark' };
    const err = new ConfigParseError(
      'parse failed',
      '/path/to/config.json',
      defaultConfig
    );
    expect(err.message).toBe('parse failed');
    expect(err.filePath).toBe('/path/to/config.json');
    expect(err.defaultConfig).toEqual({ theme: 'dark' });
    expect(err.name).toBe('ConfigParseError');
  });

});

describe('ShellError', () => {

  it('should store stdout, stderr, code, and interrupted', () => {
    const err = new ShellError('output', 'error output', 1, false);
    expect(err.stdout).toBe('output');
    expect(err.stderr).toBe('error output');
    expect(err.code).toBe(1);
    expect(err.interrupted).toBe(false);
    expect(err.message).toBe('Shell command failed');
    expect(err.name).toBe('ShellError');
  });

  it('should support interrupted true', () => {
    const err = new ShellError('', '', 130, true);
    expect(err.interrupted).toBe(true);
    expect(err.code).toBe(130);
  });

});

describe('PluginError', () => {

  it('should store pluginName', () => {
    const err = new PluginError('plugin crashed', 'test-plugin');
    expect(err.message).toBe('plugin crashed');
    expect(err.pluginName).toBe('test-plugin');
  });

});

describe('ToolError', () => {

  it('should store toolName', () => {
    const err = new ToolError('tool failed', 'my-tool');
    expect(err.message).toBe('tool failed');
    expect(err.toolName).toBe('my-tool');
  });

});

describe('SecurityError', () => {

  it('should create with message', () => {
    const err = new SecurityError('access denied');
    expect(err.message).toBe('access denied');
    expect(err.name).toBe('SecurityError');
  });

});

describe('isAbortError', () => {

  it('should return true for AbortError', () => {
    expect(isAbortError(new AbortError())).toBe(true);
  });

  it('should return false for regular Error', () => {
    expect(isAbortError(new Error('test'))).toBe(false);
  });

  it('should return false for non-Error values', () => {
    expect(isAbortError('string')).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('should detect AbortError by name', () => {
    const err = new Error('custom abort');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

});

describe('toError', () => {

  it('should return Error instance as-is', () => {
    const err = new Error('test');
    expect(toError(err)).toBe(err);
  });

  it('should convert string to Error', () => {
    const err = toError('something failed');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('something failed');
  });

  it('should convert number to Error', () => {
    const err = toError(42);
    expect(err.message).toBe('42');
  });

  it('should convert null to Error', () => {
    const err = toError(null);
    expect(err.message).toBe('null');
  });

});

describe('errorMessage', () => {

  it('should return Error.message for Error instances', () => {
    expect(errorMessage(new Error('my message'))).toBe('my message');
  });

  it('should convert non-Error to string', () => {
    expect(errorMessage('direct string')).toBe('direct string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });

});

describe('getErrnoCode', () => {

  it('should return code from error-like object', () => {
    expect(getErrnoCode({ code: 'ENOENT' })).toBe('ENOENT');
  });

  it('should return undefined from regular Error', () => {
    expect(getErrnoCode(new Error('test'))).toBeUndefined();
  });

  it('should return undefined from null', () => {
    expect(getErrnoCode(null)).toBeUndefined();
  });

  it('should return undefined from non-object', () => {
    expect(getErrnoCode('string')).toBeUndefined();
  });

});

describe('isENOENT', () => {

  it('should return true for ENOENT code', () => {
    expect(isENOENT({ code: 'ENOENT' })).toBe(true);
  });

  it('should return false for other codes', () => {
    expect(isENOENT({ code: 'EACCES' })).toBe(false);
  });

  it('should return false for Error without code', () => {
    expect(isENOENT(new Error('test'))).toBe(false);
  });

});

describe('getErrnoPath', () => {

  it('should return path from error-like object', () => {
    expect(getErrnoPath({ path: '/some/file' })).toBe('/some/file');
  });

  it('should return undefined from regular Error', () => {
    expect(getErrnoPath(new Error('test'))).toBeUndefined();
  });

  it('should return undefined from null', () => {
    expect(getErrnoPath(null)).toBeUndefined();
  });

});

describe('shortErrorStack', () => {

  it('should return full stack when within maxFrames', () => {
    const err = new Error('simple error');
    const result = shortErrorStack(err, 5);
    expect(result).toContain('simple error');
  });

  it('should truncate stack when exceeding maxFrames', () => {
    const err = new Error('many frames');
    const result = shortErrorStack(err, 1);
    expect(result).toContain('many frames');
  });

  it('should handle non-Error values', () => {
    expect(shortErrorStack('string error')).toBe('string error');
    expect(shortErrorStack(42)).toBe('42');
  });

  it('should handle Error without stack', () => {
    const err = new Error('no stack');
    const result = shortErrorStack(err, 5);
    expect(result).toContain('no stack');
  });

});

describe('isFsInaccessible', () => {

  it('should return true for ENOENT', () => {
    expect(isFsInaccessible({ code: 'ENOENT' })).toBe(true);
  });

  it('should return true for EACCES', () => {
    expect(isFsInaccessible({ code: 'EACCES' })).toBe(true);
  });

  it('should return true for EPERM', () => {
    expect(isFsInaccessible({ code: 'EPERM' })).toBe(true);
  });

  it('should return false for other codes', () => {
    expect(isFsInaccessible({ code: 'EEXIST' })).toBe(false);
  });

  it('should return false for Error without code', () => {
    expect(isFsInaccessible(new Error('test'))).toBe(false);
  });

});

describe('getErrorParts', () => {

  it('should extract ShellError parts', () => {
    const err = new ShellError('stdout', 'stderr', 1, true);
    const parts = getErrorParts(err);
    expect(parts[0]).toContain('Exit code 1');
    expect(parts[1]).toContain('Command interrupted');
    expect(parts[2]).toBe('stderr');
    expect(parts[3]).toBe('stdout');
  });

  it('should extract regular Error parts', () => {
    const err = new Error('something went wrong');
    const parts = getErrorParts(err);
    expect(parts[0]).toBe('something went wrong');
  });

  it('should extract stderr/stdout from extended errors', () => {
    const err = new Error('command failed') as Error & {
      stderr: string;
      stdout: string;
    };
    err.stderr = 'error details';
    err.stdout = 'output details';
    const parts = getErrorParts(err);
    expect(parts).toContain('command failed');
    expect(parts).toContain('error details');
    expect(parts).toContain('output details');
  });

});

describe('formatError', () => {

  it('should return AbortError message directly', () => {
    const err = new AbortError('cancelled');
    expect(formatError(err)).toBe('cancelled');
  });

  it('should format regular Error', () => {
    const err = new Error('plain error');
    const result = formatError(err);
    expect(result).toContain('plain error');
  });

  it('should handle non-Error values', () => {
    expect(formatError('string error')).toBe('string error');
  });

  it('should truncate very long error messages', () => {
    const longMessage = 'x'.repeat(20000);
    const err = new Error(longMessage);
    const result = formatError(err);
    expect(result.length).toBeLessThan(20000);
  });

  it('should format ShellError', () => {
    const err = new ShellError('stdout', 'stderr', 1, false);
    const result = formatError(err);
    expect(result).toContain('Exit code 1');
    expect(result).toContain('stderr');
    expect(result).toContain('stdout');
  });

});
