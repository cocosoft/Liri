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
 * vfs-mounts-handlers.ts — AI-VFS 用户可配置挂载面 HTTP handler（2026-10-08）。
 *
 * **冻结契约**：`.trae/specs/ai-vfs-user-mountable.md §8.2`（逐字对齐，不得改字段名/路由）。
 * 接口清单登记：`.trae/docs/api-spec.md`。
 *
 * - `GET /v1/vfs/mounts`：返回**生效挂载计划**（复用 `buildMountPlan` 推导）+ 可用 scheme
 *   + 已连接 MCP 服务器；`registered` 取 `vfsMountRegistry` 当前进程注册表。
 * - `PUT /v1/vfs/mounts`：**fail-closed** 校验后经 `configManager` 写 `vfs.mounts`
 *   （**唯一事实源**；**无热更新**，重启后由 `vfsWiring` 按新清单装配）。
 *
 * **分层**：本文件属 service 层（`infrastructure`）⇒ `vfs`(app) / `entrypoints`(entry) 一律
 * 以**动态 `import()`** 访问，避免静态 `service -> app/entry` 倒挂（同 `chat-handlers.ts` 既有手法）。
 */

import type http from 'http';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { mcpConnectionManager } from '@modules/services/mcp/MCPConnectionManager.js';
import { readBody, json } from './handler-utils';
import type { VfsConfig, VfsMountConfigEntry } from '@modules/config';

const logger = getLogger('http:vfsMounts');

/**
 * 可挂载 scheme 全集 —— **冻结契约 §8.2 的 `availableSchemes`**。
 *
 * 与 `buildMountPlan` 的合法 scheme 校验同源：未知 scheme 会被跳过 + WARN（不注册）。
 */
const AVAILABLE_SCHEMES = ['dev_docs', 'mcp'] as const;

/** 挂载 scheme（契约仅允许 `dev_docs` / `mcp`） */
type MountScheme = VfsMountConfigEntry['scheme'];

/** GET 响应中的单条挂载（契约 §8.2 形状） */
interface VfsMountView {
  scheme: MountScheme;
  /** 仅 `mcp` 且限定 server 时出现 */
  server?: string;
  enabled: boolean;
  registered: boolean;
  readOnly: boolean;
}

/** GET /v1/vfs/mounts 响应体（冻结契约） */
interface VfsMountsResponse {
  mounts: VfsMountView[];
  availableSchemes: MountScheme[];
  mcpServers: Array<{ name: string; connected: boolean }>;
  requiresRestart: true;
}

/** `parseMountsInput` 结果：合法 ⇒ `mounts`；不合法 ⇒ `errors`（逐条原因） */
export interface ParsedMounts {
  /** 规范化后的挂载条目（仅保留已知字段：scheme / server / enabled） */
  readonly mounts?: VfsMountConfigEntry[];
  /** 逐条校验失败原因（成功时为空数组） */
  readonly errors: readonly string[];
}

/** 是否为普通对象（排除数组 / null） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * fail-closed 校验并规范化 `PUT` 请求体（**纯函数**，便于单测）。
 *
 * 规则（冻结契约 §8.2）：
 * - `scheme` 必须 ∈ {`dev_docs`,`mcp`}；
 * - `mcp` 条目 `server` 必填非空（去空白）；
 * - 未知字段**忽略**（不报错、不落盘）。
 */
export function parseMountsInput(body: unknown): ParsedMounts {
  if (!isRecord(body)) {
    return { errors: ['请求体必须是 JSON 对象'] };
  }
  const rawMounts = body['mounts'];
  if (!Array.isArray(rawMounts)) {
    return { errors: ['mounts 必须是数组'] };
  }

  const errors: string[] = [];
  const mounts: VfsMountConfigEntry[] = [];

  rawMounts.forEach((item: unknown, index: number) => {
    if (!isRecord(item)) {
      errors.push(`mounts[${index}] 必须是对象`);
      return;
    }
    const scheme = item['scheme'];
    if (scheme !== 'dev_docs' && scheme !== 'mcp') {
      errors.push(
        `mounts[${index}].scheme 必须是 'dev_docs' 或 'mcp'（实际: ${String(scheme)}）`
      );
      return;
    }

    // 仅保留已知字段；`server` 只对 `mcp` 有意义（未知字段一律忽略）
    const entry: VfsMountConfigEntry = { scheme };
    if (scheme === 'mcp') {
      const rawServer = item['server'];
      const server = typeof rawServer === 'string' ? rawServer.trim() : '';
      if (!server) {
        errors.push(`mounts[${index}]（mcp）缺少必填项 server`);
        return;
      }
      entry.server = server;
    }
    const rawEnabled = item['enabled'];
    if (typeof rawEnabled === 'boolean') {
      entry.enabled = rawEnabled;
    }
    mounts.push(entry);
  });

  if (errors.length > 0) {
    return { errors };
  }
  return { mounts, errors: [] };
}

