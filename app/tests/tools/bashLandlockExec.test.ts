/**
 * G1-A（2026-09-26，《Liri 优化方案》G 组 选项 A）：**bash 接入 Landlock**。
 *
 * 锁六件事：
 *  ① **默认关闭**：`DEFAULT_LANDLOCK_CONFIG.bashEnabled === false`（安全面行为变更不默认生效）；
 *  ② **门控判据**（纯函数，逐分支）：总开关关 / 分项关 ⇒ `plain`；开启但平台或能力不满足 ⇒ `refuse`；
 *  ③ **不静默降级**：开启却无法受限时**拒绝执行**，且**不调用**普通执行器（这条是本项的安全底线）；
 *  ④ **策略形状**：cwd/受管目录/临时区**可写**，系统路径与 `~/.pyapp`（配置凭据）**只读**，
 *     网络**显式放行**（照抄 code_run 的"无 net 规则"会让 curl/git/npm 全废）；
 *  ⑤ **argv 形状**：策略经 `--ro/--rw` 声明、命令作为**单个 argv 元素**交给 `/bin/sh -c`（不拼 shell）；
 *  ⑥ **成败承接**：exit 0/非 0、exit 125（+`failClosed` 两种走向）、未取到退出码 —— 与 `exec` 路径同形。
 *
 * ⚠️ 本机为 Windows ⇒ **真实 Linux 上的 enforce 行为未验证**；用例覆盖的是判据、形状与分支。
 */
import { describe, expect, it } from 'bun:test';
import { resolveOutputDir } from '@modules/core/paths';
import {
  buildBashLandlockPolicy,
  decideBashLandlockGate,
  execBashCommand,
  type LandlockHelperRunner,
  type PlainRunner,
} from '../../src/tools/bash/bashLandlockExec';
import {
  DEFAULT_LANDLOCK_CONFIG,
  ENV_EVAL_BASH_LANDLOCK,
  isEvalBashLandlockForced,
  type LandlockCapability,
  type LandlockConfig,
} from '../../src/sandbox';

/** 造配置：默认项 + 覆盖 */
function cfg(over: Partial<LandlockConfig> = {}): LandlockConfig {
  return { ...DEFAULT_LANDLOCK_CONFIG, ...over };
}

const AVAILABLE: LandlockCapability = { available: true, abi: 3 };

function plainSpy(
  result: { stdout: string; stderr: string } = {
    stdout: 'plain-out',
    stderr: '',
  }
): {
  calls: Array<{ command: string; options: Record<string, unknown> }>;
  runPlain: PlainRunner;
} {
  const calls: Array<{ command: string; options: Record<string, unknown> }> =
    [];
  const runPlain: PlainRunner = async (command, options) => {
    calls.push({ command, options: { ...options } });
    return result;
  };
  return { calls, runPlain };
}

describe('G1-A: 默认关闭 + 门控判据（纯函数）', () => {
  it('默认配置不开 bash 接入（安全面行为变更不默认生效）', () => {
    expect(DEFAULT_LANDLOCK_CONFIG.bashEnabled).toBe(false);
  });

  it('总开关关闭 ⇒ 普通路径（即便分项开着）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ enabled: false, bashEnabled: true }),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'plain', reason: 'master-off' });
  });

  it('分项关闭 ⇒ 普通路径', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: false }),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'plain', reason: 'switch-off' });
  });

  it('开启但平台不支持 ⇒ 拒绝执行（并给出可操作出路）', () => {
    const gate = decideBashLandlockGate({
      config: cfg({ bashEnabled: true }),
      platform: 'win32',
      capability: null,
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('platform-unsupported');
    expect(gate.message).toContain('win32');
    expect(gate.message).toContain('sandbox.landlock.bashEnabled');
  });

  it('开启但能力不可用 ⇒ 拒绝执行（原因带出）', () => {
    const gate = decideBashLandlockGate({
      config: cfg({ bashEnabled: true }),
      platform: 'linux',
      capability: { available: false, abi: 0, reason: 'helper-missing' },
    });
    expect(gate.mode).toBe('refuse');
    expect(gate.reason).toBe('capability-unavailable');
    expect(gate.message).toContain('helper-missing');
  });

  it('开启且能力可用 ⇒ 走 Landlock', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: true }),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'landlock', reason: 'enabled' });
  });
});

