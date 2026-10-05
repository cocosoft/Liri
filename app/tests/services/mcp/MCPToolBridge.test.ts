/**
 * MCPToolBridge —— 工具桥接契约（P1-10 测试盲区补齐，2026-10-05）
 *
 * 背景（spec `layer-inversion-service-app-app-ui.md` §3.5 D-208 遗留）：全仓 `*.test.ts`
 * grep `MCPToolBridge` **0 命中**（该文件无覆盖）。同时该文件是 B18-a 的落点 ——
 * `toolPort` 为**必填注入端口**，缺失时须**明确失败**（不静默降级）。
 *
 * 本文件锁住：
 *  ① `initialize(port)` 经**注入端口**注册“已连接”服务器的全部工具（名字形态 `server__tool`）；
 *  ② **未连接 / 空工具集**服务器被跳过（不产生任何注册副作用）；
 *  ③ **未注入端口 ⇒ 明确抛 AppError**（CS03：不静默回退）；
 *  ④ `refreshAllTools()` 先逆序注销再重同步，返回最新计数；
 *  ⑤ `cleanup()` 逆序注销全部（LIFO）、复位 `isInitialized`。
 *
 * 说明：依赖的 `mcpConnectionManager` / `mcpToolRegistry` / `dependencyRegistry` 均为
 * **进程级单例** ⇒ 一律以 `spyOn(实例方法)` + `mockRestore` 隔离，**不使用 `mock.module`**。
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  MCPToolBridge,
  type McpToolRegistrationPort,
} from '../../../src/services/mcp/MCPToolBridge';
import { mcpConnectionManager } from '../../../src/services/mcp/MCPConnectionManager';
import { mcpToolRegistry } from '../../../src/services/mcp/MCPToolRegistry';
import { dependencyRegistry } from '../../../src/core/DependencyRegistry';
import type {
  MCPServerConnection,
  SerializedTool,
} from '../../../src/services/mcp/types';

/** 当前 `getAllTools()` 的返回值（每个用例前重置） */
let allTools = new Map<
  string,
  { serverName: string; tools: SerializedTool[] }
>();
/** 当前 `getServer()` 判定为"已连接"的服务器名 */
let connected = new Set<string>();

/** 记录注入端口收到的注册 / 注销 */
let registeredNames: string[] = [];
let unregisteredNames: string[] = [];
/** 记录 mcpToolRegistry / dependencyRegistry 的调用 */
let registryRegisterCalls: Array<[string, string]> = [];
let registryUnregisterServers: string[] = [];
let providedKeys: string[] = [];
let withdrawnKeys: string[] = [];

function connectedServer(name: string): MCPServerConnection {
  return {
    type: 'connected',
    name,
    client: { name },
    capabilities: {},
  } as unknown as MCPServerConnection;
}

const getAllToolsSpy = spyOn(mcpConnectionManager, 'getAllTools');
const getServerSpy = spyOn(mcpConnectionManager, 'getServer');
const regSpy = spyOn(mcpToolRegistry, 'registerTool');
const unregServerSpy = spyOn(mcpToolRegistry, 'unregisterServer');
const provideSpy = spyOn(dependencyRegistry, 'provide');
const withdrawSpy = spyOn(dependencyRegistry, 'withdraw');

getAllToolsSpy.mockImplementation(() => allTools);
getServerSpy.mockImplementation((name: string) =>
  connected.has(name) ? connectedServer(name) : undefined
);
regSpy.mockImplementation((server: string, name: string) => {
  registryRegisterCalls.push([server, name]);
});
unregServerSpy.mockImplementation((server: string) => {
  registryUnregisterServers.push(server);
});
provideSpy.mockImplementation((key: string) => {
  providedKeys.push(key);
});
withdrawSpy.mockImplementation((key: string) => {
  withdrawnKeys.push(key);
});

afterAll(() => {
  getAllToolsSpy.mockRestore();
  getServerSpy.mockRestore();
  regSpy.mockRestore();
  unregServerSpy.mockRestore();
  provideSpy.mockRestore();
  withdrawSpy.mockRestore();
});

beforeEach(() => {
  allTools = new Map();
  connected = new Set();
  registeredNames = [];
  unregisteredNames = [];
  registryRegisterCalls = [];
  registryUnregisterServers = [];
  providedKeys = [];
  withdrawnKeys = [];
});

