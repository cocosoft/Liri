// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P1（2026-10-25）：插件子进程宿主监督器 —— 用**假子进程**覆盖
// 握手 / 工具代理 / 审计 / 崩溃结算 / 有界重启 / 关停（不真 spawn）。
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { Tool } from '../../src/tools/types/Tool';
import {
  PluginHostSupervisor,
  type PluginHostToolRegistryPort,
  type PluginToolAuditRecord,
} from '../../src/plugins/host/PluginHostSupervisor';
import {
  PLUGIN_HOST_EVENT,
  PLUGIN_HOST_METHOD,
} from '../../src/plugins/host/pluginHostProtocol';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  decodeFrame,
  encodeFrame,
} from '../../src/utils/sidecarIpc';

const pluginId = 'p1';
const target = {
  pluginId,
  pluginDir: '/plugins/p1',
  entryPath: '/plugins/p1/index.js',
};

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const asChild = (c: FakeChild): ChildProcess => c as unknown as ChildProcess;
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean,
  timeoutMs = 1500,
  stepMs = 5
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const line = (frame: Record<string, unknown>): string => encodeFrame(frame);

const startupLine = (pid = 1): string =>
  line({
    type: SIDECAR_STARTUP_TYPE,
    protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
    pid,
  });

function frames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => decodeFrame(l))
    .filter((f): f is Record<string, unknown> => f !== null);
}

/** 注入用的工具登记表替身（不污染全局 ToolRegistry） */
function fakeRegistry(): PluginHostToolRegistryPort & {
  tools: Map<string, Tool>;
} {
  const tools = new Map<string, Tool>();
  return {
    tools,
    registerTool(tool, options) {
      if (tools.has(tool.name) && options?.onConflict === 'error') {
        throw new Error(`Tool already registered: ${tool.name}`);
      }
      tools.set(tool.name, tool);
    },
    unregisterTool(name) {
      tools.delete(name);
    },
  };
}

const declareEcho = (): string =>
  line({
    type: 'notify',
    event: PLUGIN_HOST_EVENT.TOOLS_REGISTER,
    data: {
      tools: [{ name: 'echo', description: 'E', parameters: { text: {} } }],
    },
  });

describe('T25-08 P1 · 握手 + env 白名单 + 工具代理 + 审计', () => {
  it('启动 env 不含宿主密钥；声明后注册代理；执行走 RPC 并留审计', async () => {
    const child = new FakeChild();
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    const registry = fakeRegistry();
    const audits: PluginToolAuditRecord[] = [];
    let spawnEnv: Record<string, string> = {};

    const sup = new PluginHostSupervisor(target, {
      spawnFn: (_cmd, _args, opts) => {
        spawnEnv = (opts['env'] ?? {}) as Record<string, string>;
        return asChild(child);
      },
      registry,
      onToolAudit: (r) => audits.push(r),
      baseEnv: { PATH: '/bin', OPENAI_API_KEY: 'sk-host-secret' },
      requestTimeoutMs: 2000,
    });

    const startP = sup.start();
    child.stdout.write(declareEcho());
    child.stdout.write(startupLine(123));
    await expect(startP).resolves.toMatchObject({ pid: 123 });

    expect(spawnEnv['OPENAI_API_KEY']).toBeUndefined();
    expect(spawnEnv['PATH']).toBe('/bin');
    expect(sup.getRegisteredToolNames()).toEqual(['echo']);

    const tool = registry.tools.get('echo')!;
    const execP = tool.execute({ text: 'hi' }, {} as never);
    await waitFor(() =>
      frames(chunks).some((f) => f.method === PLUGIN_HOST_METHOD.TOOL_EXECUTE)
    );
    const req = frames(chunks).find(
      (f) => f.method === PLUGIN_HOST_METHOD.TOOL_EXECUTE
    )!;
    expect((req.params as Record<string, unknown>)['name']).toBe('echo');
    expect((req.params as Record<string, unknown>)['input']).toEqual({
      text: 'hi',
    });

    child.stdout.write(
      line({ id: req.id, success: true, result: { echoed: 'hi' } })
    );
    const result = (await execP) as { data: unknown };
    expect(result.data).toEqual({ echoed: 'hi' });

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      pluginId,
      toolName: 'echo',
      ok: true,
    });
    sup.stop();
  });

  it('RPC 失败 ⇒ 代理工具抛错且审计记 ok:false', async () => {
    const child = new FakeChild();
    const chunks: Buffer[] = [];
    child.stdin.on('data', (c: Buffer) => chunks.push(c));
    const registry = fakeRegistry();
    const audits: PluginToolAuditRecord[] = [];

    const sup = new PluginHostSupervisor(target, {
      spawnFn: () => asChild(child),
      registry,
      onToolAudit: (r) => audits.push(r),
      requestTimeoutMs: 2000,
    });
    const startP = sup.start();
    child.stdout.write(declareEcho());
    child.stdout.write(startupLine());
    await startP;

    const execP = registry.tools.get('echo')!.execute({}, {} as never);
    await waitFor(() =>
      frames(chunks).some((f) => f.method === PLUGIN_HOST_METHOD.TOOL_EXECUTE)
    );
    const req = frames(chunks).find(
      (f) => f.method === PLUGIN_HOST_METHOD.TOOL_EXECUTE
    )!;
    child.stdout.write(
      line({ id: req.id, success: false, error: { message: 'handler boom' } })
    );

    await expect(execP).rejects.toThrow('handler boom');
    expect(audits[0]).toMatchObject({ ok: false, error: 'handler boom' });
    sup.stop();
  });
});

