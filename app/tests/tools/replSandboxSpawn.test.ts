/**
 * SG-1（2026-11-27）：REPL / notebook 执行面的平台写隔离 —— spawn 决策单测。
 *
 * 覆盖三件事（不真起沙箱进程，能力探测/授权全部注入）：
 *  1. **形态**：Linux ⇒ `landlock-run … -- 解释器…`；macOS ⇒ `sandbox-exec -p <SBPL> -- …`；
 *     Windows ⇒ `win-sandbox-run.exe --timeout-ms 0 -- <exe>…`（stdio 由子进程继承，交互不受影响）；
 *  2. **写白名单与 bash 同源**：目录清单来自 `buildShellManagedWritableDirs`（工作区 + 受管产物 + 附件）；
 *  3. **不可用时的语义**：`failClosed=false` ⇒ 降级普通 spawn 并给可读告警；
 *     `failClosed=true` ⇒ `refuse`（`startREPL` 抛 `SG1_REPL_SANDBOX_UNENFORCEABLE`）。
 */
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertReplSandboxPlanUsable,
  planReplSandboxSpawn,
  quoteWindowsCommandLineArg,
} from '@openliri/tool-code/repl/replSandboxSpawn';
import type {
  ReplSandboxPlan,
  ReplSandboxPlannerDeps,
  WindowsGrantSessionLike,
} from '@openliri/tool-code/repl/replSandboxSpawn';
import { attachReplSandboxRelease } from '@openliri/tool-code/repl/REPLToolImpl';
import {
  escapeSbplString,
  type LandlockCapability,
  type LandlockConfig,
} from '@modules/sandbox';
import { toKernelPath } from '@modules/sandbox/darwin/MacOSSandboxPolicy';

const ON: LandlockConfig = {
  enabled: true,
  failClosed: false,
  bashEnabled: false,
  bashExtraWritablePaths: [],
};

const PYTHON = { command: 'python', args: ['-i', '-q'] };

function baseDeps(overrides: Partial<ReplSandboxPlannerDeps> = {}) {
  return {
    config: ON,
    // 默认"所有规则路径都存在"，便于断言 argv 里有 --rw/--ro
    pathExists: () => true,
    ...overrides,
  } satisfies ReplSandboxPlannerDeps;
}

function plan(
  deps: ReplSandboxPlannerDeps,
  cwd = process.cwd()
): Promise<ReplSandboxPlan> {
  return planReplSandboxSpawn({ ...PYTHON, cwd, env: { PATH: '/x' }, deps });
}

describe('quoteWindowsCommandLineArg：MSVCRT 规则', () => {
  it('普通参数也加引号（让 `& | < > ^` 落在引号内）', () => {
    expect(quoteWindowsCommandLineArg('-i')).toBe('"-i"');
    expect(quoteWindowsCommandLineArg('a&b')).toBe('"a&b"');
  });

  it('含空格 / 空串', () => {
    expect(quoteWindowsCommandLineArg('a b')).toBe('"a b"');
    expect(quoteWindowsCommandLineArg('')).toBe('""');
  });

  it('字面引号 ⇒ `\\"`（前置反斜杠按 2n+1 翻倍）', () => {
    expect(quoteWindowsCommandLineArg('x"y')).toBe('"x\\"y"');
    expect(quoteWindowsCommandLineArg('x\\"y')).toBe('"x\\\\\\"y"');
  });

  it('结尾反斜杠翻倍（否则会吃掉闭合引号）', () => {
    expect(quoteWindowsCommandLineArg('C:\\dir\\')).toBe('"C:\\dir\\\\"');
  });
});

