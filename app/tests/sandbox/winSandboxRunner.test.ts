// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Windows code_run runner 的失败分流（2026-10-26，方案 §3.5）
//
// 只测"进 prepareRunDir 之前"的分支（配置关 / helper 缺失），打标签之后的分支由
// `bun run verify:win-sandbox` 与 CI windows job 覆盖 —— 这里不创建真实运行目录。
import { describe, expect, it } from 'bun:test';
import {
  classifyWinSandboxDenial,
  runCodeRunnerWithWindowsSandbox,
} from '../../src/tools/CodeRunner/WindowsSandboxRunner';
import type { CodeRunnerExecOptions } from '../../src/tools/CodeRunner/CrossPlatformRunner';
import type { LandlockConfig } from '../../src/sandbox/landlock/config';

const opts = {
  bridge: {} as never,
  timeoutMs: 1000,
} as unknown as CodeRunnerExecOptions;

const baseConfig: LandlockConfig = {
  enabled: true,
  failClosed: false,
  bashEnabled: false,
  bashExtraWritablePaths: [],
};

describe('runCodeRunnerWithWindowsSandbox — 前置分支', () => {
  it('总开关关闭 ⇒ 返回 null（交回跨平台执行器，零行为变更）', async () => {
    const result = await runCodeRunnerWithWindowsSandbox(opts, {
      config: { ...baseConfig, enabled: false },
    });
    expect(result).toBeNull();
  });

  it('helper 不可用 + failClosed=true ⇒ security-rejected（不降级）', async () => {
    const result = await runCodeRunnerWithWindowsSandbox(opts, {
      config: { ...baseConfig, failClosed: true },
      detect: () => ({ available: false, reason: 'no helper' }),
    });
    expect(result?.status).toBe('security-rejected');
    expect(result?.error).toContain('failClosed=true');
    expect(result?.error).toContain('build:win-sandbox');
    // P2（2026-11-07）：拒绝必须可归因（init = 起不来，不是脚本写越界）
    expect(result?.error).toContain('sandbox_denied: init');
  });

  it('helper 不可用 + failClosed=false ⇒ 返回 null（降级并 warn）', async () => {
    const result = await runCodeRunnerWithWindowsSandbox(opts, {
      config: baseConfig,
      detect: () => ({ available: false, reason: 'no helper' }),
    });
    expect(result).toBeNull();
  });
});

describe('P2：沙箱拒绝可归因（classifyWinSandboxDenial）', () => {
  it('初始化失败恒为 init', () => {
    expect(classifyWinSandboxDenial(undefined, 'init')).toBe('init');
  });

  it('运行期 Access Denied / 拒绝访问 ⇒ write', () => {
    for (const text of [
      'Error: EPERM: operation not permitted',
      'Access is denied.',
      '拒绝访问。',
      'EACCES: permission denied',
    ]) {
      expect(classifyWinSandboxDenial(text, 'runtime')).toBe('write');
    }
  });

  it('其它运行期错误 ⇒ null（不把脚本逻辑错算成沙箱拒绝）', () => {
    expect(
      classifyWinSandboxDenial('ReferenceError: x is not defined', 'runtime')
    ).toBeNull();
    expect(classifyWinSandboxDenial(undefined, 'runtime')).toBeNull();
  });
});
