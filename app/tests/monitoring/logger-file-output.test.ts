/**
 * BUG 1 修复验证：恢复日志文件写入功能
 *
 * 根因：main.ts 在模块加载期执行 `getLogger('main')`，此时
 * setGlobalConfigProvider 尚未注册，Logger 构造时把 fileOutput 快照为 false，
 * 且按模块缓存实例，导致这些早期 Logger 永久不写文件（unhandledRejection、
 * 应用启动等关键日志无法落盘）。
 *
 * 修复：Logger 在写入阶段动态解析文件输出配置（显式指定优先，否则读全局缓存），
 * 使注册前创建的 Logger 在注册后也能写入文件。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  Logger,
  setGlobalConfigProvider,
  flush,
} from '../../src/monitoring/logs/Logger.js';

describe('Logger 文件输出（BUG1 根因修复）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'logger-file-output-'));
  });

  afterEach(async () => {
    // 重置全局配置（不启用文件输出），避免影响其他测试
    setGlobalConfigProvider(() => ({}));
    await flush();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('在 setGlobalConfigProvider 注册前创建的 Logger，注册后也能写入文件', async () => {
    // 1. 模拟注册前的状态：全局配置不启用文件输出
    setGlobalConfigProvider(() => ({}));

    // 2. 注册前创建 Logger（模拟 main.ts 模块加载期 getLogger('main')）
    const earlyLogger = new Logger({
      module: 'bug1:early',
      format: 'text',
      consoleOutput: false,
    });

    // 3. 注册启用文件输出的全局配置
    const logPath = join(tempDir, 'app.log');
    setGlobalConfigProvider(() => ({
      fileOutput: true,
      logFile: logPath,
      format: 'json',
    }));

    // 4. 早期 Logger 写入
    earlyLogger.info('bug1-early-logger-writes');

    await flush();

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('bug1-early-logger-writes');
    expect(content).toContain('bug1:early');
  });

  it('调用方显式指定 fileOutput 时优先于全局配置', async () => {
    const logPath = join(tempDir, 'app.log');
    // 全局启用文件输出
    setGlobalConfigProvider(() => ({
      fileOutput: true,
      logFile: logPath,
      format: 'json',
    }));

    // 显式禁用文件输出的 Logger
    const disabledLogger = new Logger({
      module: 'bug1:disabled',
      format: 'text',
      consoleOutput: false,
      fileOutput: false,
    });
    // 未显式指定文件输出的 Logger（应继承全局）
    const enabledLogger = new Logger({
      module: 'bug1:enabled',
      format: 'text',
      consoleOutput: false,
    });

    disabledLogger.info('bug1-should-not-appear');
    enabledLogger.info('bug1-should-appear');

    await flush();

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('bug1-should-appear');
    expect(content).not.toContain('bug1-should-not-appear');
  });
});