describe('planReplSandboxSpawn：总开关', () => {
  it('sandbox.landlock.enabled=false ⇒ 不隔离（原样 spawn）', async () => {
    const p = await plan(
      baseDeps({
        config: { ...ON, enabled: false },
        platform: 'linux',
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('master-off');
    expect(p.command).toBe('python');
    expect(p.args).toEqual(PYTHON.args);
    expect(p.warning).toBeDefined();
  });
});

describe('planReplSandboxSpawn：Linux Landlock', () => {
  it('能力可用 ⇒ landlock-run 包裹，写白名单含工作区（--rw）', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'repl-sbx-linux-'));
    try {
      const p = await plan(
        baseDeps({
          platform: 'linux',
          landlockHelperPath: '/opt/landlock-run',
          detectLandlock: async () =>
            ({ available: true, abi: 5 }) as LandlockCapability,
        }),
        cwd
      );
      expect(p.mode).toBe('landlock');
      expect(p.command).toBe('/opt/landlock-run');
      // 规则之后是 `-- 解释器 参数…`（helper 直接 execvp ⇒ stdio 透传，交互保持）
      const sep = p.args.indexOf('--');
      expect(sep).toBeGreaterThan(0);
      expect(p.args.slice(sep + 1)).toEqual(['python', ...PYTHON.args]);
      // 写白名单 = 工作区 + 受管目录（与 bash 同源）
      expect(p.args).toContain('--rw');
      expect(p.args).toContain(cwd);
      // 系统读路径走 --ro
      expect(p.args).toContain('--ro');
      expect(p.args).toContain('/usr');
      // 不 handle 网络（与 bash 口径一致：不传网络参数）
      expect(p.args).not.toContain('--net-deny');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('能力不可用 + failClosed=false ⇒ 降级普通 spawn 并告警', async () => {
    const p = await plan(
      baseDeps({
        platform: 'linux',
        detectLandlock: async () =>
          ({
            available: false,
            abi: 0,
            reason: 'no-linux',
          }) as LandlockCapability,
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('landlock-unavailable');
    expect(p.command).toBe('python');
    expect(p.warning).toContain('未进写隔离');
  });

  it('能力不可用 + failClosed=true ⇒ refuse（调用方抛错，不 spawn）', async () => {
    const p = await plan(
      baseDeps({
        platform: 'linux',
        config: { ...ON, failClosed: true },
        detectLandlock: async () =>
          ({
            available: false,
            abi: 0,
            reason: 'no-linux',
          }) as LandlockCapability,
      })
    );
    expect(p.mode).toBe('refuse');
    expect(p.message).toContain('failClosed=true');
    expect(() => assertReplSandboxPlanUsable(p)).toThrow(/拒绝启动|无法施加/);
  });
});

describe('planReplSandboxSpawn：macOS Seatbelt', () => {
  it('sandbox-exec 可用 ⇒ -p <SBPL> -- 解释器（profile 含工作区写白名单 + /dev）', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'repl-sbx-mac-'));
    try {
      const p = await plan(
        baseDeps({
          platform: 'darwin',
          detectMac: () => ({
            available: true,
            path: '/usr/bin/sandbox-exec',
          }),
        }),
        cwd
      );
      expect(p.mode).toBe('sandbox-exec');
      expect(p.command).toBe('/usr/bin/sandbox-exec');
      expect(p.args[0]).toBe('-p');
      const profile = p.args[1];
      expect(profile).toContain('(deny default)');
      // 路径先按内核视角归一（macOS 的 `tmpdir()` 是 `/var/…`，profile 里是 `/private/var/…`），
      // 再按 SBPL 规则转义（Windows 上跑本用例时反斜杠会被转义）
      expect(profile).toContain(
        `(subpath "${escapeSbplString(toKernelPath(cwd))}")`
      );
      // 与 bash 的 macOS 白名单同源：`/dev`（`2>/dev/null` 等重定向）
      expect(profile).toContain('(subpath "/dev")');
      expect(p.args[2]).toBe('--');
      expect(p.args.slice(3)).toEqual(['python', ...PYTHON.args]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('sandbox-exec 不可用 ⇒ 降级（默认不拒绝）', async () => {
    const p = await plan(
      baseDeps({
        platform: 'darwin',
        detectMac: () => ({ available: false, reason: 'missing' }),
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('sandbox-exec-unavailable');
  });
});

describe('planReplSandboxSpawn：Windows Low IL', () => {
  const grantOk = (): {
    calls: number;
    releases: number;
    session: WindowsGrantSessionLike;
  } => {
    const state = {
      calls: 0,
      releases: 0,
      session: {
        ok: true,
        failures: [] as { dir: string; error: string }[],
        release: async () => {
          state.releases += 1;
        },
      },
    };
    return state;
  };

  it('helper 可用 ⇒ win-sandbox-run --timeout-ms 0 -- <exe>（TEMP 指到受管临时目录）', async () => {
    const grants = grantOk();
    const p = await plan(
      baseDeps({
        platform: 'win32',
        winHelperPath: 'C:/bin/win-sandbox-run.exe',
        detectWin: () => ({
          available: true,
          present: true,
          runnable: true,
          path: 'C:/bin/win-sandbox-run.exe',
        }),
        resolveWinProgram: () => ({
          program: 'C:/Python/python.exe',
          viaCmd: false,
        }),
        beginWinGrants: async () => {
          grants.calls += 1;
          return grants.session;
        },
      })
    );
    expect(p.mode).toBe('windows-low-il');
    expect(p.command).toBe('C:/bin/win-sandbox-run.exe');
    // 0 = helper 不限时（长驻 REPL）；目标程序是**解析后的 .exe**
    expect(p.args).toEqual([
      '--timeout-ms',
      '0',
      '--',
      'C:/Python/python.exe',
      ...PYTHON.args,
    ]);
    expect(p.env.TEMP).toBe(p.env.TMP);
    expect(p.release).toBeDefined();
    expect(grants.calls).toBe(1);
  });

  it('可写目录授权失败 + failClosed=false ⇒ 先释放授权，再降级', async () => {
    let released = 0;
    const p = await plan(
      baseDeps({
        platform: 'win32',
        detectWin: () => ({ available: true, runnable: true }),
        resolveWinProgram: () => ({
          program: 'C:/Python/python.exe',
          viaCmd: false,
        }),
        beginWinGrants: async () => ({
          ok: false,
          failures: [{ dir: 'C:/ws', error: 'Access is denied' }],
          release: async () => {
            released += 1;
          },
        }),
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('windows-grant-failed');
    expect(p.warning).toContain('Access is denied');
    expect(released).toBe(1);
    expect(p.release).toBeUndefined();
  });

  it('可写目录授权失败 + failClosed=true ⇒ 释放后 refuse', async () => {
    let released = 0;
    const p = await plan(
      baseDeps({
        platform: 'win32',
        config: { ...ON, failClosed: true },
        detectWin: () => ({ available: true, runnable: true }),
        resolveWinProgram: () => ({
          program: 'C:/Python/python.exe',
          viaCmd: false,
        }),
        beginWinGrants: async () => ({
          ok: false,
          failures: [{ dir: 'C:/ws', error: 'denied' }],
          release: async () => {
            released += 1;
          },
        }),
      })
    );
    expect(p.mode).toBe('refuse');
    expect(released).toBe(1);
  });

  it('命令解析不出可启动形态 ⇒ 降级（不猜路径）', async () => {
    const p = await plan(
      baseDeps({
        platform: 'win32',
        detectWin: () => ({ available: true, runnable: true }),
        resolveWinProgram: () => null,
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('windows-unresolvable-command');
  });

  it('`.cmd`（如 npx）⇒ 经 cmd.exe /d /s /c + 环境变量转交，命令文本带引号路径', async () => {
    const p = await planReplSandboxSpawn({
      command: 'npx',
      args: ['ts-node', '-i'],
      cwd: process.cwd(),
      env: { PATH: '/x' },
      deps: baseDeps({
        platform: 'win32',
        winHelperPath: 'C:/bin/win-sandbox-run.exe',
        detectWin: () => ({ available: true, runnable: true }),
        resolveWinProgram: () => ({
          program: 'C:/Program Files/nodejs/npx.cmd',
          viaCmd: true,
        }),
        beginWinGrants: async () => ({
          ok: true,
          failures: [],
          release: async () => {},
        }),
      }),
    });
    expect(p.mode).toBe('windows-low-il');
    // helper 的 argv 里只有 `%LIRI_REPL_CMD%`（无空格 ⇒ 不经 helper 的引号规则）
    expect(p.args.slice(-5)).toEqual([
      'cmd.exe',
      '/d',
      '/s',
      '/c',
      '%LIRI_REPL_CMD%',
    ]);
    // 真正的命令文本走环境变量（UTF-16 环境块，避开 cmd 不认 `\"` 的问题）；
    // 每个参数一律按 CRT 规则加引号（`& | < > ^` 因此落在引号内）
    expect(p.env.LIRI_REPL_CMD).toBe(
      '"C:/Program Files/nodejs/npx.cmd" "ts-node" "-i"'
    );
  });

  it('`.cmd` 且参数含双引号 ⇒ 按 CRT 规则转义，仍然进沙箱（不降级）', async () => {
    const p = await planReplSandboxSpawn({
      command: 'npx',
      args: ['x"y', 'C:\\dir\\'],
      cwd: process.cwd(),
      env: { PATH: '/x' },
      deps: baseDeps({
        platform: 'win32',
        detectWin: () => ({ available: true, runnable: true }),
        resolveWinProgram: () => ({ program: 'C:/x/run.cmd', viaCmd: true }),
        beginWinGrants: async () => ({
          ok: true,
          failures: [],
          release: async () => {},
        }),
      }),
    });
    expect(p.mode).toBe('windows-low-il');
    // 字面引号 ⇒ `\"`；结尾反斜杠 ⇒ 双写（否则会吃掉闭合引号）
    expect(p.env.LIRI_REPL_CMD).toBe('"C:/x/run.cmd" "x\\"y" "C:\\dir\\\\"');
  });

  it('`.cmd` 且参数含 `%` / 换行 ⇒ 降级（cmd 会改写或截断）', async () => {
    const planFor = (arg: string) =>
      planReplSandboxSpawn({
        command: 'npx',
        args: [arg],
        cwd: process.cwd(),
        env: { PATH: '/x' },
        deps: baseDeps({
          platform: 'win32',
          detectWin: () => ({ available: true, runnable: true }),
          resolveWinProgram: () => ({ program: 'C:/x/run.cmd', viaCmd: true }),
          beginWinGrants: async () => ({
            ok: true,
            failures: [],
            release: async () => {},
          }),
        }),
      });
    for (const arg of ['--fmt=%s', 'a\nb']) {
      const p = await planFor(arg);
      // 未授权前就拒绝转交 ⇒ 不会去改 ACL
      expect(p.mode).toBe('none');
      expect(p.reason).toBe('windows-cmd-unsafe-args');
    }
  });

  it('helper 的 --probe 未通过（runnable=false）⇒ 与缺失同口径', async () => {
    const p = await plan(
      baseDeps({
        platform: 'win32',
        detectWin: () => ({
          available: true,
          runnable: false,
          reason: 'helper --probe 未通过',
        }),
      })
    );
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('windows-helper-unavailable');
  });
});

describe('planReplSandboxSpawn：不支持的平台', () => {
  it('freebsd ⇒ 降级（无后端）', async () => {
    const p = await plan(baseDeps({ platform: 'freebsd' }));
    expect(p.mode).toBe('none');
    expect(p.reason).toBe('platform-unsupported');
  });
});

describe('attachReplSandboxRelease：释放只生效一次', () => {
  it('进程退出与 stopREPL 都调用 ⇒ 底层 release 只跑一次', async () => {
    let calls = 0;
    const child = new EventEmitter();
    const session: Parameters<typeof attachReplSandboxRelease>[0] = {
      process: child as never,
      sandbox: undefined,
    };
    attachReplSandboxRelease(session, {
      command: 'x',
      args: [],
      env: {},
      mode: 'windows-low-il',
      reason: 'test',
      release: async () => {
        calls += 1;
      },
    } as ReplSandboxPlan);
    expect(session.sandbox?.mode).toBe('windows-low-il');

    await session.sandbox!.release!();
    await session.sandbox!.release!();
    child.emit('exit', 0);
    await Promise.resolve();

    expect(calls).toBe(1);
  });

  it('无 release（Linux/macOS）⇒ 仅记录 mode', () => {
    const session: Parameters<typeof attachReplSandboxRelease>[0] = {
      sandbox: undefined,
    };
    attachReplSandboxRelease(session, {
      command: 'x',
      args: [],
      env: {},
      mode: 'landlock',
      reason: 'test',
    });
    expect(session.sandbox).toEqual({ mode: 'landlock' });
  });
});