describe('T25-08 P1 · 崩溃结算 + 有界重启', () => {
  it('崩溃 ⇒ 在飞请求全拒、代理工具下线；重启后重新声明即可用', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    let calls = 0;
    const registry = fakeRegistry();
    const firstChunks: Buffer[] = [];
    const secondChunks: Buffer[] = [];
    first.stdin.on('data', (c: Buffer) => firstChunks.push(c));
    second.stdin.on('data', (c: Buffer) => secondChunks.push(c));

    const sup = new PluginHostSupervisor(target, {
      spawnFn: () => asChild(++calls === 1 ? first : second),
      registry,
      maxRestarts: 2,
      requestTimeoutMs: 5000,
      startupTimeoutMs: 5000,
    });

    const startP = sup.start();
    first.stdout.write(declareEcho());
    first.stdout.write(startupLine());
    await startP;
    expect(sup.getRegisteredToolNames()).toEqual(['echo']);

    const inflight = sup.request(PLUGIN_HOST_METHOD.TOOL_EXECUTE, {
      name: 'echo',
    });
    await waitFor(() => frames(firstChunks).length > 0);

    first.emit('exit', 1);
    await expect(inflight).rejects.toThrow('插件子进程已退出');
    expect(sup.getRegisteredToolNames()).toEqual([]); // 工具已下线
    expect(registry.tools.size).toBe(0);

    // 有界重启：第二个子进程握手 + 重新声明
    await tick(20);
    expect(calls).toBe(2);
    second.stdout.write(declareEcho());
    second.stdout.write(startupLine());
    await waitFor(() => sup.isRunning());
    await waitFor(() => sup.getRegisteredToolNames().length === 1);
    expect(sup.getRestarts()).toBe(1);
    expect(registry.tools.has('echo')).toBe(true);
    sup.stop();
  });

  it('重启超限 ⇒ fail-closed（后续请求直接拒绝，不再等待）', async () => {
    const child = new FakeChild();
    const sup = new PluginHostSupervisor(target, {
      spawnFn: () => asChild(child),
      registry: fakeRegistry(),
      maxRestarts: 0,
      requestTimeoutMs: 500,
      startupTimeoutMs: 500,
    });
    const startP = sup.start();
    child.stdout.write(startupLine());
    await startP;

    child.emit('exit', 0);
    await expect(sup.request(PLUGIN_HOST_METHOD.LIFECYCLE, {})).rejects.toThrow(
      '不可用'
    );
    sup.stop();
  });

  it('子进程报 start.failed ⇒ start() 立刻失败（不等超时）', async () => {
    const child = new FakeChild();
    const sup = new PluginHostSupervisor(target, {
      spawnFn: () => asChild(child),
      registry: fakeRegistry(),
      startupTimeoutMs: 5000,
    });
    const startP = sup.start();
    child.stdout.write(
      line({
        type: 'notify',
        event: PLUGIN_HOST_EVENT.START_FAILED,
        data: { message: 'import 失败' },
      })
    );
    await expect(startP).rejects.toThrow('import 失败');
    sup.stop();
  });
});

describe('T25-08 P1 · 关停', () => {
  it('stop() ⇒ 进程树强杀 + 代理工具注销 + 未决请求结算', async () => {
    const child = new FakeChild();
    const registry = fakeRegistry();
    let killed = 0;
    const sup = new PluginHostSupervisor(target, {
      spawnFn: () => asChild(child),
      registry,
      killTree: () => {
        killed += 1;
      },
      requestTimeoutMs: 5000,
    });
    const startP = sup.start();
    child.stdout.write(declareEcho());
    child.stdout.write(startupLine());
    await startP;

    const inflight = sup.request(PLUGIN_HOST_METHOD.TOOL_EXECUTE, {
      name: 'echo',
    });
    sup.stop();

    await expect(inflight).rejects.toThrow('已停止');
    expect(killed).toBe(1);
    expect(registry.tools.size).toBe(0);
    expect(sup.isRunning()).toBe(false);
  });
});
