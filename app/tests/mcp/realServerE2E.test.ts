// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 真实 MCP 服务器端到端实测（官方参考服务器 `@modelcontextprotocol/server-everything`，stdio）。
 *
 * **环境门控**：仅在 `MCP_E2E=1` 时运行；默认 `bun test tests/` 会**跳过**本文件
 * （真实网络 / npx 下载不得成为默认套件的依赖）。
 *
 * 覆盖的**真实入口**（不经 `run_mcp`）：
 *  - 连接：生产链 `mcpConnectionManager.initialize({...})`（`client.ts` 的 SDK `StdioClientTransport`）
 *  - 工具面：`MCPTool` 的 `list_tools` / `call`（`echo`）
 *  - 资源面（经工具）：`MCPResourceTool` 的 `list_resources` / `read_resource`
 *  - 提示面：`MCPResourceTool` 的 `list_prompts` / `get_prompt`
 *  - VFS 面：`list_vfs` / `read_vfs` / `stat_vfs` / `write_vfs`（`mcp://` 只读驱动）
 *  - 未连接 server：`read_vfs('mcp://<不存在>/...')` ⇒ `VFS_UNKNOWN_MOUNT`
 *
 * ⚠️ `mcp_status` / `MCPTool.list_servers` 依赖自研链 `addServer`，不在本文件断言范围。
 *
 * 运行：在 `app/` 下 `$env:MCP_E2E='1'; bun test tests/mcp/realServerE2E.test.ts`。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mcpConnectionManager } from '../../src/services/mcp/MCPConnectionManager.js';
import type { ScopedMcpServerConfig } from '../../src/services/mcp/types';
import { MCPTool, type MCPToolParams } from '../../src/mcp/MCPTool.js';
import { MCPResourceTool } from '../../src/tools/MCPResourceTool/MCPResourceTool.js';
import { ListVfsTool } from '../../src/tools/ListVfsTool/ListVfsTool.js';
import { ReadVfsTool } from '../../src/tools/ReadVfsTool/ReadVfsTool.js';
import { StatVfsTool } from '../../src/tools/StatVfsTool/StatVfsTool.js';
import { WriteVfsTool } from '../../src/tools/WriteVfsTool/WriteVfsTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import type { ToolResult } from '../../src/tools/types/ToolResult.js';
import { McpResourcesDriver } from '../../src/vfs/drivers/McpResourcesDriver.js';
import { vfsMountRegistry } from '../../src/vfs/VfsMountRegistry.js';

/** 被测服务器名（与 `initialize` 的 configs key 一致） */
const SERVER = 'everything';

/** 参考服务器包名 */
const SERVER_PKG = '@modelcontextprotocol/server-everything';

/**
 * stdio 启动方式。
 *
 * Windows 上 `npx` 实为 `npx.cmd`；SDK 的 `StdioClientTransport` 用 `cross-spawn`
 * 且 `shell:false`，其 `parse/which` 会按 `PATHEXT` 解析出 `.cmd` —— 因此**无需** `cmd /c`。
 * （探针实测：`command:'npx'` 在本机 Windows + bun 下可正常拉起服务器。）
 */
const CONFIG: ScopedMcpServerConfig = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', SERVER_PKG],
  scope: 'local',
};

/** 最小假上下文（不 new 真会话；被测工具均不读取其中的业务字段） */
const ctx = {} as ToolUseContext;

const mcpTool = MCPTool;
const resourceTool = new MCPResourceTool();
const listTool = ListVfsTool.create();
const readTool = ReadVfsTool.create();
const statTool = StatVfsTool.create();
const writeTool = WriteVfsTool.create();

/** 首次 list_resources 得到的首条资源 uri（后续 VFS 读 / stat / write 复用） */
let firstResourceUri = '';
/** 首个**无必填参数**的 prompt 名（便于 `get_prompt` 无需猜参） */
let firstPromptName = '';
/** 连接诊断（断言失败时随错误原文一并抛出，避免"空失败"） */
let connectDiagnostic = '（尚未连接）';

/** 轮询等待 SDK 客户端就绪（`initialize` 内部经 16ms 批量刷新写入 clientCache，存在时序窗口） */
async function waitForSdkClient(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = mcpConnectionManager.getSdkClient(SERVER);
    if (client) return client;
    // 2026-10-08（**实测修正**）：**不要**在此用 `getServer()` 判"终态失败"提前退出 ——
    // `getServer()` 的 `MCPServerManager` 后备分支会为"**已注册但尚未落入 `clientCache`**"
    // 的服务器**合成一条 `type:'failed'`**（其 `error` 为空 ⇒ 兜底文案 'No active connection'）。
    // 而 `updateServer` → `clientCache` 是 **16ms 批量刷新**，`manager.addServer` 却在回调里
    // **立即**执行 ⇒ 两者之间存在**竞态窗口**：本函数曾在"刚加进 manager、还没刷进 cache"的
    // 那几毫秒里**误判为失败并提前退出**（实测：`Added MCP server` 日志后 **7ms** 即误退出）。
    // 故此处只按超时收敛；真实失败原因由 `connectDiagnostic` 携带。
    if (Date.now() >= deadline) return undefined;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}

