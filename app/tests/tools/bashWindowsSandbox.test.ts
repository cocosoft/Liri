// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-07（方案 §10）：Windows bash **真写隔离**。
 *
 * 锁六件事：
 *  ① 授权形态：`icacls <dir> /setintegritylevel (OI)(CI)Low`（真机取证过：
 *     `/grant *S-1-16-4096` 不足以让 Low IL 进程写入）；
 *  ② `finally` 必恢复：成功 / 失败 / 取消都要把标签恢复成授权前的级别（引用计数）；
 *  ③ 崩溃兜底：台账落盘 + 启动清理（恢复失败的条目保留重试）；
 *  ④ 失败走向：helper 缺失 / 授权失败 / helper 自身失败（126）按 `failClosed` 拒绝或降级；
 *  ⑤ 命令转交：经环境变量交给 `cmd.exe`（helper 的 argv 引号规则会破坏含引号的命令）；
 *  ⑥ 归因：`Access is denied` ⇒ `sandbox_denied: write`。
 *
 * ⚠️ 用例**不真的改 ACL**（全部注入 `runIcacls` / `runWinSandbox`）。
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beginWindowsBashGrants,
  buildIntegrityLevelArgs,
  buildWindowsBashInvocation,
  cleanupStaleWindowsBashGrants,
  describeIcaclsFailure,
  expandWindowsEnvVars,
  isWindowsAccessDenied,
  parseIntegrityLevel,
  readGrantJournal,
  readIntegrityJournal,
  resetWindowsBashGrantsForTest,
  WINDOWS_BASH_CMD_ENV,
  type IcaclsRunner,
} from '../../src/tools/bash/bashWindowsSandbox';
import {
  execBashCommand,
  type BashExecDeps,
} from '../../src/tools/bash/bashLandlockExec';
import {
  DEFAULT_LANDLOCK_CONFIG,
  type LandlockConfig,
  type WinSandboxRunInput,
  type WinSandboxRunResult,
} from '../../src/sandbox';

function cfg(over: Partial<LandlockConfig> = {}): LandlockConfig {
  return { ...DEFAULT_LANDLOCK_CONFIG, enabled: true, ...over };
}

function tempJournal(): string {
  return join(mkdtempSync(join(tmpdir(), 'bashwin-')), 'grants.json');
}

/**
 * 假的 icacls：记录调用，并在内存里维护「目录 → { 显式标签, 临时 WO ACE }」。
 *
 * `needWriteOwner=true` 用来复现真机取证：常见仓库目录只给 `Authenticated Users:(M)`，
 * 不含 `WRITE_OWNER` ⇒ 不补 `(WO)` 时 `/setintegritylevel` 会 `Access is denied`。
 */
function fakeIcacls(
  options: { failOnSet?: boolean; needWriteOwner?: boolean } = {}
): {
  calls: string[][];
  levels: Map<string, string>;
  writeOwner: Set<string>;
  run: IcaclsRunner;
} {
  const calls: string[][] = [];
  const levels = new Map<string, string>();
  const writeOwner = new Set<string>();
  const run: IcaclsRunner = async (args) => {
    calls.push([...args]);
    const [dir, op, arg] = args;
    if (op === '/grant') {
      writeOwner.add(dir);
      return { ok: true, stdout: '', stderr: '' };
    }
    if (op === '/remove:g') {
      writeOwner.delete(dir);
      return { ok: true, stdout: '', stderr: '' };
    }
    if (op === '/setintegritylevel') {
      if (options.failOnSet) {
        return { ok: false, stdout: '', stderr: 'Access is denied.' };
      }
      if (options.needWriteOwner && !writeOwner.has(dir)) {
        return { ok: false, stdout: '', stderr: 'Access is denied.' };
      }
      levels.set(dir, arg.replace('(OI)(CI)', ''));
      return { ok: true, stdout: '', stderr: '' };
    }
    const level = levels.get(dir);
    return {
      ok: true,
      stdout: level
        ? `${dir} Mandatory Label\\${level} Mandatory Level:(OI)(CI)(NW)`
        : `${dir} NT AUTHORITY\\SYSTEM:(I)(F)`,
      stderr: '',
    };
  };
  return { calls, levels, writeOwner, run };
}

const TEST_SID = 'S-1-5-21-1-2-3-1001';
const resolveUserSid = async (): Promise<string | null> => TEST_SID;

const setCalls = (calls: string[][]): string[][] =>
  calls.filter((args) => args[1] === '/setintegritylevel');

beforeEach(() => {
  resetWindowsBashGrantsForTest();
});

