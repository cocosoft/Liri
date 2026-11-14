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
 * safeSkillId（v1.5 阶段 4，修复 P3-1/P3-4）
 * 技能 ID 白名单校验：拦截路径穿越、绝对路径、Windows 保留设备名与非法字符。
 */

/** Windows 保留设备名（不区分大小写） */
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

/** 非法字符（Windows 文件名禁止） */
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1F]/;

/**
 * 校验技能 ID 是否安全
 * @param skillId 原始 ID
 * @returns 错误消息（合法返回 null）
 */
export function validateSkillId(skillId: string): string | null {
  if (!skillId || typeof skillId !== 'string') {
    return '技能 ID 不能为空';
  }

  const trimmed = skillId.trim();
  if (trimmed !== skillId) {
    return '技能 ID 不能包含首尾空白';
  }

  // 路径穿越与分隔符
  if (
    skillId.includes('..') ||
    skillId.includes('/') ||
    skillId.includes('\\')
  ) {
    return '技能 ID 不能包含路径分隔符或 ..';
  }

  // 绝对路径（Windows 盘符 / Unix 根）
  if (/^[a-zA-Z]:/.test(skillId) || skillId.startsWith('/')) {
    return '技能 ID 不能是绝对路径';
  }

  // Windows 非法字符
  if (ILLEGAL_CHARS.test(skillId)) {
    return '技能 ID 包含非法字符（<>:"/\\|?*）';
  }

  // Windows 保留设备名（含扩展名前缀，如 CON.txt 也不允许）
  const baseName = skillId.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED.has(baseName)) {
    return `技能 ID 使用了 Windows 保留名: ${baseName}`;
  }

  return null;
}

/**
 * 安全化技能 ID：非法字符替换为下划线
 * 用于本地创建时清洗 name → 目录名
 */
export function sanitizeSkillId(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+/, '');
}
