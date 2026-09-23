/**
 * 工具功能开关配置
 * 用于控制工具的启用/禁用
 *
 * 统一来源：core/featureFlags.ts
 * 映射表位于 core/featureFlags.ts 的 TOOL_FLAG_MAP
 *
 * TR-18 修复（2026-09-22）：**顶层不再求值 `TOOL_NAMES`**。
 *
 * 原实现于模块顶层执行 `for (const toolName of TOOL_NAMES) { ... }`，而 `TOOL_NAMES` 来自
 * `@modules/core`，其依赖图又反向 import 工具层 ⇒ 以「直接 import 工具层」为入口
 * （临时脚本 / 独立工具）时触发
 * `ReferenceError: Cannot access 'TOOL_NAMES' before initialization`（TDZ），
 * 模块树无法加载（实测发生于 TR-12-B 体积测量脚本；见 `dev_docs/error_repairs/` TR-18）。
 *
 * 改为**首次调用时惰性填充**后，`TOOL_NAMES` 的读取被推迟到运行时 —— 此时模块图早已
 * 求值完毕（生产启动序与测试基座本就不受影响，本修复消除的是"入口顺序脆弱性"）。
 */

import { getToolFlag, TOOL_NAMES } from '@modules/core';

export interface ToolFeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
}

/** 工具开关表（**惰性填充**，见文件头 TR-18 说明；保留可变导出以兼容既有引用） */
export const TOOL_FEATURE_FLAGS: Record<string, boolean> = {};

/**
 * 是否已填充。
 *
 * 用**独立标志**而非 `Object.keys(TOOL_FEATURE_FLAGS).length === 0` 判定：
 * 后者在所有 flag 均为 false（或 `TOOL_NAMES` 为空）时会**反复重填**。
 */
let _initialized = false;

/** 确保开关表已填充（幂等；首次调用时才读取 `TOOL_NAMES`） */
function ensureFlags(): Record<string, boolean> {
  if (_initialized) return TOOL_FEATURE_FLAGS;
  for (const toolName of TOOL_NAMES) {
    TOOL_FEATURE_FLAGS[toolName] = getToolFlag(toolName);
  }
  _initialized = true;
  return TOOL_FEATURE_FLAGS;
}

export function isToolEnabled(toolName: string): boolean {
  return ensureFlags()[toolName] ?? false;
}

export function setToolEnabled(toolName: string, enabled: boolean): void {
  ensureFlags()[toolName] = enabled;
}

export function getAllToolFlags(): Record<string, boolean> {
  return { ...ensureFlags() };
}

export function getEnabledTools(): string[] {
  return Object.entries(ensureFlags())
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

export function getDisabledTools(): string[] {
  return Object.entries(ensureFlags())
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
}

export function resetToolFlags(): void {
  _initialized = false;
  ensureFlags();
}