describe('§10 授权形态与解析', () => {
  it('argv：`icacls <dir> /setintegritylevel (OI)(CI)<level>`', () => {
    expect(buildIntegrityLevelArgs('C:\\ws', 'Low')).toEqual([
      'C:\\ws',
      '/setintegritylevel',
      '(OI)(CI)Low',
    ]);
  });

  it('解析显式标签（中英文），无标签 ⇒ null', () => {
    expect(
      parseIntegrityLevel('X Mandatory Label\\Low Mandatory Level:(OI)(CI)(NW)')
    ).toBe('Low');
    expect(
      parseIntegrityLevel(
        'X Mandatory Label\\Medium Mandatory Level:(OI)(CI)(NW)'
      )
    ).toBe('Medium');
    expect(parseIntegrityLevel('X 强制标签\\低强制级别:(OI)(CI)(NW)')).toBe(
      'Low'
    );
    expect(parseIntegrityLevel('X 强制标签\\中强制级别:(OI)(CI)(NW)')).toBe(
      'Medium'
    );
    expect(parseIntegrityLevel('X NT AUTHORITY\\SYSTEM:(I)(F)')).toBeNull();
  });

  it('拒绝访问的归因关键词', () => {
    expect(isWindowsAccessDenied('Access is denied.')).toBe(true);
    expect(isWindowsAccessDenied('拒绝访问。')).toBe(true);
    expect(isWindowsAccessDenied('boom')).toBe(false);
    expect(isWindowsAccessDenied(undefined)).toBe(false);
  });
});

describe('§10 授权 / 撤销（引用计数 + 台账）', () => {
  it('授权打 Low，释放后恢复到授权前级别（无显式标签 ⇒ 继承 Medium）', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls();
    const session = await beginWindowsBashGrants(['C:\\work\\ws'], {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });

    expect(session.ok).toBe(true);
    expect(icacls.levels.get('C:\\work\\ws')).toBe('Low');
    expect(readGrantJournal(journal)).toEqual([
      { dir: 'C:\\work\\ws', restoreLevel: 'Medium' },
    ]);

    await session.release();
    expect(icacls.levels.get('C:\\work\\ws')).toBe('Medium');
    expect(readGrantJournal(journal)).toEqual([]);
  });

  it('并发共用同一目录：最后一个释放才恢复', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls();
    const deps = {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    };
    const first = await beginWindowsBashGrants(['C:\\work\\ws'], deps);
    const second = await beginWindowsBashGrants(['C:\\work\\ws'], deps);

    await first.release();
    expect(icacls.levels.get('C:\\work\\ws')).toBe('Low');
    await second.release();
    expect(icacls.levels.get('C:\\work\\ws')).toBe('Medium');
  });

  it('不存在的目录跳过（不算失败）', async () => {
    const icacls = fakeIcacls();
    const session = await beginWindowsBashGrants(['C:\\nope'], {
      runIcacls: icacls.run,
      journalPath: tempJournal(),
      pathExists: () => false,
      resolveUserSid,
    });
    expect(session).toMatchObject({ ok: true, granted: [], failures: [] });
    expect(icacls.calls).toEqual([]);
  });

  it('设置标签失败 ⇒ ok=false（带原因），且不记台账', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls({ failOnSet: true });
    const session = await beginWindowsBashGrants(['C:\\work\\ws'], {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });
    expect(session.ok).toBe(false);
    expect(session.failures[0]?.dir).toBe('C:\\work\\ws');
    expect(session.failures[0]?.error).toContain('denied');
    expect(readGrantJournal(journal)).toEqual([]);
  });

  it('缺 WRITE_OWNER 的仓库目录：补一次 (WO) 后打标签成功，ACE 进程内缓存', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls({ needWriteOwner: true });
    const session = await beginWindowsBashGrants(['E:\\repo'], {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });

    expect(session.ok).toBe(true);
    expect(icacls.levels.get('E:\\repo')).toBe('Low');
    expect(icacls.writeOwner.has('E:\\repo')).toBe(true);
    expect(readGrantJournal(journal)).toEqual([
      { dir: 'E:\\repo', restoreLevel: 'Medium' },
    ]);
    // 台账里同时记下"这个目录有临时 WO ACE"（供下次启动撤销）
    expect(readIntegrityJournal(journal).writeOwners).toEqual(['E:\\repo']);
    // 授权顺序：先失败一次 → 补 WO → 重试成功
    expect(
      icacls.calls.filter((args) => args[1] === '/grant').map((a) => a[2])
    ).toEqual([`*${TEST_SID}:(WO)`]);

    await session.release();
    // 标签必须恢复；WO ACE 按决策**进程内保留**（下次启动统一撤）
    expect(icacls.levels.get('E:\\repo')).toBe('Medium');
    expect(icacls.writeOwner.has('E:\\repo')).toBe(true);
    expect(readGrantJournal(journal)).toEqual([]);
    expect(readIntegrityJournal(journal).writeOwners).toEqual(['E:\\repo']);
  });

  it('第二次命令复用已补的 WO ACE（不再触发 ACL 传播）', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls({ needWriteOwner: true });
    const deps = {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    };
    await (await beginWindowsBashGrants(['E:\\repo'], deps)).release();
    const grantCalls = icacls.calls.filter(
      (args) => args[1] === '/grant'
    ).length;

    const second = await beginWindowsBashGrants(['E:\\repo'], deps);
    expect(second.ok).toBe(true);
    await second.release();
    expect(icacls.calls.filter((args) => args[1] === '/grant').length).toBe(
      grantCalls
    );
  });

  it('台账残留（上次释放失败）⇒ 重新授权沿用最原始 restoreLevel，不把 Low 当目标', async () => {
    const journal = tempJournal();
    writeFileSync(
      journal,
      JSON.stringify({
        version: 2,
        entries: [{ dir: 'E:\\repo', restoreLevel: 'Medium' }],
        writeOwners: ['E:\\repo'],
      }),
      'utf8'
    );
    const icacls = fakeIcacls({ needWriteOwner: true });
    icacls.writeOwner.add('E:\\repo'); // 与台账一致：上次补的 ACE 仍在
    icacls.levels.set('E:\\repo', 'Low'); // 上次留下的 Low 标签

    const session = await beginWindowsBashGrants(['E:\\repo'], {
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });

    expect(session.ok).toBe(true);
    expect(readGrantJournal(journal)).toEqual([
      { dir: 'E:\\repo', restoreLevel: 'Medium' },
    ]);

    await session.release();
    expect(icacls.levels.get('E:\\repo')).toBe('Medium');
  });
});

