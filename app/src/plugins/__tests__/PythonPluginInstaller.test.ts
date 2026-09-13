/**
 * PythonPluginInstaller 测试（PY-6）
 * 覆盖：venv 创建、plugin.json 桥接清单生成、幂等跳过、无 entry.python 报错
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  installPythonPlugin,
  uninstallPythonPlugin,
  findBlacklistedRequirements,
} from '../install/PythonPluginInstaller';

const tmpDir = mkdtempSync(join(tmpdir(), 'py-install-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('PythonPluginInstaller（PY-6）', () => {
  test('安装：创建 venv + 生成 plugin.json 桥接清单', async () => {
    const pluginDir = join(tmpDir, 'hello-python');
    const result = await installPythonPlugin(
      pluginDir,
      {
        id: 'hello-python',
        name: 'Hello Python',
        version: '0.1.0',
        description: '测试',
        author: 'demo',
        entry: { python: 'main.py' },
      },
      'python'
    );

    expect(result.success).toBe(true);
    // venv 解释器存在
    expect(existsSync(result.venvPythonPath!)).toBe(true);

    // 桥接清单生成（扁平格式，PluginLoader 可发现）
    const bridgePath = join(pluginDir, 'plugin.json');
    expect(existsSync(bridgePath)).toBe(true);
    const bridge = JSON.parse(readFileSync(bridgePath, 'utf-8'));
    expect(bridge.id).toBe('hello-python');
    expect(bridge.type).toBe('python');
    expect(bridge.entry.python).toBe('main.py');

    uninstallPythonPlugin(pluginDir);
  }, 30000); // venv + pip 为外部进程，5s 默认超时在全量并发下不够

  test('幂等：已存在 entry.python 桥接清单时跳过重新安装', async () => {
    const pluginDir = join(tmpDir, 'idempotent');
    const first = await installPythonPlugin(
      pluginDir,
      {
        id: 'idem',
        name: 'Idem',
        version: '0.1.0',
        entry: { python: 'main.py' },
      },
      'python'
    );
    expect(first.success).toBe(true);

    // 修改桥接清单内容，验证二次调用不覆盖
    const bridgePath = join(pluginDir, 'plugin.json');
    const bridge = JSON.parse(readFileSync(bridgePath, 'utf-8'));
    bridge.id = 'modified';
    require('fs').writeFileSync(bridgePath, JSON.stringify(bridge), 'utf-8');

    const second = await installPythonPlugin(
      pluginDir,
      {
        id: 'idem',
        name: 'Idem',
        version: '0.1.0',
        entry: { python: 'main.py' },
      },
      'python'
    );
    expect(second.success).toBe(true);
    const after = JSON.parse(readFileSync(bridgePath, 'utf-8'));
    expect(after.id).toBe('modified'); // 未被覆盖

    uninstallPythonPlugin(pluginDir);
  }, 30000); // 两次安装（venv + pip）耗时更长

  test('无 entry.python → 返回错误', async () => {
    const result = await installPythonPlugin(
      join(tmpDir, 'no-python'),
      { id: 'x', name: 'X', version: '0.1.0' },
      'python'
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/entry\.python/);
  });

  test('白名单：识别二进制包（含版本约束形式），纯 Python 包不误报', () => {
    expect(
      findBlacklistedRequirements([
        'numpy',
        'requests',
        'pandas>=2.0',
        'pydantic==2.5',
      ])
    ).toEqual(['numpy', 'pandas', 'pydantic']);
    expect(findBlacklistedRequirements(['requests', 'httpx'])).toEqual([]);
  });

  test('白名单：requirements 含二进制包时拒绝安装', async () => {
    const pluginDir = join(tmpDir, 'blacklisted');
    const result = await installPythonPlugin(
      pluginDir,
      {
        id: 'bl',
        name: 'BL',
        version: '0.1.0',
        entry: { python: 'main.py' },
        requirements: ['numpy'],
      },
      'python'
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/二进制包|拒绝/);
    // venv 已回滚
    expect(existsSync(join(pluginDir, '.venv'))).toBe(false);
  }, 30000); // venv 创建 + 回滚
});