describe('P0-4 ②（2026-10-04）：评测期强制 bash 走 Landlock —— capability-gated', () => {
  it('env 判定：仅字面 "1" 为真（未设/其他值均为假）', () => {
    expect(
      isEvalBashLandlockForced({
        [ENV_EVAL_BASH_LANDLOCK]: '1',
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isEvalBashLandlockForced({
        [ENV_EVAL_BASH_LANDLOCK]: '0',
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(isEvalBashLandlockForced({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('强制 + Linux + 能力可用 ⇒ 走 Landlock（即便 config.bashEnabled=false）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: false }),
        platform: 'linux',
        capability: AVAILABLE,
        evalForced: true,
      })
    ).toEqual({ mode: 'landlock', reason: 'eval-forced' });
  });

  it('强制 + 能力不可用 ⇒ **回退 plain**（关键：不 refuse，避免打断评测）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: false }),
        platform: 'linux',
        capability: { available: false, abi: 0, reason: 'helper-missing' },
        evalForced: true,
      })
    ).toEqual({ mode: 'plain', reason: 'eval-forced-fallback' });
  });

  it('强制 + 非 Linux ⇒ 回退 plain（不 refuse）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: false }),
        platform: 'win32',
        capability: null,
        evalForced: true,
      })
    ).toEqual({ mode: 'plain', reason: 'eval-forced-fallback' });
  });

  it('强制但总开关关闭 ⇒ 仍 plain（master-off 优先）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ enabled: false }),
        platform: 'linux',
        capability: AVAILABLE,
        evalForced: true,
      })
    ).toEqual({ mode: 'plain', reason: 'master-off' });
  });

  it('未强制 ⇒ 行为不变（回归护栏）', () => {
    expect(
      decideBashLandlockGate({
        config: cfg({ bashEnabled: false }),
        platform: 'linux',
        capability: AVAILABLE,
      })
    ).toEqual({ mode: 'plain', reason: 'switch-off' });
  });
});

describe('G1-A: 策略形状（写权限最小化 + 网络显式放行）', () => {
  const policy = buildBashLandlockPolicy({
    cwd: '/work/x',
    abi: 3,
    homeDir: '/home/u',
  });
  const rule = (path: string) => policy.fs.find((r) => r.path === path);

  it('系统路径只读（漏声明会让 shell 自身起不来）', () => {
    for (const path of ['/usr', '/bin', '/lib', '/etc', '/proc']) {
      expect(rule(path)?.allow).toEqual(['read', 'execute']);
    }
  });

  it('`~/.pyapp` 整棵目录树**不放行**（P0-3-a，2026-09-28）', () => {
    // 此前这里是 `{path: '~/.pyapp', allow: read+execute}`（只读）—— "挡改不挡读"，
    // 而该目录下有 config.json / credentials.json / data/app.db / sessions / memory 等
    // ⇒ 在 bash 域内**可读**（凭据与会话数据泄露）。现整条移除。
    expect(rule('/home/u/.pyapp')).toBeUndefined();
  });

  it('工作区与受管目录可写', () => {
    expect(rule('/work/x')?.allow).toContain('write');
    expect(rule(resolveOutputDir())?.allow).toContain('write');
  });

  it('/dev 可写（`2>/dev/null` 等常规重定向）', () => {
    expect(rule('/dev')?.allow).toContain('write');
  });

  it('**不设 `net`** ⇒ 网络不受限（否则 curl/git/npm 全废）', () => {
    // 2026-09-29（台账 D-36-① / D-38）：原实现传 `net.allow = ['connect_tcp','connect_udp']`
    // （意图"显式放行"），但内核语义是"handle 即默认拒绝"，而 `--net-connect` 从不加 net 授权规则
    // ⇒ 实际效果是**拒绝** CONNECT（反而误伤 curl/git/npm）。且"按任意端口放行"在内核层面
    // **无法表达**（net 规则只能授具体端口）⇒ 正确形态 = **根本不给 `net` 字段**
    //（不 handle ⇒ 内核视为不受限），由 `landlockNetPolicy.test.ts` 统一守卫该两态契约。
    expect(policy.net).toBeUndefined();
  });

  it('cwd 与 abi 原样带出', () => {
    expect(policy.cwd).toBe('/work/x');
    expect(policy.abi).toBe(3);
  });
});

describe('G1-A: 开关关闭 ⇒ 与改造前等价（且不探测）', () => {
  it('走普通执行器，参数含 timeout / maxBuffer / cwd / env', async () => {
    const spy = plainSpy();
    let detectCalls = 0;
    const out = await execBashCommand({
      command: 'echo hi',
      cwd: '/work/x',
      env: { A: '1' },
      timeoutMs: 1234,
      maxBufferChars: 4096,
      deps: {
        config: cfg({ bashEnabled: false }),
        platform: 'linux',
        detect: async () => {
          detectCalls += 1;
          return AVAILABLE;
        },
        runPlain: spy.runPlain,
      },
    });

    expect(out).toEqual({ stdout: 'plain-out', stderr: '' });
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0].command).toBe('echo hi');
    expect(spy.calls[0].options).toEqual({
      cwd: '/work/x',
      env: { A: '1' },
      timeout: 1234,
      maxBuffer: 4096,
    });
    // 未开启 ⇒ 连探测都不做（零 IO）
    expect(detectCalls).toBe(0);
  });
});