describe('§10 崩溃兜底：启动清理', () => {
  it('按台账恢复并清空；恢复失败的条目保留重试', async () => {
    const journal = tempJournal();
    writeFileSync(
      journal,
      JSON.stringify({
        version: 1,
        entries: [
          { dir: 'C:\\a', restoreLevel: 'Medium' },
          { dir: 'C:\\b', restoreLevel: 'High' },
        ],
      }),
      'utf8'
    );
    const icacls = fakeIcacls();
    // 只让 C:\a 恢复成功
    const run: IcaclsRunner = async (args) =>
      args[0] === 'C:\\b'
        ? { ok: false, stdout: '', stderr: 'denied' }
        : icacls.run(args);

    const result = await cleanupStaleWindowsBashGrants({
      platform: 'win32',
      runIcacls: run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });

    expect(result.restored).toEqual(['C:\\a']);
    expect(result.failures.map((f) => f.dir)).toEqual(['C:\\b']);
    expect(readGrantJournal(journal)).toEqual([
      { dir: 'C:\\b', restoreLevel: 'High' },
    ]);
    expect(icacls.levels.get('C:\\a')).toBe('Medium');
  });

  it('非 Windows / 无台账 ⇒ 零动作', async () => {
    const journal = tempJournal();
    const icacls = fakeIcacls();
    expect(
      await cleanupStaleWindowsBashGrants({
        platform: 'linux',
        runIcacls: icacls.run,
        journalPath: journal,
      })
    ).toEqual({ restored: [], failures: [] });
    expect(
      await cleanupStaleWindowsBashGrants({
        platform: 'win32',
        runIcacls: icacls.run,
        journalPath: join(journal, '..', 'none.json'),
      })
    ).toEqual({ restored: [], failures: [] });
    expect(icacls.calls).toEqual([]);
  });

  it('台账损坏 ⇒ 视为空表，不抛错', () => {
    const journal = tempJournal();
    writeFileSync(journal, '{ not json', 'utf8');
    expect(readGrantJournal(journal)).toEqual([]);
  });

  it('启动清理会撤掉上次进程缓存的临时 WRITE_OWNER', async () => {
    const journal = tempJournal();
    writeFileSync(
      journal,
      JSON.stringify({
        version: 2,
        entries: [],
        writeOwners: ['E:\\repo'],
      }),
      'utf8'
    );
    const icacls = fakeIcacls();
    icacls.writeOwner.add('E:\\repo');

    const result = await cleanupStaleWindowsBashGrants({
      platform: 'win32',
      runIcacls: icacls.run,
      journalPath: journal,
      pathExists: () => true,
      resolveUserSid,
    });

    expect(result).toEqual({ restored: [], failures: [] });
    expect(icacls.writeOwner.has('E:\\repo')).toBe(false);
    expect(readIntegrityJournal(journal).writeOwners).toEqual([]);
  });
});

