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
 * McpResourcesDriver —— `mcp://` 只读驱动（AI-VFS 并存面）。
 *
 * **事实源声明（契约 §3.5）**：MCP 资源面的**工具面事实源**仍是 `mcp_resource` 工具
 * （`tools/MCPResourceTool`，行为不变）；本驱动是 VFS 的**并存面**（`mcp://` 挂载点），
 * **不复制**其业务逻辑 —— 二者**共用同一条 SDK 链**（`mcpConnectionManager.getSdkClient()`
 * → SDK `Client` 顶层方法 `listResources()` / `readResource()`），仅对协议响应做**形态投影**。
 *
 * **路径映射（关键）**：`mcp://<server>/<resource-uri>`
 * - `authority` = `<server>`（MCP 服务器名）；
 * - `path` = `<resource-uri>` **逐字原文**。
 *
 * ⚠️ MCP 资源 URI **本身可能含 `://`**（如 `file://` / `db://`），例如
 * `mcp://server-filesystem/file:///tmp/a.txt` ⇒ `authority='server-filesystem'`、
 * `path='file:///tmp/a.txt'`。因此 **禁止**对 `path` 做任何路径归一化 / 穿越判定
 * （`..`、`~`、`\\` 等）—— 它不是文件系统路径，而是**不透明 URI**（交由 MCP 服务器解释）。
 *
 * `capabilities.write === false` ⇒ `write_vfs` **fail-closed** 拒绝（不静默降级，CS03）。
 *
 * 取客户端**唯一实现链**（勿复制）：一律 `mcpConnectionManager.getSdkClient(server)` —— 该入口
 * 收敛了"只有 `clientCache` 中 `type === 'connected'` 的条目才有 SDK Client"的判据。
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mcpConnectionManager } from '@modules/services/mcp/MCPConnectionManager.js';
import {
  vfsError,
  type IVfsDriver,
  type VfsDriverCapabilities,
  type VfsEntry,
  type VfsPath,
  type VfsReadResult,
  type VfsStat,
  type VfsWriteInput,
  type VfsWriteResult,
} from '../types.js';
import { formatVfsPath } from '../VfsPath.js';

/** 列表默认上限（`opts.limit <= 0` 时生效；对齐 `DevDocsDriver` 的 200） */
const DEFAULT_LIST_LIMIT = 200;

/** 默认挂载点 scheme（`stat.mount` 回显；装配面按该 scheme 注册） */
const DEFAULT_MOUNT_SCHEME = 'mcp';

/** 取客户端的可测 seam（默认 = 真实单例 `mcpConnectionManager.getSdkClient`） */
type GetSdkClient = (server: string) => Client | undefined;

/** SDK `listResources()` 的响应（顶层方法返回形状） */
type ListResourcesResult = Awaited<ReturnType<Client['listResources']>>;

/** SDK `readResource()` 响应的 `contents` 段 */
type ReadContents = Awaited<ReturnType<Client['readResource']>>['contents'];

/** 提取错误信息（测试桩与真实 SDK 抛错共用；不吞错，CS03） */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 默认取客户端实现：真实单例入口（测试可经构造参数注入桩） */
const defaultGetSdkClient: GetSdkClient = (server) =>
  mcpConnectionManager.getSdkClient(server);

/**
 * 默认"已连接服务器名"枚举（仅 `type === 'connected'` 的条目才有 SDK Client，
 * 与 `getSdkClient` 的判据同源）。
 *
 * 仅在**未提供允许清单**时用于 `listMountPoints()`（列举"所有已连接 server"）。
 */
function listConnectedServerNames(): readonly string[] {
  return mcpConnectionManager
    .getServers()
    .filter((connection) => connection.type === 'connected')
    .map((connection) => connection.name);
}

export class McpResourcesDriver implements IVfsDriver {
  readonly capabilities: VfsDriverCapabilities = {
    read: true,
    write: false,
    list: true,
  };

  private readonly getClient: GetSdkClient;
  /** 允许的 MCP 服务器清单（`undefined` = 不限制，保持既有行为） */
  private readonly allowedServers?: readonly string[];

  constructor(
    getClient: GetSdkClient = defaultGetSdkClient,
    allowedServers?: readonly string[]
  ) {
    this.getClient = getClient;
    this.allowedServers = allowedServers;
  }

  /**
   * 扁平列举 `authority` 服务器的资源。
   *
   * MCP 资源**无目录语义** ⇒ 恒为一层扁平列表（`recursive` 无意义，忽略）；
   * 每条 entry 的 `name` = 资源 **uri 原文**（便于直接作为 `read`/`stat` 的 `path`），
   * `kind` 恒为 `'file'`。
   *
   * `mimeType` / `description` 取自 SDK 列举条目（**源提供则填，无则省略** —— 不编造默认值，CS04）。
   */
  async list(
    vfsPath: VfsPath,
    opts: { recursive: boolean; limit: number }
  ): Promise<VfsEntry[]> {
    const client = this.requireClient(vfsPath);
    const limit = opts.limit > 0 ? opts.limit : DEFAULT_LIST_LIMIT;
    const { resources } = await this.listResources(client, vfsPath);
    return resources.slice(0, limit).map((resource) => ({
      name: resource.uri,
      kind: 'file' as const,
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      ...(resource.description ? { description: resource.description } : {}),
    }));
  }

