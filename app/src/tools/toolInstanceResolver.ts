// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolInstanceResolver — 「按名取工具真身」的**反向登记**位（2026-10-23，madge 断环）
 *
 * 背景：`resolveAgentToolInstance` 原先直接 `import { getToolManager } from '../ToolManager'`，
 * 而 `ToolManager → ToolFactory → builtinToolRegistry → AgentsListTool → resolveAgentToolInstance`
 * 形成静态环。把"解析入口"下沉到本模块（**零 import**），由 `ToolManager` 在模块加载时登记：
 *
 * - `resolveAgentToolInstance` 只依赖本模块 + `ToolRegistry`（无环）；
 * - `ToolManager` 构造后登记 resolver，保留 `ensureToolsLoaded()` + `unwrap()` 的既有语义；
 * - 尚未登记（工具管理器未就绪）⇒ 返回 `undefined`，调用方按既有 fail-closed 处理。
 */

type ToolInstanceResolver = (name: string) => unknown;

let resolver: ToolInstanceResolver | null = null;

/** 登记/清除解析器（`ToolManager` 模块加载时登记；测试可清除） */
export function setToolInstanceResolver(fn: ToolInstanceResolver | null): void {
  resolver = fn;
}

/** 按名解析工具真身；未登记 ⇒ `undefined` */
export function resolveToolInstanceByName(name: string): unknown {
  return resolver ? resolver(name) : undefined;
}
