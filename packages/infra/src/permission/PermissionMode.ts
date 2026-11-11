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
 * 权限模式定义
 *
 * 同时支持字符串联合类型（类型检查）和 const 对象（运行时枚举访问）。
 * - type PermissionMode           → 字符串联合类型（用于类型注解）
 * - PermissionMode.DEFAULT        → 枚举式值访问（用于 switch 等场景）
 * - PERMISSION_MODES              → 可迭代数组（用于验证/循环）
 *
 * 2026-11-01（B7 解环）：值域（`PERMISSION_MODES` / `PermissionMode` 类型与 const 对象）
 * 已下沉叶子模块 `common/permissionMode`（security 侧也要用），此处**同名转出**；
 * 中文名 / 符号映射与描述函数仍归本模块（属展示层，security 不需要）。
 */

import {
  LEGACY_PERMISSION_MODE_ALIASES,
  PERMISSION_MODES,
  PermissionMode,
  normalizePermissionMode,
} from '@openliri/infra/common';

export {
  LEGACY_PERMISSION_MODE_ALIASES,
  PERMISSION_MODES,
  PermissionMode,
  normalizePermissionMode,
};

/**
 * 权限模式中文名称映射（2026-11-11 收缩为 5 档）
 *
 * `plan` 的语义是"每个工具调用都要你确认"，不是"只读规划"（引擎侧无只读限制）。
 */
export const PERMISSION_MODE_NAMES: Record<PermissionMode, string> = {
  default: '默认模式',
  plan: '每步确认',
  dontAsk: '不询问',
  auto: '自动模式',
  bypass: '全自动',
};

/** 权限模式符号映射 */
export const PERMISSION_MODE_SYMBOLS: Record<PermissionMode, string> = {
  default: '',
  plan: '⏸',
  dontAsk: '🔇',
  auto: '🔄',
  bypass: '⚡',
};

/**
 * 是否应避免权限提示
 * @param mode 权限模式
 * @returns 是否直接拒绝而不提示
 */
export function shouldAvoidPermissionPrompts(mode: PermissionMode): boolean {
  return mode === 'dontAsk';
}

/**
 * 获取权限模式的中文描述
 * @param mode 权限模式
 * @returns 中文描述文字
 */
export function getPermissionModeDescription(mode: PermissionMode): string {
  switch (mode) {
    case PermissionMode.DEFAULT:
      return '默认模式，根据规则和工具特性决定';
    case PermissionMode.AUTO:
      return '自动模式，使用AI分类器进行决策';
    case PermissionMode.DONT_ASK:
      return '不询问模式，直接拒绝';
    case PermissionMode.BYPASS:
      return '绕过权限检查（无条件放行）';
    case PermissionMode.PLAN:
      return '每步确认，每次工具调用都询问用户';
    default:
      return '未知权限模式';
  }
}
