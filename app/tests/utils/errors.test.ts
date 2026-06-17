import { describe, it, expect } from 'bun:test';
import {
  AppError,
  AbortError,
  ConfigParseError,
  ShellError,
  PluginError,
  ToolError,
  SecurityError,
  ErrorCategory,
  ErrorSeverity,
} from '../../src/error/types.js';

describe('AppError', () => {

  it('should create error with message, category, and severity', () => {
    const err = new AppError('test error', ErrorCategory.EXECUTION, ErrorSeverity.MEDIUM);
    expect(err.message).toBe('test error');
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
    expect(err.category).toBe(ErrorCategory.EXECUTION);
    expect(err.severity).toBe(ErrorSeverity.MEDIUM);
  });

});

describe('AbortError', () => {

  it('should create with default message', () => {
    const err = new AbortError();
    expect(err.message).toBe('Operation was aborted');
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
    const err = ConfigParseError.ccCompatible(
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

  it('should store stdout, stderr, and exitCode', () => {
    const err = new ShellError('Shell command failed', 'output', 'error output', 1);
    expect(err.stdout).toBe('output');
    expect(err.stderr).toBe('error output');
    expect(err.exitCode).toBe(1);
    expect(err.message).toBe('Shell command failed');
    expect(err.name).toBe('ShellError');
  });

});

describe('PluginError', () => {

  it('should create with message', () => {
    const err = new PluginError('plugin crashed');
    expect(err.message).toBe('plugin crashed');
    expect(err.name).toBe('PluginError');
  });

});

describe('ToolError', () => {

  it('should create with message', () => {
    const err = new ToolError('tool failed');
    expect(err.message).toBe('tool failed');
    expect(err.name).toBe('ToolError');
  });

});

describe('SecurityError', () => {

  it('should create with message', () => {
    const err = new SecurityError('access denied');
    expect(err.message).toBe('access denied');
    expect(err.name).toBe('SecurityError');
  });

});
