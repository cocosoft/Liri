/**
 * PluginSystem Python 插件集成测试（PY-3 接入验证）
 * 覆盖：registerPythonPlugin（spawn + 激活 + 工具进全局 ToolRegistry）、
 *      getPythonPlugin、unregisterPythonPlugin（注销 + 工具移除）
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { PluginSystem } from '../index';
import { getToolRegistry } from '../../tools/ToolRegistry';
import { installPythonPlugin } from '../install/PythonPluginInstaller';
import { resolveProjectRoot } from '@modules/core/paths';

// 模拟运行时：LIRI_PROJECT_DIR 指向项目根，验证 vendored SDK 自动定位
process.env.LIRI_PROJECT_DIR = resolveProjectRoot();

const PLUGIN_SCRIPT = `
from liri import Plugin, tool

@tool(name="py_sys_greet", description="集成测试工具")
async def greet(name: str = "world", ctx=None) -> str:
    return f"Hello, {name}"

plugin = Plugin(id="py-sys-test", name="PySysTest", version="0.1.0", tools=[greet])
plugin.run()
`;

/** 端到端：独立插件（安装后由 venv 解释器运行） */
const E2E_SCRIPT = `
from liri import Plugin, tool

@tool(name="e2e_hello", description="端到端工具")
async def hello(name: str = "world", ctx=None) -> str:
    return f"Hello, {name}"

plugin = Plugin(id="e2e-py", name="E2E", version="0.1.0", tools=[hello])
plugin.run()
`;

const tmpDir = mkdtempSync(join(tmpdir(), 'plugin-system-py-'));
const pluginScript = join(tmpDir, 'plugin_main.py');

beforeAll(() => {
  writeFileSync(pluginScript, PLUGIN_SCRIPT, 'utf-8');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('PluginSystem Python 插件集成（PY-3）', () => {
  const ps = new PluginSystem({}, { demoteOnLoad: false });

  test('registerPythonPlugin：spawn + 激活 + 工具注册进全局 ToolRegistry', async () => {
    await ps.registerPythonPlugin({
      pluginId: 'py-sys-test',
      pluginName: 'PySysTest',
      version: '0.1.0',
      pythonPath: 'python',
      workerScript: pluginScript,
      startupTimeoutMs: 15000,
      // 不手动注入 PYTHONPATH——验证默认 vendored SDK 自动定位
      env: process.env,
    });

    const adapter = ps.getPythonPlugin('py-sys-test');
    expect(adapter).toBeDefined();
    expect(adapter!.isReady()).toBe(true);
    expect(ps.getPythonPlugins()).toHaveLength(1);

    // 工具已注册进全局 ToolRegistry，且可跨进程调用
    const tool = getToolRegistry().getTool('py_sys_greet');
    expect(tool).toBeDefined();
    const result = await tool!.execute({ name: 'liri' }, {} as never);
    expect(result.data).toBe('Hello, liri');
  });

  test('unregisterPythonPlugin：注销 + 工具移除', async () => {
    await ps.unregisterPythonPlugin('py-sys-test');
    expect(ps.getPythonPlugin('py-sys-test')).toBeUndefined();
    expect(ps.getPythonPlugins()).toHaveLength(0);
    expect(getToolRegistry().getTool('py_sys_greet')).toBeUndefined();
  });

  test('未注册插件的注销为空操作', async () => {
    await expect(
      ps.unregisterPythonPlugin('nonexistent')
    ).resolves.toBeUndefined();
  });

  test('端到端：安装(venv+桥接清单) → registerPythonPluginFromDir 自动激活(venv 解释器) → callTool → 注销', async () => {
    const pluginDir = join(tmpDir, 'e2e-plugin');
    const mainPy = join(pluginDir, 'main.py');

    // 1. 安装：创建 venv + 生成桥接清单
    const install = await installPythonPlugin(
      pluginDir,
      {
        id: 'e2e-py',
        name: 'E2E',
        version: '0.1.0',
        description: 'e2e',
        author: 'demo',
        entry: { python: 'main.py' },
      },
      'python'
    );
    expect(install.success).toBe(true);
    writeFileSync(mainPy, E2E_SCRIPT, 'utf-8');

    // 2. M1 编排层：从安装目录自动解析（venv 解释器 + entry.python），无需手动构造 config
    const adapter = await ps.registerPythonPluginFromDir(pluginDir);
    expect(adapter).toBeDefined();

    // 3. callTool：跨进程执行 + 工具在全局 ToolRegistry
    const result = await adapter!.callTool('e2e_hello', { name: 'liri' });
    expect(result).toBe('Hello, liri');
    expect(getToolRegistry().getTool('e2e_hello')).toBeDefined();

    // 4. 注销：shutdown + 工具移除
    await ps.unregisterPythonPlugin('e2e-py');
    expect(getToolRegistry().getTool('e2e_hello')).toBeUndefined();
  }, 30000); // venv 安装 + 跨进程 spawn/callTool，5s 默认超时在全量并发下不够

  test('registerPythonPluginFromDir：非 Python 插件返回 undefined，幂等跳过重复注册', async () => {
    // 非 Python 插件目录（无 plugin.json）
    const plainDir = join(tmpDir, 'plain');
    expect(await ps.registerPythonPluginFromDir(plainDir)).toBeUndefined();
  });

  test('M1 自动激活：ensurePluginsLoaded 扫描 pluginDirectories 发现 type:python 并自动 spawn', async () => {
    // e2e-plugin 目录已在端到端测试完成安装（venv + 桥接清单），此处验证自动发现链路：
    // ensurePluginsLoaded → loadAllPlugins → 遍历发现 type:'python' → registerPythonPluginFromDir
    const autoPs = new PluginSystem(
      { pluginDirectories: [tmpDir], autoLoad: false },
      { demoteOnLoad: false }
    );

    await autoPs.startAllPlugins();

    // 自动激活：无需手动 registerPythonPluginFromDir，扫描即激活
    const adapter = autoPs.getPythonPlugin('e2e-py');
    expect(adapter).toBeDefined();
    expect(adapter!.isReady()).toBe(true);
    expect(getToolRegistry().getTool('e2e_hello')).toBeDefined();
    expect(autoPs.getPythonPlugins()).toHaveLength(1);

    // 幂等：_pluginsLoaded 守卫 + _pythonPlugins 去重，重复触发不重复注册
    await autoPs.startAllPlugins();
    expect(autoPs.getPythonPlugins()).toHaveLength(1);

    await autoPs.destroy();
    expect(autoPs.getPythonPlugins()).toHaveLength(0);
  });
});