describe('§10 命令转交（环境变量 + cmd.exe）', () => {
  it('不含 % ⇒ 一遍展开；命令文本进环境变量', () => {
    const invocation = buildWindowsBashInvocation({
      command: 'echo "a b"',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
    });
    expect(invocation.program).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(invocation.args).toEqual([
      '/d',
      '/s',
      '/c',
      `%${WINDOWS_BASH_CMD_ENV}%`,
    ]);
    expect(invocation.env[WINDOWS_BASH_CMD_ENV]).toBe('echo "a b"');
  });

  it('`%VAR%` 先在 Node 侧展开（重定向目标里的变量也能用）', () => {
    const invocation = buildWindowsBashInvocation({
      command: 'echo hi > %TEMP%\\x.txt',
      env: { TEMP: 'C:\\Users\\u\\AppData\\Local\\Temp' },
      comspec: 'cmd.exe',
    });
    expect(invocation.env[WINDOWS_BASH_CMD_ENV]).toBe(
      'echo hi > C:\\Users\\u\\AppData\\Local\\Temp\\x.txt'
    );
    // 已无残留 % ⇒ 不再包 call（call 会弄坏重定向）
    expect(invocation.args.slice(-1)).toEqual([`%${WINDOWS_BASH_CMD_ENV}%`]);
  });

  it('动态变量（env 里没有，如 %ERRORLEVEL%）⇒ 交 `call` 第二遍展开', () => {
    const invocation = buildWindowsBashInvocation({
      command: 'echo %ERRORLEVEL%',
      env: { TEMP: 'C:\\t' },
      comspec: 'cmd.exe',
    });
    expect(invocation.args.slice(-1)).toEqual([
      `call %${WINDOWS_BASH_CMD_ENV}%`,
    ]);
    expect(invocation.env[WINDOWS_BASH_CMD_ENV]).toBe('echo %ERRORLEVEL%');
  });

  it('展开大小写不敏感，未定义的原样保留', () => {
    expect(expandWindowsEnvVars('echo %temp% %NOPE%', { TEMP: 'C:\\t' })).toBe(
      'echo C:\\t %NOPE%'
    );
  });
});

