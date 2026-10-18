import { describe, it, expect } from 'bun:test';
import { isAntUser, isSimpleMode } from '../../src/utils/features.js';

/**
 * 恢复环境变量：原值为 `undefined` 时必须 `delete`。
 * 直接 `process.env.X = undefined` 会被运行时转成字符串 `"undefined"`（CI 实测污染
 * `ConfigLayersService.test` 的 env 层断言）。
 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('isAntUser', () => {
  it('should return false when USER_TYPE is not set', () => {
    const orig = process.env.USER_TYPE;
    delete process.env.USER_TYPE;
    expect(isAntUser()).toBe(false);
    restoreEnv('USER_TYPE', orig);
  });

  it('should return true when USER_TYPE is ant', () => {
    const orig = process.env.USER_TYPE;
    process.env.USER_TYPE = 'ant';
    expect(isAntUser()).toBe(true);
    restoreEnv('USER_TYPE', orig);
  });
});

describe('isSimpleMode', () => {
  it('should return false when env not set', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    delete process.env.PYAPP_SIMPLE_MODE;
    expect(isSimpleMode()).toBe(false);
    restoreEnv('PYAPP_SIMPLE_MODE', orig);
  });

  it('should return true when PYAPP_SIMPLE_MODE is true', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    process.env.PYAPP_SIMPLE_MODE = 'true';
    expect(isSimpleMode()).toBe(true);
    restoreEnv('PYAPP_SIMPLE_MODE', orig);
  });

  it('should return false when PYAPP_SIMPLE_MODE is false', () => {
    const orig = process.env.PYAPP_SIMPLE_MODE;
    process.env.PYAPP_SIMPLE_MODE = 'false';
    expect(isSimpleMode()).toBe(false);
    restoreEnv('PYAPP_SIMPLE_MODE', orig);
  });
});