describe('G1-A: 开启后无法受限 ⇒ 拒绝（不静默降级）', () => {
  it('非 Linux：拒绝，且**不调用**普通执行器', async () => {
    const spy = plainSpy();
    await expect(
      execBashCommand({
        command: 'echo hi',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: {
          config: cfg({ bashEnabled: true }),
          platform: 'win32',
          runPlain: spy.runPlain,
        },
      })
    ).rejects.toThrow(/sandbox\.landlock\.bashEnabled/);
    expect(spy.calls).toEqual([]);
  });

  it('能力不可用：拒绝，且**不调用**普通执行器', async () => {
    const spy = plainSpy();
    await expect(
      execBashCommand({
        command: 'echo hi',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: {
          config: cfg({ bashEnabled: true }),
          platform: 'linux',
          detect: async () => ({
            available: false,
            abi: 0,
            reason: 'helper-missing',
          }),
          runPlain: spy.runPlain,
        },
      })
    ).rejects.toThrow(/helper-missing/);
    expect(spy.calls).toEqual([]);
  });
});

describe('G1-A: Landlock 域内执行（argv 形状 + 成败承接）', () => {
  const baseDeps = (runHelper: LandlockHelperRunner) => ({
    config: cfg({ bashEnabled: true }),
    platform: 'linux' as NodeJS.Platform,
    detect: async () => AVAILABLE,
    runHelper,
  });

  it('argv：策略经 --ro/--rw 声明，命令以**单个 argv 元素**交给 /bin/sh -c', async () => {
    const seen: string[] = [];
    const spy = plainSpy();
    const out = await execBashCommand({
      command: 'echo "a b" | wc -l',
      cwd: '/work/x',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: {
        ...baseDeps(async (input) => {
          seen.push(...input.argv);
          return {
            stdout: 'landlock-out',
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }),
        runPlain: spy.runPlain,
      },
    });

    expect(out).toEqual({ stdout: 'landlock-out', stderr: '' });
    expect(seen.slice(-4)).toEqual([
      '--',
      '/bin/sh',
      '-c',
      'echo "a b" | wc -l',
    ]);
    // 命令是**独立元素**（不拼 shell、不二次转义）
    expect(seen.filter((a) => a === 'echo "a b" | wc -l')).toHaveLength(1);
    // cwd 以 --rw 声明
    let cwdRw = false;
    for (let i = 0; i < seen.length - 4; i += 2) {
      if (seen[i] === '--rw' && seen[i + 1] === '/work/x') cwdRw = true;
    }
    expect(cwdRw).toBe(true);
    expect(seen).toContain('--ro');
    // 走了 Landlock ⇒ 不再走普通路径
    expect(spy.calls).toEqual([]);
  });

  it('非 0 退出 ⇒ 抛错并带出 stderr / code（与 exec 同形）', async () => {
    let caught: (Error & { code?: number; stderr?: string }) | null = null;
    try {
      await execBashCommand({
        command: 'exit 7',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: baseDeps(async () => ({
          stdout: 'partial',
          stderr: 'boom',
          exitCode: 7,
          timedOut: false,
        })),
      });
    } catch (error) {
      caught = error as Error & { code?: number; stderr?: string };
    }

    expect(caught?.message).toContain('Command failed');
    expect(caught?.code).toBe(7);
    expect(caught?.stderr).toBe('boom');
  });

  it('exit 125 + failClosed=true ⇒ 拒绝（不执行命令）', async () => {
    const spy = plainSpy();
    await expect(
      execBashCommand({
        command: 'echo hi',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: {
          ...baseDeps(async () => ({
            stdout: '',
            stderr: 'landlock-run: init failed',
            exitCode: 125,
            timedOut: false,
          })),
          config: cfg({ bashEnabled: true, failClosed: true }),
          runPlain: spy.runPlain,
        },
      })
    ).rejects.toThrow(/沙箱初始化失败/);
    expect(spy.calls).toEqual([]);
  });

  it('exit 125 + failClosed=false ⇒ 回退普通执行（既有契约）', async () => {
    const spy = plainSpy({ stdout: 'fallback', stderr: '' });
    const out = await execBashCommand({
      command: 'echo hi',
      env: {},
      timeoutMs: 1000,
      maxBufferChars: 1024,
      deps: {
        ...baseDeps(async () => ({
          stdout: '',
          stderr: 'landlock-run: init failed',
          exitCode: 125,
          timedOut: false,
        })),
        config: cfg({ bashEnabled: true, failClosed: false }),
        runPlain: spy.runPlain,
      },
    });

    expect(out).toEqual({ stdout: 'fallback', stderr: '' });
    expect(spy.calls).toHaveLength(1);
  });

  it('未取到退出码（被杀/超时）⇒ 抛错', async () => {
    await expect(
      execBashCommand({
        command: 'sleep 999',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: baseDeps(async () => ({
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: true,
        })),
      })
    ).rejects.toThrow(/未取到退出码|Command failed/);
  });

  it('helper 启动失败 ⇒ 抛出该错误（带原因）', async () => {
    await expect(
      execBashCommand({
        command: 'echo hi',
        env: {},
        timeoutMs: 1000,
        maxBufferChars: 1024,
        deps: baseDeps(async () => ({
          stdout: '',
          stderr: 'spawn ENOENT',
          exitCode: null,
          timedOut: false,
          error: new Error('spawn landlock-run ENOENT'),
        })),
      })
    ).rejects.toThrow(/ENOENT/);
  });
});
