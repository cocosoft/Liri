// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2 · `config` 能力（2026-10-25）：协议纯函数 + 宿主写入闸 + 子进程 API。
//
// 锁四件事：
//  ① 配置快照只走 env，且**未授权时不下发**（子进程退回 no-op）；
//  ② 子进程 → 宿主 的请求与「回包」可区分（前缀 + method），不会把回包当请求；
//  ③ 宿主对 `config.set`：未授权 / 参数非法 / **端口拒绝** 一律回 `success:false`（不静默成功）；
//  ④ 子进程 `set()` 排队、`save()` flush：失败在 `save()` 抛出，成功后才更新本地快照视角。
import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import {
  PLUGIN_HOST_CHILD_ID_PREFIX,
  PLUGIN_HOST_CHILD_METHOD,
  PLUGIN_HOST_ENV_CONFIG,
  PLUGIN_HOST_ENV_DIR,
  PLUGIN_HOST_ENV_ENTRY,
  PLUGIN_HOST_ENV_ID,
  buildPluginHostChildRequest,
  buildPluginHostEnv,
  isPluginHostChildRequest,
  parseChildConfigSet,
  readPluginConfigSnapshot,
} from '../../src/plugins/host/pluginHostProtocol';
import {
  pluginConfigPortFromManager,
  type PluginConfigManagerLike,
} from '../../src/plugins/host/pluginConfigPort';
import { PluginHostSupervisor } from '../../src/plugins/host/PluginHostSupervisor';
import { startPluginHostChild } from '../../src/plugins/host/pluginHostEntry';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  decodeFrame,
  encodeFrame,
} from '../../src/utils/sidecarIpc';
import type { PluginContext } from '../../src/plugin-sdk/types';

const pluginId = 'cfg1';
const target = {
  pluginId,
  pluginDir: '/plugins/cfg1',
  entryPath: '/plugins/cfg1/index.js',
};

const baseEnvForChild = (
  config?: Record<string, unknown>
): NodeJS.ProcessEnv => ({
  [PLUGIN_HOST_ENV_ID]: pluginId,
  [PLUGIN_HOST_ENV_DIR]: target.pluginDir,
  [PLUGIN_HOST_ENV_ENTRY]: target.entryPath,
  ...(config ? { [PLUGIN_HOST_ENV_CONFIG]: JSON.stringify(config) } : {}),
});

function collect(stream: PassThrough): () => Array<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  return () =>
    Buffer.concat(chunks)
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

function fakeManager(): PluginConfigManagerLike & {
  written: Array<{ pluginId: string; key: string; value: unknown }>;
} {
  const store: Record<string, Record<string, unknown>> = {
    [pluginId]: { theme: 'dark' },
  };
  const written: Array<{ pluginId: string; key: string; value: unknown }> = [];
  return {
    written,
    getConfig(id) {
      return { ...(store[id] ?? {}) };
    },
    setConfigValue(id, key, value) {
      written.push({ pluginId: id, key, value });
      store[id] = { ...(store[id] ?? {}), [key]: value };
    },
  };
}

describe('config 快照：只走 env，未授权不下发', () => {
  it('有 config ⇒ 注入 JSON；无 ⇒ 键不出现（不是 "{}"）', () => {
    const withConfig = buildPluginHostEnv(
      {},
      { ...target, config: { theme: 'dark', n: 1 } }
    );
    expect(JSON.parse(withConfig[PLUGIN_HOST_ENV_CONFIG]!)).toEqual({
      theme: 'dark',
      n: 1,
    });

    const without = buildPluginHostEnv({}, { ...target });
    expect(PLUGIN_HOST_ENV_CONFIG in without).toBe(false);
  });

  it('readPluginConfigSnapshot：合法对象 ⇒ 读出；缺失/非法/数组 ⇒ null（不臆造空配置）', () => {
    expect(readPluginConfigSnapshot(baseEnvForChild({ a: 1 }))).toEqual({
      a: 1,
    });
    expect(readPluginConfigSnapshot(baseEnvForChild())).toBeNull();
    expect(
      readPluginConfigSnapshot({
        [PLUGIN_HOST_ENV_CONFIG]: 'not-json{',
      })
    ).toBeNull();
    expect(
      readPluginConfigSnapshot({ [PLUGIN_HOST_ENV_CONFIG]: '[1,2]' })
    ).toBeNull();
  });
});

