// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Windows 兜底沙箱：helper 路径解析 + 能力探测 + argv/退出码语义（2026-10-26，方案 §5）
//
// 只覆盖**纯逻辑**；真机行为由 `bun run verify:win-sandbox`（步骤 3 之后）与 CI windows job 覆盖。
import { beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  WIN_SANDBOX_HELPER_BIN_NAME,
  WIN_SANDBOX_HELPER_ENV,
  buildWinSandboxArgv,
  classifyWinSandboxExit,
  clearWindowsSandboxCapabilityCache,
  detectWindowsSandboxCapability,
  resolveWinSandboxHelperCandidates,
  resolveWinSandboxHelperPath,
} from '../../src/sandbox/win';

const PROJECT = 'C:\\proj';
/** 期望路径一律用 `join()` 生成：CI 在 ubuntu/macos 也跑这些用例，写死 `\\` 会在 POSIX 上失败 */
const SHIPPED = join(PROJECT, 'bin', WIN_SANDBOX_HELPER_BIN_NAME);

describe('resolveWinSandboxHelperCandidates', () => {
  it('win32 ⇒ [显式 env, <PROJECT>/bin, 裸名]（去重保序）', () => {
    expect(
      resolveWinSandboxHelperCandidates({
        platform: 'win32',
        projectDir: PROJECT,
        env: { [WIN_SANDBOX_HELPER_ENV]: 'D:\\tools\\helper.exe' },
      })
    ).toEqual(['D:\\tools\\helper.exe', SHIPPED, WIN_SANDBOX_HELPER_BIN_NAME]);
  });

  it('非 win32 ⇒ 空数组（平台门控在探测/调度处）', () => {
    expect(
      resolveWinSandboxHelperCandidates({
        platform: 'linux',
        projectDir: PROJECT,
      })
    ).toEqual([]);
  });

  it('env 为空串 ⇒ 不产生空候选', () => {
    const list = resolveWinSandboxHelperCandidates({
      platform: 'win32',
      projectDir: PROJECT,
      env: { [WIN_SANDBOX_HELPER_ENV]: '   ' },
    });
    expect(list).not.toContain('');
    expect(list).toHaveLength(2);
  });
});

describe('resolveWinSandboxHelperPath', () => {
  it('显式 env 优先（即使文件不存在也原样返回，让配置错误可见）', () => {
    expect(
      resolveWinSandboxHelperPath({
        platform: 'win32',
        projectDir: PROJECT,
        env: { [WIN_SANDBOX_HELPER_ENV]: 'D:\\nope\\helper.exe' },
        exists: () => false,
      })
    ).toBe('D:\\nope\\helper.exe');
  });

  it('随包 bin 存在 ⇒ 用随包路径', () => {
    expect(
      resolveWinSandboxHelperPath({
        platform: 'win32',
        projectDir: PROJECT,
        env: {},
        exists: () => true,
      })
    ).toBe(SHIPPED);
  });

  it('都没有 ⇒ 裸名（交给 PATH）', () => {
    expect(
      resolveWinSandboxHelperPath({
        platform: 'win32',
        projectDir: PROJECT,
        env: {},
        exists: () => false,
      })
    ).toBe(WIN_SANDBOX_HELPER_BIN_NAME);
  });

  it('非 win32 ⇒ 裸名（不会被真正使用）', () => {
    expect(
      resolveWinSandboxHelperPath({ platform: 'darwin', projectDir: PROJECT })
    ).toBe(WIN_SANDBOX_HELPER_BIN_NAME);
  });
});

describe('detectWindowsSandboxCapability', () => {
  beforeEach(() => clearWindowsSandboxCapabilityCache());

  it('非 win32 ⇒ 不可用并给原因', () => {
    const cap = detectWindowsSandboxCapability({ platform: 'linux' });
    expect(cap.available).toBe(false);
    expect(cap.reason).toContain('非 Windows');
  });

  it('win32 + 随包 helper 存在 ⇒ 可用', () => {
    clearWindowsSandboxCapabilityCache();
    const cap = detectWindowsSandboxCapability({
      platform: 'win32',
      pathExists: () => true,
    });
    expect(cap.available).toBe(true);
    expect(cap.path).toContain(WIN_SANDBOX_HELPER_BIN_NAME);
  });

  it('win32 + 全都找不到 ⇒ 不可用，原因给出构建命令', () => {
    clearWindowsSandboxCapabilityCache();
    const cap = detectWindowsSandboxCapability({
      platform: 'win32',
      pathExists: () => false,
      resolveOnPath: () => null,
    });
    expect(cap.available).toBe(false);
    expect(cap.reason).toContain('build:win-sandbox');
  });

  it('裸名可在 PATH 解析 ⇒ 可用且回填绝对路径', () => {
    clearWindowsSandboxCapabilityCache();
    const cap = detectWindowsSandboxCapability({
      platform: 'win32',
      pathExists: () => false,
      resolveOnPath: () => 'C:\\tools\\win-sandbox-run.exe',
    });
    expect(cap).toEqual({
      available: true,
      path: 'C:\\tools\\win-sandbox-run.exe',
    });
  });

  it('结果缓存：清缓存前后可区分', () => {
    clearWindowsSandboxCapabilityCache();
    const first = detectWindowsSandboxCapability({
      platform: 'win32',
      pathExists: () => true,
    });
    const second = detectWindowsSandboxCapability({
      platform: 'win32',
      pathExists: () => false,
      resolveOnPath: () => null,
    });
    expect(second).toBe(first);
  });
});

describe('buildWinSandboxArgv', () => {
  it('基本形状：[--timeout-ms, N, --, program, ...args]', () => {
    expect(
      buildWinSandboxArgv({
        program: 'C:\\bun.exe',
        args: ['run', 'wrapper.ts', 'user.ts'],
        timeoutMs: 9000,
      })
    ).toEqual([
      '--timeout-ms',
      '9000',
      '--',
      'C:\\bun.exe',
      'run',
      'wrapper.ts',
      'user.ts',
    ]);
  });

  it('可选 Job 限制：mem/procs 在 -- 之前', () => {
    const argv = buildWinSandboxArgv({
      program: 'p.exe',
      args: [],
      timeoutMs: 1000,
      memMb: 512,
      maxProcs: 8,
    });
    expect(argv).toEqual([
      '--timeout-ms',
      '1000',
      '--mem-mb',
      '512',
      '--max-procs',
      '8',
      '--',
      'p.exe',
    ]);
  });
});

describe('classifyWinSandboxExit', () => {
  it('124 ⇒ 超时；126 ⇒ helper 失败；其余（含 125）⇒ 都是目标程序的退出码', () => {
    expect(classifyWinSandboxExit(124)).toEqual({
      timedOut: true,
      helperFailed: false,
    });
    expect(classifyWinSandboxExit(126)).toEqual({
      timedOut: false,
      helperFailed: true,
    });
    expect(classifyWinSandboxExit(125)).toEqual({
      timedOut: false,
      helperFailed: false,
    });
    expect(classifyWinSandboxExit(0)).toEqual({
      timedOut: false,
      helperFailed: false,
    });
    expect(classifyWinSandboxExit(null)).toEqual({
      timedOut: false,
      helperFailed: false,
    });
  });
});
