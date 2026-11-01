/**
 * utils/envAccess：与 `configManager.env` 的**语义等价**守门（B4 解环的前提）
 *
 * 解环依据：`utils` 不再依赖 `config`，env 读取收敛到 `readUtilEnv`；而
 * `ConfigManager.env(name)` 的实现就是 `process.env[name] ?? defaultValue`。
 * 一旦后者将来引入文件层 / 分层叠加，这个测试会先红，提示把 `readUtilEnv`
 * 改成启动期注入（与 `constants/envAccess` 同手法），而不是让 utils 静默读错值。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { configManager } from '@modules/config';
import { readUtilEnv } from '@openliri/infra/utils/envAccess';

const PROBE = 'LIRI_UTIL_ENV_PROBE';

afterEach(() => {
  delete process.env[PROBE];
});

describe('utils/envAccess 与 configManager.env 等价', () => {
  it('变量未设置 ⇒ 两者均为 undefined', () => {
    delete process.env[PROBE];
    expect(readUtilEnv(PROBE)).toBeUndefined();
    expect(configManager.env(PROBE)).toBe(readUtilEnv(PROBE));
  });

  it('变量已设置 ⇒ 两者同值', () => {
    process.env[PROBE] = 'probe-value';
    expect(readUtilEnv(PROBE)).toBe('probe-value');
    expect(configManager.env(PROBE)).toBe(readUtilEnv(PROBE));
  });

  it('空串也保持同口径（不把 "" 当未设置）', () => {
    process.env[PROBE] = '';
    expect(readUtilEnv(PROBE)).toBe('');
    expect(configManager.env(PROBE)).toBe(readUtilEnv(PROBE));
  });
});
