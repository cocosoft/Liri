// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P1（2026-10-25）：**加载器 → 子进程宿主**的整链集成（不止监督器单测）。
//
// 覆盖接线而非组件：
// - `PluginLoader.loadPlugin` 走宿主（真 spawn）⇒ 工具注册进全局 ToolRegistry；
// - 插件读 `process.env` 拿不到宿主密钥（env 白名单在真实链路上生效）；
// - `unloadPlugin` 优雅关停 ⇒ 代理工具注销、插件状态回到 UNLOADED。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginLoader } from '../../src/plugins/core/PluginLoader';
import { PluginState } from '../../src/plugins/types/PluginTypes';
import { getToolRegistry } from '../../src/tools/ToolRegistry';

const PLUGIN_ID = 'wired-probe';
const TOOL_NAME = 'wired_probe';

const PLUGIN_ENTRY = `
export default {
  name: 'wired-probe',
  version: '1.0.0',
  async activate() {},
  async destroy() {},
  tools: [
    {
      name: '${TOOL_NAME}',
      description: 'probe',
      parameters: {},
      execute: async () => ({ leaked: process.env.LIRI_WIRING_SECRET ?? null }),
    },
  ],
};
`;

const saved: Record<string, string | undefined> = {};
const temps: string[] = [];
const loaders: PluginLoader[] = [];
const ENV_TRUSTED = 'LIRI_PLUGIN_TRUSTED_IDS';
const ENV_GRANTS = 'LIRI_PLUGIN_CAPABILITY_GRANTS';

beforeEach(() => {
  for (const key of [ENV_TRUSTED, ENV_GRANTS, 'LIRI_WIRING_SECRET']) {
    saved[key] = process.env[key];
  }
  delete process.env[ENV_GRANTS];
  process.env['LIRI_WIRING_SECRET'] = 'must-not-cross-process';
});

afterEach(async () => {
  for (const loader of loaders.splice(0)) {
    try {
      await loader.unloadPlugin(PLUGIN_ID);
    } catch {
      // 已卸载 / 未加载
    }
    await loader.destroy();
  }
  try {
    getToolRegistry().unregisterTool(TOOL_NAME);
  } catch {
    // 未注册
  }
  for (const key of [ENV_TRUSTED, ENV_GRANTS, 'LIRI_WIRING_SECRET']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

describe('T25-08 P1 · 加载器 → 宿主整链', () => {
  it('loadPlugin 走子进程宿主：工具可经 RPC 调用、env 不透传、卸载后注销', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-host-wiring-'));
    temps.push(root);
    const pluginDir = join(root, PLUGIN_ID);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: PLUGIN_ID,
        name: PLUGIN_ID,
        version: '1.0.0',
        description: 'wiring probe',
        entryPoint: 'index.mjs',
        capabilities: ['tools'],
      }),
      'utf8'
    );
    writeFileSync(join(pluginDir, 'index.mjs'), PLUGIN_ENTRY, 'utf8');
    process.env[ENV_TRUSTED] = PLUGIN_ID;

    const loader = new PluginLoader({
      pluginDirectories: [root],
      autoLoad: false,
    });
    loaders.push(loader);
    await loader.initialize();

    const loaded = await loader.loadPlugin(PLUGIN_ID);
    expect(loaded.success).toBe(true);
    expect(loader.getPlugin(PLUGIN_ID)?.state).toBe(PluginState.LOADED);
    // 宿主路径：不在主进程内 import，因此没有 instance
    expect(loader.getPlugin(PLUGIN_ID)?.instance).toBeUndefined();

    const tool = getToolRegistry().getTool(TOOL_NAME);
    expect(tool).toBeDefined();
    const result = (await tool!.execute({}, {} as never)) as {
      data: Record<string, unknown>;
    };
    expect(result.data).toMatchObject({ leaked: null });

    const unloaded = await loader.unloadPlugin(PLUGIN_ID);
    expect(unloaded.success).toBe(true);
    expect(loader.getPlugin(PLUGIN_ID)?.state).toBe(PluginState.UNLOADED);
    expect(getToolRegistry().getTool(TOOL_NAME)).toBeUndefined();
  }, 60_000);
});