describe('§10 execBashCommand：Windows 写隔离接线', () => {
  const baseDeps = (over: Partial<BashExecDeps> = {}) => {
    const icacls = fakeIcacls();
    const winCalls: WinSandboxRunInput[] = [];
    const plainCalls: string[] = [];
    const journal = tempJournal();
    const deps: BashExecDeps = {
      config: cfg({ bashEnabled: true }),
      platform: 'win32',
      detectWin: () => ({ available: true, path: 'win-sandbox-run.exe' }),
      runWinSandbox: async (
        input: WinSandboxRunInput
      ): Promise<WinSandboxRunResult> => {
        winCalls.push(input);
        return {
          stdout: 'sandboxed-out',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          helperFailed: false,
        };
      },
      runIcacls: icacls.run,
      winGrantJournalPath: journal,
      winPathExists: () => true,
      winResolveUserSid: resolveUserSid,
      runPlain: async (command: string) => {
        plainCalls.push(command);
        return { stdout: 'plain-out', stderr: '' };
      },
      ...over,
    };
    return { icacls, winCalls, plainCalls, journal, deps };
  };

  it('成功：授权 → 在 helper 下执行 → finally 恢复标签', async () => {
    const ctx = baseDeps();
    const out = await execBashCommand({
      command: 'echo "a b"',
      cwd: 'C:\\work\\ws',
      env: { A: '1' },
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: ctx.deps,
    });

    expect(out).toEqual({ stdout: 'sandboxed-out', stderr: '' });
    expect(ctx.winCalls).toHaveLength(1);
    const input = ctx.winCalls[0];
    expect(input.args).toEqual(['/d', '/s', '/c', `%${WINDOWS_BASH_CMD_ENV}%`]);
    expect((input.env as Record<string, string>)[WINDOWS_BASH_CMD_ENV]).toBe(
      'echo "a b"'
    );
    expect(input.cwd).toBe('C:\\work\\ws');
    // 执行后必须恢复（Low → Medium），且台账清空
    expect(ctx.icacls.levels.get('C:\\work\\ws')).toBe('Medium');
    expect(setCalls(ctx.icacls.calls)[0][2]).toBe('(OI)(CI)Low');
    expect(readGrantJournal(ctx.journal)).toEqual([]);
  });

  it('helper 不可用 + failClosed=true ⇒ 拒绝（可归因 init），不跑 plain', async () => {
    const ctx = baseDeps({
      config: cfg({ bashEnabled: true, failClosed: true }),
      detectWin: () => ({ available: false, reason: 'helper-missing' }),
    });
    await expect(
      execBashCommand({
        command: 'dir',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: ctx.deps,
      })
    ).rejects.toThrow(/sandbox_denied: init/);
    expect(ctx.plainCalls).toEqual([]);
  });

  it('helper 不可用 + failClosed=false ⇒ 降级 plain', async () => {
    const ctx = baseDeps({
      detectWin: () => ({ available: false, reason: 'helper-missing' }),
    });
    const out = await execBashCommand({
      command: 'dir',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: ctx.deps,
    });
    expect(out).toEqual({ stdout: 'plain-out', stderr: '' });
    expect(ctx.plainCalls).toEqual(['dir']);
  });

  it('授权失败 + failClosed=true ⇒ 拒绝（不执行命令）', async () => {
    const ctx = baseDeps({
      config: cfg({ bashEnabled: true, failClosed: true }),
      runIcacls: fakeIcacls({ failOnSet: true }).run,
    });
    await expect(
      execBashCommand({
        command: 'dir',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: ctx.deps,
      })
    ).rejects.toThrow(/sandbox_denied: init/);
    expect(ctx.winCalls).toEqual([]);
    expect(ctx.plainCalls).toEqual([]);
  });

  it('helper 自身失败（126）+ failClosed=true ⇒ 拒绝', async () => {
    const ctx = baseDeps({
      config: cfg({ bashEnabled: true, failClosed: true }),
      runWinSandbox: async () => ({
        stdout: '',
        stderr: 'helper init failed',
        exitCode: 126,
        timedOut: false,
        helperFailed: true,
      }),
    });
    await expect(
      execBashCommand({
        command: 'dir',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: ctx.deps,
      })
    ).rejects.toThrow(/sandbox_denied: init/);
    expect(ctx.plainCalls).toEqual([]);
  });

  it('helper 自身失败（126）+ failClosed=false ⇒ 降级 plain（并已恢复标签）', async () => {
    const ctx = baseDeps({
      runWinSandbox: async () => ({
        stdout: '',
        stderr: 'helper init failed',
        exitCode: 126,
        timedOut: false,
        helperFailed: true,
      }),
    });
    const out = await execBashCommand({
      command: 'dir',
      cwd: 'C:\\work\\ws',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: ctx.deps,
    });
    expect(out).toEqual({ stdout: 'plain-out', stderr: '' });
    expect(ctx.icacls.levels.get('C:\\work\\ws')).toBe('Medium');
  });

  it('越界写被拒（Access is denied）⇒ 错误带 sandbox_denied: write', async () => {
    const ctx = baseDeps({
      runWinSandbox: async () => ({
        stdout: '',
        stderr: 'Access is denied.',
        exitCode: 1,
        timedOut: false,
        helperFailed: false,
      }),
    });
    let caught: Error | null = null;
    try {
      await execBashCommand({
        command: 'echo hi > C:\\Desktop\\x.txt',
        cwd: 'C:\\work\\ws',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: ctx.deps,
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('sandbox_denied: write');
    // 归因不改变「标签必须恢复」
    expect(ctx.icacls.levels.get('C:\\work\\ws')).toBe('Medium');
  });
});

describe('icacls 失败归因（describeIcaclsFailure，2026-11-07）', () => {
  it('超时（killed=true）不再伪装成「权限不足」', () => {
    const detail = describeIcaclsFailure({
      killed: true,
      stderr: '',
      message: 'Command failed: icacls.exe E:\\repo /grant *S-1-5-21:(WO)',
    });
    expect(detail).toContain('超时');
    // 真机：15s 超时 + 空 stderr ⇒ 旧实现只回 "Command failed: …"，看起来像拒绝访问
    expect(detail).not.toContain('Command failed');
  });

  it('有 stderr ⇒ 原样返回（如 Access is denied）', () => {
    expect(
      describeIcaclsFailure({
        stderr: 'Access is denied.\r\n',
        message: 'Command failed: icacls.exe x',
      })
    ).toBe('Access is denied.');
  });

  it('无 stderr 且未被终止 ⇒ 回退 message', () => {
    expect(
      describeIcaclsFailure({ message: 'Command failed: icacls.exe x' })
    ).toBe('Command failed: icacls.exe x');
  });
});