describe('子进程 → 宿主 请求的帧判别', () => {
  it('带前缀 + method ⇒ 判定为请求；回包（无 method）/ 无前缀 ⇒ 否', () => {
    const req = buildPluginHostChildRequest(
      3,
      PLUGIN_HOST_CHILD_METHOD.CONFIG_SET,
      {
        key: 'a',
        value: 1,
      }
    );
    expect(req.id).toBe(`${PLUGIN_HOST_CHILD_ID_PREFIX}3`);
    expect(isPluginHostChildRequest(req)).toBe(true);

    expect(isPluginHostChildRequest({ id: 'child_3', success: true })).toBe(
      false
    );
    expect(
      isPluginHostChildRequest({ id: 'pluginhost_1', method: 'tool.execute' })
    ).toBe(false);
  });

  it('parseChildConfigSet：value 允许 null；缺 key / 缺 value / 方法不符 ⇒ null', () => {
    const frame = (
      params: unknown,
      method: string = PLUGIN_HOST_CHILD_METHOD.CONFIG_SET
    ) => ({
      id: 'child_1',
      method,
      params,
    });
    expect(parseChildConfigSet(frame({ key: 'a', value: null }))).toEqual({
      key: 'a',
      value: null,
    });
    expect(parseChildConfigSet(frame({ value: 1 }))).toBeNull();
    expect(parseChildConfigSet(frame({ key: 'a' }))).toBeNull();
    expect(parseChildConfigSet(frame({ key: '', value: 1 }))).toBeNull();
    expect(
      parseChildConfigSet(frame({ key: 'a', value: 1 }, 'other'))
    ).toBeNull();
  });
});

describe('pluginConfigPortFromManager（复用既有 manager，按 id 收窄）', () => {
  it('read 返回该插件配置副本；write 落库并回 ok:true（宿主本层不做 schema 校验）', () => {
    const manager = fakeManager();
    const port = pluginConfigPortFromManager(manager);

    const snapshot = port.read(pluginId);
    expect(snapshot).toEqual({ theme: 'dark' });
    snapshot['theme'] = 'mutated';
    expect(port.read(pluginId)).toEqual({ theme: 'dark' });

    expect(port.write(pluginId, 'lang', 'zh')).toEqual({
      ok: true,
      errors: [],
    });
    expect(manager.written).toEqual([{ pluginId, key: 'lang', value: 'zh' }]);
  });
});

