/**
 * PythonPluginAdapter 测试（PY-3）
 * 覆盖：initialize（spawn + 版本协商）、activate（工具注册进全局 ToolRegistry）、
 *      callTool（跨进程执行）、服务注入反向 RPC（injectService 白名单 + 方法调用）、
 *      destroy（注销工具）
 * 需要系统 Python（PYTHONPATH 注入 vendored SDK 目录）。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';
import {
  KernelServiceRegistry,
  KernelServiceId,
} from '../api/KernelServiceRegistry';
import { PythonPluginAdapter } from '../core/PythonPluginAdapter';
import { getToolRegistry } from '../../tools/ToolRegistry';
import { resolveProjectRoot } from '@modules/core/paths';

// 模拟运行时：LIRI_PROJECT_DIR 指向项目根，验证 vendored SDK 自动定位
const SAVED_LIRI_PROJECT_DIR = process.env.LIRI_PROJECT_DIR;
process.env.LIRI_PROJECT_DIR = resolveProjectRoot();

/** 插件脚本：greet 工具 + 服务注入工具 use_service + 崩溃工具 crash（import liri 依赖 PYTHONPATH 自动定位） */
const PLUGIN_SCRIPT = `
import sys
import os
from liri import Plugin, tool

@tool(name="greet", description="向用户打招呼")
async def greet(name: str, ctx=None) -> str:
    return f"Hello, {name}"

@tool(name="use_service", description="调用注入的服务")
async def use_service(ctx=None) -> str:
    svc = ctx.services.get("test_service")
    if svc is None:
        return "no-service"
    return await svc.greet("world")

@tool(name="crash", description="模拟进程崩溃")
async def crash(ctx=None) -> str:
    os._exit(1)

plugin = Plugin(
    id="py-test",
    name="PyTest",
    version="0.1.0",
    tools=[greet, use_service, crash],
    inject=["test_service"],
)
plugin.run()
`;

const tmpDir = mkdtempSync(join(tmpdir(), 'python-plugin-adapter-'));
const pluginScript = join(tmpDir, 'plugin_main.py');

beforeAll(() => {
  writeFileSync(pluginScript, PLUGIN_SCRIPT, 'utf-8');
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  // 还原模块级 env 修改，避免污染同进程其他测试文件
  if (SAVED_LIRI_PROJECT_DIR === undefined) {
    delete process.env.LIRI_PROJECT_DIR;
  } else {
    process.env.LIRI_PROJECT_DIR = SAVED_LIRI_PROJECT_DIR;
  }
});

describe('PythonPluginAdapter（PY-3）', () => {
  const registry = new KernelServiceRegistry();
  registry.register('test_service' as never, {
    greet: async (name: string) => `hi ${name}`,
  });

  const adapter = new PythonPluginAdapter(
    {
      pluginId: 'py-test',
      pluginName: 'PyTest',
      version: '0.1.0',
      pythonPath: 'python',
      workerScript: pluginScript,
      startupTimeoutMs: 15000,
      inject: ['test_service'],
      // 不手动注入 PYTHONPATH——验证 PythonPluginAdapter 默认 vendored SDK 自动定位
      env: process.env,
    },
    registry
  );

  test('initialize：spawn + startup 握手 + 协议版本协商', async () => {
    await adapter.initialize();
    expect(adapter.isReady()).toBe(true);
    expect(adapter.getState()).toBe('running');
  });

  test('activate：pull 工具并注册进全局 ToolRegistry', async () => {
    await adapter.activate();
    expect(adapter.getTools().map((t) => t.name)).toEqual([
      'greet',
      'use_service',
      'crash',
    ]);

    const tool = getToolRegistry().getTool('greet');
    expect(tool).toBeDefined();
    expect(tool!.getInfo().description).toBe('向用户打招呼');
  });

  test('callTool：跨进程执行 Python 工具', async () => {
    const result = await adapter.callTool('greet', { name: 'liri' });
    expect(result).toBe('Hello, liri');
  });

  test('服务注入反向 RPC：Python 侧代理调用内核服务方法', async () => {
    const result = await adapter.callTool('use_service', {});
    expect(result).toBe('hi world');
  });

  test('崩溃自动重启：进程 crash 后 WorkerGuard 自动恢复，工具仍可用（PY-5）', async () => {
    // crash 工具使进程退出 → 本次请求失败
    await expect(adapter.callTool('crash', {})).rejects.toThrow();

    // 下一次调用触发 WorkerGuard 自动恢复（重新 spawn）
    const result = await adapter.callTool('greet', { name: 'again' });
    expect(result).toBe('Hello, again');
    expect(adapter.isReady()).toBe(true);
  });

  test('destroy：shutdown RPC + 注销工具', async () => {
    await adapter.destroy();
    expect(adapter.getState()).toBe('stopped');
    expect(getToolRegistry().getTool('greet')).toBeUndefined();
    expect(getToolRegistry().getTool('use_service')).toBeUndefined();
  });
});