function makePort(): McpToolRegistrationPort {
  return {
    registerTool: (tool) => {
      registeredNames.push(tool.name);
    },
    unregisterTool: (name) => {
      unregisteredNames.push(name);
    },
  };
}

function tool(name: string, originalToolName?: string): SerializedTool {
  return originalToolName
    ? { name, description: `${name} desc`, originalToolName }
    : { name, description: `${name} desc` };
}

describe('MCPToolBridge（P1-10 盲区补齐）', () => {
  test('initialize：经注入端口注册“已连接”服务器的全部工具（名字 server__tool）', async () => {
    allTools.set('alpha', {
      serverName: 'alpha',
      tools: [tool('t1'), tool('raw', 't2')],
    });
    connected.add('alpha');

    const bridge = new MCPToolBridge();
    await bridge.initialize(makePort());

    expect(registeredNames).toEqual(['alpha__t1', 'alpha__t2']);
    expect(bridge.getRegisteredCount()).toBe(2);
    expect(bridge.isInitialized()).toBe(true);
    expect(registryRegisterCalls).toEqual([
      ['alpha', 'alpha__t1'],
      ['alpha', 'alpha__t2'],
    ]);
    expect(providedKeys).toEqual(['mcp:tools:alpha']);
  });

  test('initialize：未连接 / 空工具集服务器被跳过（零注册副作用）', async () => {
    allTools.set('alpha', { serverName: 'alpha', tools: [tool('ok')] });
    allTools.set('beta', { serverName: 'beta', tools: [tool('x')] }); // 未连接
    allTools.set('gamma', { serverName: 'gamma', tools: [] }); // 空
    connected.add('alpha');
    connected.add('gamma');

    const bridge = new MCPToolBridge();
    await bridge.initialize(makePort());

    expect(registeredNames).toEqual(['alpha__ok']);
    expect(bridge.getRegisteredCount()).toBe(1);
    expect(registryUnregisterServers).toEqual([]);
  });

  test('未注入端口 ⇒ refreshAllTools 明确抛 AppError（不静默降级，CS03）', async () => {
    allTools.set('alpha', { serverName: 'alpha', tools: [tool('t1')] });
    connected.add('alpha');

    const bridge = new MCPToolBridge();

    await expect(bridge.refreshAllTools()).rejects.toThrow(/未注入工具端口/);
    expect(registeredNames).toEqual([]);
  });

  test('refreshAllTools：先注销旧工具再重同步，返回最新计数', async () => {
    allTools.set('alpha', {
      serverName: 'alpha',
      tools: [tool('t1'), tool('t2')],
    });
    connected.add('alpha');

    const bridge = new MCPToolBridge();
    await bridge.initialize(makePort());

    // 服务器集合变更：alpha 下线、beta 上线
    allTools = new Map([['beta', { serverName: 'beta', tools: [tool('b1')] }]]);
    connected = new Set(['beta']);

    const count = await bridge.refreshAllTools();

    expect(count).toBe(1);
    expect(unregisteredNames).toEqual(['alpha__t1', 'alpha__t2']);
    expect(registeredNames).toEqual(['alpha__t1', 'alpha__t2', 'beta__b1']);
    expect(registryUnregisterServers).toEqual(['alpha']);
    expect(withdrawnKeys).toEqual(['mcp:tools:alpha']);
    expect(providedKeys).toEqual(['mcp:tools:alpha', 'mcp:tools:beta']);
  });

  test('cleanup：逆序（LIFO）注销全部并复位 isInitialized', async () => {
    allTools.set('alpha', { serverName: 'alpha', tools: [tool('a1')] });
    allTools.set('beta', { serverName: 'beta', tools: [tool('b1')] });
    connected.add('alpha');
    connected.add('beta');

    const bridge = new MCPToolBridge();
    await bridge.initialize(makePort());
    expect(bridge.getRegisteredCount()).toBe(2);

    await bridge.cleanup();

    // LIFO：后注册的 beta 先被注销
    expect(unregisteredNames).toEqual(['beta__b1', 'alpha__a1']);
    expect(bridge.getRegisteredCount()).toBe(0);
    expect(bridge.isInitialized()).toBe(false);
  });
});
