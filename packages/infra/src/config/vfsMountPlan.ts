// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * VFS 挂载计划的**纯推导**（配置 → 生效计划）。
 *
 * 2026-11-24（R00-003 下沉）：原位于 `app/src/entrypoints/vfsWiring.ts`（entry 层），
 * 但 service 层的 `vfs-mounts-handlers.ts` 需要它来回答 `GET /v1/vfs/mounts`
 * （导出"生效计划"，禁止复制推导逻辑）⇒ 只能 `await import('../../../entrypoints/vfsWiring.js')`，
 * 构成 service → entry 的动态跨层盲区（静态正则看不见）。
 *
 * 该函数是**纯函数**（无 IO、无单例），只依赖 `VfsConfig` 类型 ⇒ 下沉到 service 可用的
 * infra `config/` 模块（与配置类型同域、无新增跨层边）。装配面 `registerVfsMounts()`
 * 与本文件的调用方共用同一实现（CS01 单一来源）。
 *
 * 语义（**未配置时行为零变更**）：
 * - 未配置（无 `vfs` 段，或 `mounts` 缺省）⇒ `dev_docs` + `mcp`（不限 server）；
 * - 已配置 `mounts` ⇒ **严格按清单**：未知 scheme / `mcp` 缺 `server` ⇒ 跳过 + 记 WARN。
 */
import type { VfsConfig } from './types.js';

/**
 * 从配置构建的挂载计划（`buildMountPlan` 纯函数产物）。
 *
 * `warnings` 不在此处打印（保持纯函数可单测）—— 由装配面逐条记 WARN。
 */
export interface VfsMountPlan {
  /** 是否注册 `dev_docs` 挂载点 */
  readonly registerDevDocs: boolean;
  /**
   * `mcp` 挂载点的允许服务器清单：
   * - `null` ⇒ **不注册** `mcp`（显式配置了 `mounts` 但无有效 mcp 条目）；
   * - `undefined` ⇒ 注册且**不限定** server（未配置 `vfs` 时的既有行为）；
   * - 数组 ⇒ 注册且仅允许清单内 server。
   */
  readonly mcpAllowedServers: readonly string[] | null | undefined;
  /** 被跳过的配置条目说明（装配面据此记 WARN，**不**静默降级） */
  readonly warnings: readonly string[];
}

/**
 * 从 `vfs` 配置构建挂载计划（**纯函数**，便于单测）。
 *
 * - 未配置（无 `vfs` 段，或 `mounts` 缺省）⇒ **保持现状**：`dev_docs` + `mcp`（不限 server）；
 * - 已配置 `mounts` ⇒ **严格按清单**：未知 scheme / `mcp` 缺 `server` ⇒ 跳过 + WARN。
 */
export function buildMountPlan(vfs: VfsConfig | undefined): VfsMountPlan {
  const mounts = vfs?.mounts;
  // 未配置 ⇒ 行为零变更（不破坏既有只读试点）
  if (!mounts) {
    return {
      registerDevDocs: true,
      mcpAllowedServers: undefined,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  let registerDevDocs = false;
  const mcpServers: string[] = [];

  for (const entry of mounts) {
    // 配置来自用户 JSON ⇒ 运行时按 string 校验（类型联合不阻止非法值）
    const scheme: string = entry.scheme;
    if (scheme !== 'dev_docs' && scheme !== 'mcp') {
      warnings.push(
        `vfs.mounts 中的未知 scheme "${String(entry.scheme)}"，已跳过该条目`
      );
      continue;
    }
    // `enabled` 缺省视为 true；显式 false ⇒ 用户主动停用，静默跳过
    if (entry.enabled === false) continue;

    if (scheme === 'dev_docs') {
      registerDevDocs = true;
      continue;
    }

    // scheme === 'mcp'：必须有非空 server
    const server = typeof entry.server === 'string' ? entry.server.trim() : '';
    if (!server) {
      warnings.push('vfs.mounts 中的 mcp 条目缺少 server，已跳过该条目');
      continue;
    }
    mcpServers.push(server);
  }

  return {
    registerDevDocs,
    // 允许清单为空 ⇒ 不注册 mcp（不回退为"不限 server"）
    mcpAllowedServers: mcpServers.length > 0 ? mcpServers : null,
    warnings,
  };
}
