// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P1（2026-10-25）：子进程入口 `pluginHostEntry` 的进程内单测
// （注入流 + 注入模块加载器 ⇒ 不真起进程，覆盖握手顺序 / 工具 RPC / 启动失败）。
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  startPluginHostChild,
  type PluginHostChildHandle,
} from '../../src/plugins/host/pluginHostEntry';
import {
  PLUGIN_HOST_ENV_DIR,
  PLUGIN_HOST_ENV_ENTRY,
  PLUGIN_HOST_ENV_ID,
  PLUGIN_HOST_EVENT,
  PLUGIN_HOST_METHOD,
} from '../../src/plugins/host/pluginHostProtocol';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  decodeFrame,
  encodeFrame,
} from '../../src/utils/sidecarIpc';

const env = {
  [PLUGIN_HOST_ENV_ID]: 'p1',
  [PLUGIN_HOST_ENV_DIR]: '/plugins/p1',
  [PLUGIN_HOST_ENV_ENTRY]: '/plugins/p1/index.js',
};

function frames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => decodeFrame(l))
    .filter((f): f is Record<string, unknown> => f !== null);
}

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

function harness(importEntry: (p: string) => Promise<unknown>): {
  input: PassThrough;
  chunks: Buffer[];
  handle: PluginHostChildHandle;
  shutdowns: () => number;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  let shutdownCount = 0;
  const handle = startPluginHostChild({
    input,
    output,
    env,

    importEntry,
    onShutdown: () => {
      shutdownCount += 1;
    },
  });
  return { input, chunks, handle, shutdowns: () => shutdownCount };
}

describe('T25-08 P1 · 子进程入口', () => {
  const calls: string[] = [];
  const fakeModule = {
    default: {
      name: 'demo',
      version: '1.0.0',
      async initialize() {
        calls.push('initialize');
      },
      async activate() {
        calls.push('activate');
      },
      async deactivate() {
        calls.push('deactivate');
      },
      tools: [
        {
          name: 'demo_echo',
          description: 'echo',
          parameters: {},
          execute: (input: Record<string, unknown>) => ({ echoed: input }),
        },
      ],
    },
  };

  it('生命周期 → 工具声明 → startup（顺序保证 start() 即"可用"）', async () => {
    calls.length = 0;
    const h = harness(async () => fakeModule);
    await waitFor(() =>
      frames(h.chunks).some((f) => f.type === SIDECAR_STARTUP_TYPE)
    );

    expect(calls).toEqual(['initialize', 'activate']);
    const out = frames(h.chunks);
    const declareAt = out.findIndex(
      (f) => f.event === PLUGIN_HOST_EVENT.TOOLS_REGISTER
    );
    const startupAt = out.findIndex((f) => f.type === SIDECAR_STARTUP_TYPE);
    expect(declareAt).toBeGreaterThan(-1);
    expect(startupAt).toBeGreaterThan(declareAt);

    const startup = out[startupAt]!;
    expect(startup.protocolVersion).toBe(SIDECAR_IPC_PROTOCOL_VERSION);

    const declared = out[declareAt]!;
    const tools = (declared.data as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(['demo_echo']);
    // 声明里**不含** handler（handler 留在子进程）
    expect(
      (tools[0] as unknown as Record<string, unknown>)['execute']
    ).toBeUndefined();

    h.handle.stop();
  });

  it('tool.execute 经 RPC 回结果；未知工具 ⇒ success:false', async () => {
    calls.length = 0;
    const h = harness(async () => fakeModule);
    await waitFor(() =>
      frames(h.chunks).some((f) => f.type === SIDECAR_STARTUP_TYPE)
    );

    h.input.write(
      encodeFrame({
        id: 'r1',
        method: PLUGIN_HOST_METHOD.TOOL_EXECUTE,
        params: { name: 'demo_echo', input: { a: 1 } },
      })
    );
    h.input.write(
      encodeFrame({
        id: 'r2',
        method: PLUGIN_HOST_METHOD.TOOL_EXECUTE,
        params: { name: 'nope' },
      })
    );
    await waitFor(() => frames(h.chunks).some((f) => f.id === 'r2'));

    const r1 = frames(h.chunks).find((f) => f.id === 'r1')!;
    expect(r1.success).toBe(true);
    expect(r1.result).toEqual({ echoed: { a: 1 } });

    const r2 = frames(h.chunks).find((f) => f.id === 'r2')!;
    expect(r2.success).toBe(false);
    expect(String((r2.error as { message?: string }).message)).toContain(
      '未声明工具'
    );

    h.handle.stop();
  });

  it('plugin.shutdown ⇒ 执行 destroy 并触发自退回调', async () => {
    calls.length = 0;
    const mod = {
      default: {
        ...fakeModule.default,
        async destroy() {
          calls.push('destroy');
        },
      },
    };
    const h = harness(async () => mod);
    await waitFor(() =>
      frames(h.chunks).some((f) => f.type === SIDECAR_STARTUP_TYPE)
    );

    h.input.write(
      encodeFrame({ id: 's1', method: PLUGIN_HOST_METHOD.SHUTDOWN, params: {} })
    );
    await waitFor(() => h.shutdowns() === 1);

    expect(calls).toContain('destroy');
    const res = frames(h.chunks).find((f) => f.id === 's1')!;
    expect(res.success).toBe(true);
  });

  it('导入失败 ⇒ 发 start.failed（宿主不必等超时）', async () => {
    const h = harness(async () => {
      throw new Error('entry import boom');
    });
    await waitFor(() =>
      frames(h.chunks).some((f) => f.event === PLUGIN_HOST_EVENT.START_FAILED)
    );
    const failed = frames(h.chunks).find(
      (f) => f.event === PLUGIN_HOST_EVENT.START_FAILED
    )!;
    expect(String((failed.data as { message?: string }).message)).toContain(
      'entry import boom'
    );
    expect(frames(h.chunks).some((f) => f.type === SIDECAR_STARTUP_TYPE)).toBe(
      false
    );
    h.handle.stop();
  });

  it('缺 env ⇒ 直接 start.failed（fail-closed，不猜目标）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    const handle = startPluginHostChild({
      input,
      output,
      env: {},

      importEntry: async () => ({}),
    });
    await waitFor(() =>
      frames(chunks).some((f) => f.event === PLUGIN_HOST_EVENT.START_FAILED)
    );
    expect(
      frames(chunks).some((f) => f.event === PLUGIN_HOST_EVENT.START_FAILED)
    ).toBe(true);
    handle.stop();
  });
});