/** 构造单条挂载视图（`enabled` 恒 true —— 生效计划只含生效项；两个驱动均只读） */
function makeMountView(
  scheme: MountScheme,
  registered: boolean,
  server?: string
): VfsMountView {
  return {
    scheme,
    ...(server !== undefined ? { server } : {}),
    enabled: true,
    registered,
    readOnly: true,
  };
}

/**
 * GET /v1/vfs/mounts —— 生效挂载计划（复用 `buildMountPlan`）+ 可用 scheme + MCP 服务器。
 */
export async function handleGetVfsMounts(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { configManager } = await import('@modules/config');
    // 直连注册表叶子：本处只需注册表单例，**不**需要连带求值驱动图
    // （`McpResourcesDriver` → `MCPConnectionManager` → …）⇒ 叶入口更轻，取同一单例。
    // （`@modules/vfs` 桶的冷启动循环依赖 TDZ 已于 2026-10-08 修复，见
    //  `dev_docs/error_repairs/预存错误与待处理问题.md`「VFS 桶循环依赖 TDZ」。）
    const { vfsMountRegistry } =
      await import('@modules/vfs/VfsMountRegistry.js');
    const { buildMountPlan } =
      await import('../../../entrypoints/vfsWiring.js');

    // 复用 buildMountPlan 推导"生效计划"（禁止复制其推导逻辑）
    const plan = buildMountPlan(configManager.getValue<VfsConfig>('vfs'));

    const mounts: VfsMountView[] = [];
    if (plan.registerDevDocs) {
      mounts.push(makeMountView('dev_docs', vfsMountRegistry.has('dev_docs')));
    }
    if (plan.mcpAllowedServers === undefined) {
      // 未配置 `vfs` ⇒ 默认：`mcp` 不限 server（保持只读试点行为）
      mounts.push(makeMountView('mcp', vfsMountRegistry.has('mcp')));
    } else if (plan.mcpAllowedServers) {
      for (const server of plan.mcpAllowedServers) {
        mounts.push(makeMountView('mcp', vfsMountRegistry.has('mcp'), server));
      }
    }

    const body: VfsMountsResponse = {
      mounts,
      availableSchemes: [...AVAILABLE_SCHEMES],
      mcpServers: mcpConnectionManager.getServers().map((connection) => ({
        name: connection.name,
        connected: connection.type === 'connected',
      })),
      // 固定 true：改配置需重启生效（本批不做热更新）
      requiresRestart: true,
    };
    json(res, 200, body);
  } catch (error) {
    await handleError(error, { module: 'http:vfsMounts', action: 'getMounts' });
    json(res, 500, { error: { message: '读取 VFS 挂载配置失败' } });
  }
}

/**
 * PUT /v1/vfs/mounts —— fail-closed 校验后写 `vfs.mounts`（重启生效）。
 */
export async function handlePutVfsMounts(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch (error) {
    await handleError(error, { module: 'http:vfsMounts', action: 'parseBody' });
    json(res, 400, {
      error: { code: 'INVALID_MOUNTS', message: '请求体不是合法的 JSON' },
    });
    return;
  }

  // 校验失败 ⇒ 400 + 逐条原因，**绝不写盘**
  const parsed = parseMountsInput(body);
  if (parsed.errors.length > 0) {
    json(res, 400, {
      error: { code: 'INVALID_MOUNTS', message: parsed.errors.join('；') },
    });
    return;
  }

  try {
    const mounts = parsed.mounts ?? [];
    const { configManager } = await import('@modules/config');
    // 唯一事实源 = 配置文件的 `vfs.mounts`（无热更新 ⇒ 重启后 vfsWiring 按新清单装配）
    configManager.setConfigValue('vfs', { mounts } satisfies VfsConfig);

    // warnings 复用 buildMountPlan 的跳过口径（与 GET 同源，禁止另行复制推导）
    const { buildMountPlan } =
      await import('../../../entrypoints/vfsWiring.js');
    const warnings = [
      ...buildMountPlan({ mounts } satisfies VfsConfig).warnings,
    ];

    logger.info('VFS 挂载配置已更新（重启后生效）', {
      count: mounts.length,
      warnings: warnings.length,
    });
    json(res, 200, { success: true, warnings, requiresRestart: true });
  } catch (error) {
    await handleError(error, { module: 'http:vfsMounts', action: 'putMounts' });
    json(res, 500, { error: { message: '写入 VFS 挂载配置失败' } });
  }
}