describe('宿主：快照注入与 config.set 处理', () => {
  async function startHost(options: {
    capabilities?: readonly string[];
    withPort?: boolean;
  }): Promise<{
    child: FakeChild;
    host: PluginHostSupervisor;
    spawnEnv: Record<string, string>;
  }> {
    const child = new FakeChild();
    const spawnEnv: Record<string, string> = {};
    const host = new PluginHostSupervisor(target, {
      spawnFn: (_cmd, _args, opts) => {
        Object.assign(spawnEnv, opts['env'] as Record<string, string>);
        return asChild(child);
      },
      capabilities: options.capabilities ?? [],
      configPort: options.withPort
        ? pluginConfigPortFromManager(fakeManager())
        : undefined,
      registry: {
        registerTool() {},
        unregisterTool() {},
      },
      killTree: () => {},
      startupTimeoutMs: 500,
    });
    const started = host.start();
    await waitFor(() => spawnEnv[PLUGIN_HOST_ENV_ID] === pluginId);
    child.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 7,
      })
    );
    await started;
    return { child, host, spawnEnv };
  }

  it('已授权 config ⇒ env 含快照；config.set ⇒ 写端口并回 success:true', async () => {
    const manager = fakeManager();
    const child = new FakeChild();
    const spawnEnv: Record<string, string> = {};
    const host = new PluginHostSupervisor(target, {
      spawnFn: (_c, _a, opts) => {
        Object.assign(spawnEnv, opts['env'] as Record<string, string>);
        return asChild(child);
      },
      capabilities: ['tools', 'config'],
      configPort: pluginConfigPortFromManager(manager),
      registry: { registerTool() {}, unregisterTool() {} },
      killTree: () => {},
      startupTimeoutMs: 500,
    });
    const started = host.start();
    await waitFor(() => spawnEnv[PLUGIN_HOST_ENV_ID] === pluginId);
    child.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 8,
      })
    );
    await started;

    expect(JSON.parse(spawnEnv[PLUGIN_HOST_ENV_CONFIG]!)).toEqual({
      theme: 'dark',
    });

    const readStdin = collect(child.stdin);
    child.stdout.write(
      encodeFrame(
        buildPluginHostChildRequest(1, PLUGIN_HOST_CHILD_METHOD.CONFIG_SET, {
          key: 'lang',
          value: 'zh',
        })
      )
    );
    await waitFor(() =>
      readStdin().some(
        (f) => f.id === `${PLUGIN_HOST_CHILD_ID_PREFIX}1` && f.success === true
      )
    );
    expect(manager.written).toEqual([{ pluginId, key: 'lang', value: 'zh' }]);
    host.stop();
  });

  it('未授权 config ⇒ env 无快照；config.set 回 success:false（不静默成功）', async () => {
    const { child, host, spawnEnv } = await startHost({
      capabilities: ['tools'],
      withPort: true,
    });
    expect(PLUGIN_HOST_ENV_CONFIG in spawnEnv).toBe(false);

    const readStdin = collect(child.stdin);
    child.stdout.write(
      encodeFrame(
        buildPluginHostChildRequest(1, PLUGIN_HOST_CHILD_METHOD.CONFIG_SET, {
          key: 'lang',
          value: 'zh',
        })
      )
    );
    await waitFor(() =>
      readStdin().some((f) => f.id === `${PLUGIN_HOST_CHILD_ID_PREFIX}1`)
    );
    const reply = readStdin().find(
      (f) => f.id === `${PLUGIN_HOST_CHILD_ID_PREFIX}1`
    )!;
    expect(reply.success).toBe(false);
    expect(String((reply.error as Record<string, unknown>).message)).toContain(
      '能力未授权'
    );
    host.stop();
  });

  it('端口拒绝 ⇒ 回 success:false 且带原因（端口契约；真实 manager 不拒绝）', async () => {
    const child = new FakeChild();
    const spawnEnv: Record<string, string> = {};
    const host = new PluginHostSupervisor(target, {
      spawnFn: (_c, _a, opts) => {
        Object.assign(spawnEnv, opts['env'] as Record<string, string>);
        return asChild(child);
      },
      capabilities: ['config'],
      // 直接注入「会拒绝」的端口：验证宿主对**端口契约**的处理
      // （真实 manager 不做 schema 校验 ⇒ 永不拒绝，见 `pluginConfigPort.ts`）
      configPort: {
        read: () => ({}),
        write: () => ({ ok: false, errors: ['拒绝写入'] }),
      },
      registry: { registerTool() {}, unregisterTool() {} },
      killTree: () => {},
      startupTimeoutMs: 500,
    });
    const started = host.start();
    await waitFor(() => spawnEnv[PLUGIN_HOST_ENV_ID] === pluginId);
    child.stdout.write(
      encodeFrame({
        type: SIDECAR_STARTUP_TYPE,
        protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
        pid: 9,
      })
    );
    await started;

    const readStdin = collect(child.stdin);
    child.stdout.write(
      encodeFrame(
        buildPluginHostChildRequest(2, PLUGIN_HOST_CHILD_METHOD.CONFIG_SET, {
          key: 'anyKey',
          value: 1,
        })
      )
    );
    await waitFor(() =>
      readStdin().some((f) => f.id === `${PLUGIN_HOST_CHILD_ID_PREFIX}2`)
    );
    const reply = readStdin().find(
      (f) => f.id === `${PLUGIN_HOST_CHILD_ID_PREFIX}2`
    )!;
    expect(reply.success).toBe(false);
    expect(String((reply.error as Record<string, unknown>).message)).toContain(
      '拒绝写入'
    );
    host.stop();
  });
});

