// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 · config 收敛（2026-10-25）：**真链 E2E** —— 真实 spawn Python 子进程，
// 插件的 `ctx.config.get/set/save` 经反向 RPC 落到宿主侧共用配置端口。
//
// 为什么需要真链：迁移逻辑有单测，但"Python 侧 `_Config` → 反向 RPC → 适配器 → 端口"这条
// 接线只有真跑一遍才能证明（mock 掉子进程等于只测了自己写的那半边）。
// 无 Python 解释器时整组 skip（不伪造通过）。
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getKernelServiceRegistry } from '../../src/plugins/api/KernelServiceRegistry';
import { PythonPluginAdapter } from '../../src/plugins/core/PythonPluginAdapter';
import type { PluginConfigPort } from '../../src/plugins/host/pluginConfigPort';

const PLUGIN_ID = 'py-cfg-probe';
const WORKER_SCRIPT = join(
  import.meta.dir,
  '..',
  'fixtures',
  'plugins',
  'python-cfg-probe',
  'main.py'
);

/** 解析一个可用的 Python 解释器（绝对路径）；无则返回 null ⇒ 整组 skip */
function resolvePython(): string | null {
  const candidates = [process.env.LIRI_TEST_PYTHON, 'python', 'python3'].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
  for (const candidate of candidates) {
    const probe = spawnSync(
      candidate,
      ['-c', 'import sys;print(sys.executable)'],
      {
        encoding: 'utf8',
      }
    );
    if (probe.status === 0 && probe.stdout.trim() !== '') {
      return probe.stdout.trim();
    }
  }
  return null;
}

const PYTHON = resolvePython();
/**
 * `PYTHON_E2E_REQUIRE=1`（CI 设置）：找不到解释器 ⇒ **报红**，不允许静默 skip。
 * 与 `SANDBOX_NEGATIVE_REQUIRE=1` 同口径（环境不满足即失败，不把"没跑"当"通过"）。
 */
const REQUIRE_PYTHON = process.env['PYTHON_E2E_REQUIRE'] === '1';
const describeE2E = PYTHON ? describe : describe.skip;

if (!PYTHON && REQUIRE_PYTHON) {
  describe('Python 真链 E2E 前置（PYTHON_E2E_REQUIRE=1）', () => {
    it('必须存在可用的 Python 解释器（不允许静默 skip）', () => {
      throw new Error(
        'PYTHON_E2E_REQUIRE=1 但未找到 Python（已尝试 LIRI_TEST_PYTHON / python / python3）：' +
          '本 job 必须实际执行 Python 插件真链 E2E。'
      );
    });
  });
}

const savedDataDir = process.env['LIRI_DATA_DIR'];
const temps: string[] = [];

beforeEach(() => {
  // 隔离旧配置迁移路径（`<data>/plugin-config/`），避免读开发机真实数据
  process.env['LIRI_DATA_DIR'] = mkdtempSync(
    join(tmpdir(), 'liri-py-e2e-data-')
  );
  temps.push(process.env['LIRI_DATA_DIR']);
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env['LIRI_DATA_DIR'];
  else process.env['LIRI_DATA_DIR'] = savedDataDir;
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  }
});

/** 内存版共用端口（生产路径是 `PluginConfigManager`，此处只验证接线与读写） */
function memoryPort(
  initial: Record<string, unknown>
): PluginConfigPort & { store: Map<string, Record<string, unknown>> } {
  const store = new Map<string, Record<string, unknown>>([
    [PLUGIN_ID, { ...initial }],
  ]);
  return {
    store,
    read(pluginId) {
      return { ...(store.get(pluginId) ?? {}) };
    },
    write(pluginId, key, value) {
      store.set(pluginId, { ...(store.get(pluginId) ?? {}), [key]: value });
      return { ok: true, errors: [] };
    },
  };
}

describeE2E('Python 插件 config 真链（反向 RPC）', () => {
  it('ctx.config.get/set/save ⇒ 落到宿主侧共用端口', async () => {
    const port = memoryPort({ theme: 'light' });
    const adapter = new PythonPluginAdapter(
      {
        pluginId: PLUGIN_ID,
        pluginName: PLUGIN_ID,
        version: '1.0.0',
        pythonPath: PYTHON as string,
        workerScript: WORKER_SCRIPT,
        startupTimeoutMs: 20000,
        env: {
          PATH: process.env['PATH'] ?? '',
          SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
          TEMP: process.env['TEMP'] ?? '',
          TMP: process.env['TMP'] ?? '',
        },
        configPort: port,
      },
      getKernelServiceRegistry()
    );

    try {
      await adapter.initialize();
      await adapter.activate();
      const result = (await adapter.callTool('cfg_probe', {})) as {
        before: unknown;
        after: unknown;
      };
      // `before` 来自宿主（证明读走了反向 RPC）；`after` 是 Python 侧缓存（写成功才更新）
      expect(result).toEqual({ before: 'light', after: 'dark' });
      // 写入真实落到宿主端口（save 由宿主即时落盘，故无额外断言）
      expect(port.store.get(PLUGIN_ID)).toEqual({ theme: 'dark', lang: 'zh' });
    } finally {
      await adapter.destroy();
    }
  }, 30000);
});
