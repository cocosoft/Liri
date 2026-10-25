// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P1（2026-10-25）：**真实子进程**负向验收（spec §6 P1）。
//
// - 插件读 `process.env` 拿不到宿主密钥（env 白名单，不是"约定"）；
// - 插件崩溃不杀主进程，且被有界重启；
// - 插件工具调用经 RPC 回主进程执行（handler 在子进程）。
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Tool } from '../../src/tools/types/Tool';
import {
  PluginHostSupervisor,
  type PluginHostToolRegistryPort,
} from '../../src/plugins/host/PluginHostSupervisor';

/** 插件入口（纯 JS 语义；子进程真 `import` 它） */
const PLUGIN_ENTRY = `
export default {
  name: 'e2e-plugin',
  version: '1.0.0',
  async initialize() {},
  async activate() {},
  tools: [
    {
      name: 'e2e_env_probe',
      description: 'probe child env',
      parameters: {},
      execute: async () => ({
        leaked: process.env.LIRI_E2E_SECRET ?? null,
        hasPath: typeof process.env.PATH === 'string',
      }),
    },
  ],
};
`;

function fakeRegistry(): PluginHostToolRegistryPort & {
  tools: Map<string, Tool>;
} {
  const tools = new Map<string, Tool>();
  return {
    tools,
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    unregisterTool(name) {
      tools.delete(name);
    },
  };
}

async function waitFor(
  cond: () => boolean,
  timeoutMs = 15_000,
  stepMs = 20
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

const dirs: string[] = [];
const supervisors: PluginHostSupervisor[] = [];

afterEach(() => {
  for (const s of supervisors.splice(0)) s.stop();
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

describe('T25-08 P1 · 真实子进程', () => {
  it('插件读不到宿主密钥；工具经 RPC 执行；崩溃后被有界重启', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-plugin-host-'));
    dirs.push(dir);
    const entryPath = join(dir, 'index.mjs');
    writeFileSync(entryPath, PLUGIN_ENTRY, 'utf8');

    const registry = fakeRegistry();
    const children: ChildProcess[] = [];
    const sup = new PluginHostSupervisor(
      { pluginId: 'e2e-plugin', pluginDir: dir, entryPath },
      {
        spawnFn: (cmd, args, opts) => {
          const child = spawn(cmd, args, opts as never);
          children.push(child);
          return child;
        },
        registry,
        baseEnv: {
          PATH: process.env['PATH'],
          // 模拟宿主 .env：**不得**进入子进程
          LIRI_E2E_SECRET: 'top-secret-must-not-leak',
        },
        startupTimeoutMs: 20_000,
        requestTimeoutMs: 10_000,
        maxRestarts: 2,
      }
    );
    supervisors.push(sup);

    await sup.start();
    await waitFor(() => registry.tools.has('e2e_env_probe'));
    expect(registry.tools.has('e2e_env_probe')).toBe(true);

    // ① 负向：子进程 env 里没有宿主密钥
    const probe = (await registry.tools
      .get('e2e_env_probe')!
      .execute({}, {} as never)) as { data: Record<string, unknown> };
    expect(probe.data['leaked']).toBeNull();
    expect(probe.data['hasPath']).toBe(true);

    // ② 崩溃不杀主进程 + 有界重启
    const before = children.length;
    children[0]!.kill();
    await waitFor(() => children.length > before);
    expect(children.length).toBe(before + 1);
    await waitFor(() => sup.getRestarts() === 1);
    await waitFor(() => registry.tools.has('e2e_env_probe'));
    expect(sup.getRestarts()).toBe(1);
    expect(registry.tools.has('e2e_env_probe')).toBe(true);

    // ③ 重启后工具仍可用（新进程重新声明 + 重新注册）
    const again = (await registry.tools
      .get('e2e_env_probe')!
      .execute({}, {} as never)) as { data: Record<string, unknown> };
    expect(again.data['leaked']).toBeNull();
  }, 90_000);
});
