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
 */

/** 权限模式 ALL 值数组（用于迭代和验证） */
export const PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypass',
  'dontAsk',
  'auto',
  'ask',
  'alwaysAsk',
  'strict',
] as const;

/** 权限模式字符串联合类型 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** 权限模式 const 对象（枚举式访问） */
export const PermissionMode = {
  DEFAULT: 'default',
  ACCEPT_EDITS: 'acceptEdits',
  PLAN: 'plan',
  BYPASS: 'bypass',
  DONT_ASK: 'dontAsk',
  AUTO: 'auto',
  ASK: 'ask',
  ALWAYS_ASK: 'alwaysAsk',
  STRICT: 'strict',
} as const satisfies Record<string, PermissionMode>;

/** 权限模式中文名称映射 */
export const PERMISSION_MODE_NAMES: Record<PermissionMode, string> = {
  default: '默认模式',
  acceptEdits: '接受编辑',
  plan: '计划模式',
  bypass: '绕过模式',
  dontAsk: '不询问',
  auto: '自动模式',
  ask: '询问模式',
  alwaysAsk: '总是询问',
  strict: '严格模式',
};

/** 权限模式符号映射 */
export const PERMISSION_MODE_SYMBOLS: Record<PermissionMode, string> = {
  default: '',
  acceptEdits: '✎',
  plan: '⏸',
  bypass: '⚡',
  dontAsk: '🔇',
  auto: '🔄',
  ask: '❓',
  alwaysAsk: '⚠️',
  strict: '🔒',
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
    case PermissionMode.ASK:
      return '询问模式，每次都询问用户';
    case PermissionMode.ALWAYS_ASK:
      return '总是询问模式，强制询问（即使有规则允许）';
    case PermissionMode.DONT_ASK:
      return '不询问模式，直接拒绝';
    case PermissionMode.BYPASS:
      return '绕过权限检查';
    case PermissionMode.PLAN:
      return '计划模式';
    case PermissionMode.ACCEPT_EDITS:
      return '接受编辑模式，自动批准编辑类操作';
    case PermissionMode.STRICT:
      return '严格模式，大多数操作会被默认拒绝';
    default:
      return '未知权限模式';
  }
}