  /**
   * `path` 即资源 uri ⇒ 通过 `listResources()` 找 `uri === path` 的条目。
   *
   * ⚠️ `size` / `mtime` 在 MCP 资源模型里**不可得** ⇒ 置 `0`（**未知**，非"空文件"语义）。
   * `mimeType` 取自列举条目（无则省略）。
   */
  async stat(vfsPath: VfsPath): Promise<VfsStat> {
    const client = this.requireClient(vfsPath);
    const { resources } = await this.listResources(client, vfsPath);
    const match = resources.find((resource) => resource.uri === vfsPath.path);
    if (!match) {
      throw vfsError(
        'VFS_NOT_FOUND',
        `MCP 资源不存在: "${vfsPath.path}"（服务器: "${vfsPath.authority}"）`
      );
    }
    return {
      kind: 'file',
      // MCP 资源模型不暴露大小 / 修改时间 ⇒ 未知，置 0
      size: 0,
      mtime: 0,
      ...(match.mimeType ? { mimeType: match.mimeType } : {}),
      mount: DEFAULT_MOUNT_SCHEME,
      readOnly: true,
    };
  }

  /**
   * `path` 即资源 uri ⇒ `readResource({ uri })`，把返回 `contents` 的文本拼接。
   *
   * - `text` 内容优先拼接；`blob`（二进制）按 **base64 字符串**原样拼接（不做解码，
   *   VFS 出参 `data` 为字符串）；
   * - `range` **忽略**（MCP 资源无分段读取语义，不假装支持，CS03）；
   * - `mimeType` 取首个声明的 `mimeType`，无声明时按内容形态兜底（纯文本 ⇒ `text/plain`，
   *   含 blob ⇒ `application/octet-stream`）；
   * - `size` = 拼接后 `data` 的字节数。
   */
  async read(
    vfsPath: VfsPath,
    _range?: { offset: number; limit: number }
  ): Promise<VfsReadResult> {
    const client = this.requireClient(vfsPath);
    const uri = vfsPath.path;

    let contents: ReadContents;
    try {
      ({ contents } = await client.readResource({ uri }));
    } catch (error) {
      throw vfsError(
        'VFS_DENIED',
        `读取 MCP 资源失败: "${uri}"（${errorMessage(error)}）`
      );
    }

    const parts: string[] = [];
    let declaredMimeType: string | undefined;
    let sawBlob = false;
    for (const content of contents) {
      if (declaredMimeType === undefined && content.mimeType) {
        declaredMimeType = content.mimeType;
      }
      if ('text' in content) {
        parts.push(content.text);
      } else {
        parts.push(content.blob);
        sawBlob = true;
      }
    }

    const data = parts.join('');
    return {
      data,
      mimeType:
        declaredMimeType ??
        (sawBlob ? 'application/octet-stream' : 'text/plain'),
      size: Buffer.byteLength(data, 'utf-8'),
      truncated: false,
    };
  }

  async write(_path: VfsPath, _data: VfsWriteInput): Promise<VfsWriteResult> {
    // 只读驱动：fail-closed 拒绝（MCP 资源为服务器托管，VFS 侧不可写）
    throw vfsError(
      'VFS_READ_ONLY_MOUNT',
      `挂载点 ${DEFAULT_MOUNT_SCHEME}:// 为只读，不支持写入`
    );
  }

  /**
   * 列举本 scheme 下的"挂载点"（scheme-only 列举，`list_vfs('mcp://')`）。
   *
   * 每条 = 一个**允许且当前已连接**的 MCP 服务器（`{ name: 'mcp://<server>', kind: 'dir' }`）；
   * 无允许清单时 = **所有已连接**服务器。未连接 / 不在清单者不出现在结果中。
   */
  async listMountPoints(): Promise<VfsEntry[]> {
    const candidates = this.allowedServers ?? listConnectedServerNames();
    const entries: VfsEntry[] = [];
    for (const server of candidates) {
      if (!this.getClient(server)) continue;
      entries.push({ name: `mcp://${server}`, kind: 'dir' });
    }
    return entries;
  }

  /**
   * 取已连接 SDK `Client`；`authority` 缺失 / 不在允许清单 / 服务器未连接 ⇒
   * `VFS_UNKNOWN_MOUNT`（**不**回退，list/stat/read 一致，CS03）。
   */
  private requireClient(vfsPath: VfsPath): Client {
    const server = vfsPath.authority;
    if (!server) {
      throw vfsError(
        'VFS_UNKNOWN_MOUNT',
        `mcp:// 路径缺少服务器（authority）段: "${formatVfsPath(vfsPath)}"`
      );
    }
    if (this.allowedServers && !this.allowedServers.includes(server)) {
      throw vfsError(
        'VFS_UNKNOWN_MOUNT',
        `MCP 服务器不在允许清单内: "${server}"`
      );
    }
    const client = this.getClient(server);
    if (!client) {
      throw vfsError('VFS_UNKNOWN_MOUNT', `MCP 服务器未连接: "${server}"`);
    }
    return client;
  }

  /** 列举资源（SDK 顶层方法）；SDK 调用抛错 ⇒ `VFS_DENIED` */
  private async listResources(
    client: Client,
    vfsPath: VfsPath
  ): Promise<ListResourcesResult> {
    try {
      return await client.listResources();
    } catch (error) {
      throw vfsError(
        'VFS_DENIED',
        `列举 MCP 资源失败（服务器: "${vfsPath.authority}"）（${errorMessage(error)}）`
      );
    }
  }
}