/** 从 `ToolResult` 取 JSON 字符串载荷；工具失败 ⇒ 带原文抛错（不静默） */
function jsonPayload<T>(result: ToolResult, label: string): T {
  // 2026-10-08：改为 `!result.success` —— 成功出口**必须**显式 `success: true`
  // （`success?: boolean` 在 core 契约中可选；缺失会被判定为失败，正是本次修复的口径）
  if (!result.success) {
    throw new Error(`${label} 失败: ${result.error ?? JSON.stringify(result)}`);
  }
  if (typeof result.data !== 'string') {
    throw new Error(
      `${label} 未返回字符串载荷: ${JSON.stringify(result.data)}`
    );
  }
  return JSON.parse(result.data) as T;
}

/** 断言连接成功；失败时抛出含**真实诊断**的错误 */
function requireSdkClient() {
  const client = mcpConnectionManager.getSdkClient(SERVER);
  if (!client) {
    throw new Error(
      `未取到已连接 SDK Client（server=${SERVER}）。连接诊断: ${connectDiagnostic}`
    );
  }
  return client;
}

describe.skipIf(process.env.MCP_E2E !== '1')(
  `真实 MCP e2e（${SERVER_PKG}）`,
  () => {
    beforeAll(async () => {
      await mcpConnectionManager.initialize({ [SERVER]: CONFIG });

      const client = await waitForSdkClient();

      // 记录连接诊断（无论成败，供后续断言失败时携带真实信息）
      // 用 `getServer` 读**原始 clientCache 条目**：`getServers()` 对"不在 manager 注册表的条目"
      // 会覆写成兜底错误 'Server removed from registry'，会掩盖真正的失败原因。
      const conn = mcpConnectionManager.getServer(SERVER);
      connectDiagnostic = JSON.stringify({
        type: conn?.type ?? null,
        // `error` 只存在于失败态联合成员上 ⇒ 先收窄，避免 TS2339
        error: conn?.type === 'failed' ? conn.error : null,
        hasSdkClient: Boolean(client),
      });

      // VFS 挂载点注册（幂等：全局注册表，避免与其他测试文件的装配冲突）
      if (!vfsMountRegistry.has('mcp')) {
        vfsMountRegistry.registerMount('mcp', new McpResourcesDriver());
      }
    });

    afterAll(async () => {
      // 2026-10-08（**进程泄漏修复后**）：`closeAll()` 现会**自行**关闭每个 cached SDK `Client`
      // （connected 条目的 `cleanup()` ⇒ `client.close()`）⇒ **无需**再手动 `client.close()`。
      // 此处刻意**不再**手动关闭：它同时充当该修复的**端到端验证** —— 若回归为泄漏，
      // SDK 的 stdio 子进程将无人关闭，进程无法干净退出。
      await mcpConnectionManager.closeAll();
    });

    it('生产链连接成功且可取得 SDK Client', () => {
      expect(requireSdkClient()).toBeDefined();
    });

    describe('C1 工具面（MCPTool）', () => {
      it('list_tools 返回非空工具列表', async () => {
        const r = await mcpTool.execute(
          { action: 'list_tools', server_name: SERVER } as MCPToolParams,
          ctx
        );
        expect(r.success).toBe(true);
        const data = r.data as { tools: Array<{ name: string }> };
        expect(data.tools.length).toBeGreaterThan(0);
        expect(data.tools.map((t) => t.name)).toContain('echo');
      });

      it('call echo 返回内容含入参', async () => {
        const marker = 'e2e-echo-marker';
        const r = await mcpTool.execute(
          {
            action: 'call',
            server_name: SERVER,
            tool_name: 'echo',
            tool_args: { message: marker },
          } as MCPToolParams,
          ctx
        );
        expect(r.success).toBe(true);
        expect(JSON.stringify(r.data)).toContain(marker);
      });
    });

    describe('资源面（MCPResourceTool，经 McpResourcesDriver）', () => {
      it('list_resources 非空', async () => {
        const r = await resourceTool.execute(
          { action: 'list_resources', server_name: SERVER },
          ctx
        );
        expect(r.success).toBe(true);
        const out = r.data as { resources: Array<{ uri: string }> };
        expect(out.resources.length).toBeGreaterThan(0);
        firstResourceUri = out.resources[0].uri;
        expect(firstResourceUri.length).toBeGreaterThan(0);
      });

      it('read_resource 返回内容', async () => {
        expect(firstResourceUri).not.toBe('');
        const r = await resourceTool.execute(
          {
            action: 'read_resource',
            server_name: SERVER,
            uri: firstResourceUri,
          },
          ctx
        );
        expect(r.success).toBe(true);
        const out = r.data as {
          content: { contents: Array<{ text?: string; blob?: string }> };
        };
        expect(out.content.contents.length).toBeGreaterThan(0);
        const joined = out.content.contents
          .map((c) => c.text ?? c.blob ?? '')
          .join('');
        expect(joined.length).toBeGreaterThan(0);
      });
    });

    describe('提示面（MCPResourceTool，直连 SDK）', () => {
      it('list_prompts 非空且含无参提示', async () => {
        const r = await resourceTool.execute(
          { action: 'list_prompts', server_name: SERVER },
          ctx
        );
        expect(r.success).toBe(true);
        const out = r.data as {
          prompts: Array<{ name: string; arguments?: Array<{ name: string }> }>;
        };
        expect(out.prompts.length).toBeGreaterThan(0);
        const noArgPrompt = out.prompts.find(
          (p) => !p.arguments || p.arguments.length === 0
        );
        firstPromptName = (noArgPrompt ?? out.prompts[0]).name;
        expect(firstPromptName.length).toBeGreaterThan(0);
      });

      it('get_prompt 返回消息', async () => {
        expect(firstPromptName).not.toBe('');
        const r = await resourceTool.execute(
          {
            action: 'get_prompt',
            server_name: SERVER,
            prompt_name: firstPromptName,
          },
          ctx
        );
        expect(r.success).toBe(true);
        const out = r.data as { prompt: { messages: unknown[] } };
        expect(out.prompt.messages.length).toBeGreaterThan(0);
      });
    });

    describe('VFS 面（mcp:// 只读驱动）', () => {
      it('list_vfs(mcp://) scheme-only ⇒ 含 mcp://everything', async () => {
        const payload = jsonPayload<{
          entries: Array<{ name: string; kind: string }>;
        }>(await listTool.execute({ path: 'mcp://' }, ctx), 'list_vfs(mcp://)');
        expect(payload.entries.map((e) => e.name)).toContain(`mcp://${SERVER}`);
      });

      it('list_vfs(mcp://everything/) 非空', async () => {
        const payload = jsonPayload<{ entries: Array<{ name: string }> }>(
          await listTool.execute({ path: `mcp://${SERVER}/` }, ctx),
          `list_vfs(mcp://${SERVER}/)`
        );
        expect(payload.entries.length).toBeGreaterThan(0);
        // 驱动以**资源 uri 原文**作为条目名
        expect(payload.entries.map((e) => e.name)).toContain(firstResourceUri);
      });

      it('read_vfs(mcp://everything/<uri>) 有内容', async () => {
        expect(firstResourceUri).not.toBe('');
        const payload = jsonPayload<{ data: string; mimeType: string }>(
          await readTool.execute(
            { path: `mcp://${SERVER}/${firstResourceUri}` },
            ctx
          ),
          'read_vfs'
        );
        expect(payload.data.length).toBeGreaterThan(0);
      });

      it('stat_vfs(mcp://everything/<uri>) ⇒ readOnly = true', async () => {
        expect(firstResourceUri).not.toBe('');
        const payload = jsonPayload<{ readOnly: boolean; mount: string }>(
          await statTool.execute(
            { path: `mcp://${SERVER}/${firstResourceUri}` },
            ctx
          ),
          'stat_vfs'
        );
        expect(payload.readOnly).toBe(true);
        expect(payload.mount).toBe('mcp');
      });

      it('write_vfs(mcp://everything/<uri>) ⇒ VFS_READ_ONLY_MOUNT', async () => {
        expect(firstResourceUri).not.toBe('');
        const r = await writeTool.execute(
          {
            path: `mcp://${SERVER}/${firstResourceUri}`,
            content: 'x',
            mode: 'overwrite',
          },
          ctx
        );
        expect(r.success).toBe(false);
        expect(r.error).toContain('VFS_READ_ONLY_MOUNT');
        expect(r.metadata?.errorCode).toBe('VFS_READ_ONLY_MOUNT');
      });
    });

    describe('未连接 server', () => {
      it('read_vfs(mcp://nonexistent/test://x) ⇒ VFS_UNKNOWN_MOUNT', async () => {
        const r = await readTool.execute(
          { path: 'mcp://nonexistent/test://x' },
          ctx
        );
        expect(r.success).toBe(false);
        expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
        expect(r.metadata?.errorCode).toBe('VFS_UNKNOWN_MOUNT');
      });
    });
  }
);
