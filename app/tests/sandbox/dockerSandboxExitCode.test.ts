/**
 * B4（2026-09-26，《Liri 优化方案》）：**用真实退出码替代异常推断**。
 *
 * 改前 `DockerSandbox.execute` 在 try 分支写死 `success: true, exitCode: 0`，真实退出码只在
 * catch 兜底 ⇒ "命令返回非 0 但没抛异常"这类情形会被判成成功（与"证据驱动"口径相悖）。
 *
 * 本文件用**假执行器**离线锁定（无需 Docker）：
 *  ① 退出码 7 ⇒ `success:false` / `exitCode:7`（改回写死即红）；
 *  ② 退出码 0 ⇒ 成功；
 *  ③ 参数为**数组直传**（内含 `docker` 前缀即红），且**不再二次转义**（原 `sanitizeCommand` 已移除）；
 *  ④ 取不到退出码（spawn 失败）与超时标志的透传；
 *  ⑤ `docker create` 非 0 ⇒ `initialize()` 失败。
 */
import { describe, expect, it } from 'bun:test';
import { DockerSandbox } from '../../src/sandbox/docker/DockerSandbox';
import type { DockerCliResult } from '../../src/sandbox/docker/dockerCli';
import type {
  SandboxConfig,
  SandboxPlatform,
} from '../../src/sandbox/SandboxTypes';

interface Scripted {
  code: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

/** 按 `args[0]`（子命令）脚本化回放的假执行器；`seen` 记录每次调用参数 */
function scriptedRun(script: Record<string, Scripted>, seen: string[][] = []) {
  const run = async (args: string[]): Promise<DockerCliResult> => {
    seen.push(args);
    const s = script[args[0]] ?? { code: 0, stdout: '' };
    return {
      code: s.code,
      stdout: s.stdout ?? '',
      stderr: s.stderr ?? '',
      ok: s.code === 0,
      timedOut: s.timedOut ?? false,
    };
  };
  return { run, seen };
}

function config(): SandboxConfig {
  return {
    platform: 'docker' as SandboxPlatform,
    allowedPermissions: [],
    filesystemWhitelist: [],
    networkWhitelist: [],
    environmentWhitelist: [],
    maxExecutionTime: 30_000,
    maxMemory: 512,
    customConfig: {},
  };
}

/** 起一个已初始化的沙箱（create 返回容器 id、start 成功） */
async function initialized(
  script: Record<string, Scripted> = {},
  seen: string[][] = []
): Promise<{ sb: DockerSandbox; seen: string[][] }> {
  const { run } = scriptedRun(
    {
      info: { code: 0 },
      image: { code: 0 },
      create: { code: 0, stdout: 'cid-123\n' },
      start: { code: 0 },
      ...script,
    },
    seen
  );
  const sb = new DockerSandbox(run);
  const ok = await sb.initialize(config());
  expect(ok).toBe(true);
  return { sb, seen };
}

describe('B4: execute 用真实退出码判定成败', () => {
  it('退出码 7 ⇒ success=false、exitCode=7、error 带出 stderr（改回写死即红）', async () => {
    const { sb } = await initialized({
      exec: { code: 7, stdout: 'partial', stderr: 'boom' },
    });
    const res = await sb.execute({ args: ['sh', '-c', 'exit 7'] });

    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(7);
    expect(res.stdout).toBe('partial');
    expect(res.stderr).toBe('boom');
    expect(res.error).toContain('boom');
  });

  it('退出码 0 ⇒ 成功且无 error', async () => {
    const { sb } = await initialized({ exec: { code: 0, stdout: 'ok' } });
    const res = await sb.execute({ args: ['echo', 'hi'] });

    expect(res.success).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.error).toBeUndefined();
    expect(res.stdout).toBe('ok');
  });

  it('取不到退出码（spawn 失败）⇒ success=false、exitCode=-1、error 有说明', async () => {
    const { sb, seen } = await initialized({
      exec: { code: null, stderr: 'ENOENT' },
    });
    const res = await sb.execute({ args: ['echo', 'hi'] });

    expect(res.success).toBe(false);
    expect(res.exitCode).toBe(-1);
    expect(res.error).toBeTruthy();
    expect(seen.some((a) => a[0] === 'exec')).toBe(true);
  });

  it('超时标志透传（timedOut=true）', async () => {
    const { sb } = await initialized({
      exec: { code: null, stderr: 'killed', timedOut: true },
    });
    const res = await sb.execute({ args: ['sleep', '99'] });
    expect(res.timedOut).toBe(true);
  });
});

describe('B4: 参数数组直传（不经宿主 shell、不再二次转义）', () => {
  it('exec 参数**不含** docker 前缀，且命令**原样**传递（原 sanitizeCommand 已移除）', async () => {
    const { sb, seen } = await initialized({ exec: { code: 0 } });
    const rawCommand = 'echo "a\\b" $HOME `whoami`';
    await sb.execute({ args: [rawCommand] });

    const execCall = seen.find((a) => a[0] === 'exec');
    expect(execCall).toBeDefined();
    expect(execCall!.includes('docker')).toBe(false);
    // 末尾元素 = 原样命令（若仍做转义，这里会出现 \\ 与 \" 等）
    expect(execCall![execCall!.length - 1]).toBe(rawCommand);
  });
});

describe('B4: initialize 亦按退出码判定', () => {
  it('docker create 非 0 ⇒ initialize() 失败（不因"没抛异常"而放行）', async () => {
    const { run } = scriptedRun({
      info: { code: 0 },
      image: { code: 0 },
      create: { code: 125, stderr: 'daemon error' },
    });
    const sb = new DockerSandbox(run);
    expect(await sb.initialize(config())).toBe(false);
  });
});