describe('子进程侧 config API', () => {
  async function startChild(env: NodeJS.ProcessEnv): Promise<{
    ctx: PluginContext;
    input: PassThrough;
    readOut: () => Array<Record<string, unknown>>;
  }> {
    const input = new PassThrough();
    const output = new PassThrough();
    const readOut = collect(output);
    let ctx: PluginContext | null = null;
    startPluginHostChild({
      input,
      output,
      pid: 1,
      env,
      importEntry: async () => ({
        name: 'cfg plugin',
        version: '1.0.0',
        activate: (c: PluginContext) => {
          ctx = c;
        },
      }),
      onShutdown: () => {},
      hostRequestTimeoutMs: 800,
    });
    await waitFor(() => ctx !== null);
    return { ctx: ctx!, input, readOut };
  }

  it('get 读快照；set 不立即改本地视角；save 收到 success 后才生效', async () => {
    const { ctx, input, readOut } = await startChild(
      baseEnvForChild({ theme: 'dark' })
    );
    expect(ctx.config.get('theme', 'light')).toBe('dark');
    expect(ctx.config.get('missing', 'fallback')).toBe('fallback');

    ctx.config.set('theme', 'light');
    expect(ctx.config.get('theme', 'x')).toBe('dark'); // 未确认前不信本地写

    const saved = ctx.config.save();
    await waitFor(() =>
      readOut().some((f) => f.method === PLUGIN_HOST_CHILD_METHOD.CONFIG_SET)
    );
    const request = readOut().find(
      (f) => f.method === PLUGIN_HOST_CHILD_METHOD.CONFIG_SET
    )!;
    expect(request.params).toEqual({ key: 'theme', value: 'light' });

    input.write(
      encodeFrame({
        id: String(request.id),
        success: true,
        result: { ok: true },
      })
    );
    await saved;
    expect(ctx.config.get('theme', 'x')).toBe('light');
  });

  it('宿主拒绝 ⇒ save() 抛出原因（插件看得见失败）', async () => {
    const { ctx, input, readOut } = await startChild(
      baseEnvForChild({ theme: 'dark' })
    );
    ctx.config.set('theme', 'light');
    const saved = ctx.config.save();
    await waitFor(() =>
      readOut().some((f) => f.method === PLUGIN_HOST_CHILD_METHOD.CONFIG_SET)
    );
    const request = readOut().find(
      (f) => f.method === PLUGIN_HOST_CHILD_METHOD.CONFIG_SET
    )!;

    input.write(
      encodeFrame({
        id: String(request.id),
        success: false,
        error: { message: '能力未授权：config' },
      })
    );
    await expect(saved).rejects.toThrow(/能力未授权/);
    expect(ctx.config.get('theme', 'x')).toBe('dark'); // 失败不更新本地视角
  });

  it('无快照（未授权）⇒ no-op：get 回默认值，set/save 静默成功且不发 RPC', async () => {
    const { ctx, readOut } = await startChild(baseEnvForChild());
    expect(ctx.config.get('theme', 'default')).toBe('default');
    ctx.config.set('theme', 'x');
    await ctx.config.save();
    expect(
      readOut().some((f) => f.method === PLUGIN_HOST_CHILD_METHOD.CONFIG_SET)
    ).toBe(false);
  });
});
