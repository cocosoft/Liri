// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolCreationGuard — 工厂方法**统一的"构造 + 失败留痕"守卫**（G18，2026-10-11）
 *
 * 背景：`ToolFactory` 内约 7 处逐字重复的模板 ——
 * `try { return new X(); } catch (e) { void handleError(e, { module: 'tools:factory', action }); return null; }`。
 * 抽出为单一实现（**行为逐字保持**：同 `handleError` 参数、同返回 `null`），用于缩小上帝对象并消除重复。
 *
 * 注意：**不**纳入 `isToolEnabled(...)` 之类的**门控**（那是"静默不注册"语义，非构造失败，
 * 必须留在调用方，以免把"开关关闭"误记为错误）。
 */

import type { Tool } from '../types/Tool';
import { handleError } from '@modules/error';

/**
 * 执行工具构造；失败 ⇒ 记录（`tools:factory` + `action`）并返回 `null`。
 *
 * @param action 留痕用的动作名（沿用原 `handleError` 的 `action` 值，保持日志可追溯）
 * @param build 构造闭包（通常 `() => new XxxTool()`）
 */
export function guardToolCreation(
  action: string,
  build: () => Tool
): Tool | null {
  try {
    return build();
  } catch (error) {
    void handleError(error, { module: 'tools:factory', action });
    return null;
  }
}
