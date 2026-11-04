// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 测试进程不得把默认日志写进生产 `app.log`（附录 A6 取证，2026-11-04）。
 *
 * 实证：真机 `~/.pyapp/data/logs/app.log` 出现 36 条 `sessionId: sess-A` 的
 * 「yield 结算到达但该会话无等待登记」，而 `sess-A` 只存在于 `app/tests/**`
 * ⇒ `bun test` 一直在往生产日志写，污染按日志做的故障归因。
 *
 * 本用例是回归守卫：`LogConfigManager` 的默认配置在测试环境**不含文件目标**。
 * 需要文件输出的用例自带 `new Logger({ logFile, fileOutput })` 指向临时目录。
 */

import { describe, it, expect } from 'bun:test';
import { LogConfigManager } from '@openliri/infra/monitoring/logs/config/LogConfig';

describe('日志配置：测试进程隔离', () => {
  it('NODE_ENV=test 时默认配置不含 file 目标', () => {
    expect(process.env.NODE_ENV).toBe('test');
    const cfg = LogConfigManager.getInstance().get();
    expect(cfg.targets.some((t) => t.type === 'file')).toBe(false);
  });

  it('默认仍保留 console 目标（测试输出不受影响）', () => {
    const cfg = LogConfigManager.getInstance().get();
    expect(cfg.targets.some((t) => t.type === 'console')).toBe(true);
  });
});
