/**
 * 配置系统未启用 ⇒ 写入必须 fail-closed（2026-11-07 真机事故回归锁）
 *
 * 事故：临时脚本（`bun tmp.ts`，没走 `main.ts` 引导）调 `configManager.setConfigValue()`
 * ⇒ `saveGlobalConfig()` 把"默认快照"落盘，用户的 `~/.pyapp/config.json` 从 2896 字节
 * 变成 `{}`（主题 / features / soul / user / autonomy 全丢）。
 *
 * 锁两件事：
 *  ① 未 `enableConfigs()` 且非 test ⇒ `saveGlobalConfig` / `setConfigValue` 抛错且**不落盘**；
 *  ② `enableConfigs()` 之后同样调用 ⇒ 正常写盘（不误伤）。
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager, ConfigWriteRefusedError } from '@openliri/infra/config';

const workDir = mkdtempSync(join(tmpdir(), 'cfg-refuse-'));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 构造一个"未启用配置系统"的管理器（bun test 默认 NODE_ENV=test 会豁免，故临时改掉） */
function withoutConfigsEnabled(configPath: string): ConfigManager {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return new ConfigManager(configPath);
  } finally {
    process.env.NODE_ENV = original;
  }
}

describe('配置写入 fail-closed（未 enableConfigs）', () => {
  test('saveGlobalConfig 拒绝写入，且不创建配置文件', () => {
    const configPath = join(workDir, 'a', 'config.json');
    const manager = withoutConfigsEnabled(configPath);
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() =>
        manager.saveGlobalConfig((config) => ({ ...config, theme: 'dark' }))
      ).toThrow(ConfigWriteRefusedError);
      expect(existsSync(configPath)).toBe(false);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('setConfigValue 同样拒绝（同一条写入路径）', () => {
    const configPath = join(workDir, 'b', 'config.json');
    const manager = withoutConfigsEnabled(configPath);
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => manager.setConfigValue('theme', 'dark')).toThrow(
        ConfigWriteRefusedError
      );
      expect(existsSync(configPath)).toBe(false);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test('enableConfigs 之后写入正常（不误伤）', () => {
    const configPath = join(workDir, 'c', 'config.json');
    const manager = new ConfigManager(configPath);
    manager.enableConfigs();
    // 取一个"非默认值"，否则会被 filterDefaults 过滤掉（落盘只留非默认项）
    manager.setConfigValue('features', {
      ...(manager.getValue<Record<string, unknown>>('features') ?? {}),
      showExpandedTodos: true,
    });
    expect(manager.getValue('features')).toMatchObject({
      showExpandedTodos: true,
    });
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toContain('showExpandedTodos');
  });
});
