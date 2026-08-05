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
 * SkillPermission（v1.5 阶段 4，修复 P3-15）
 * 技能权限模型：值域枚举 + SKILL.md frontmatter 解析 + 统一校验。
 *
 * 职责边界：SkillGuard 负责签名/来源可信度校验（白名单），
 * 本模块负责权限声明（permissions）的解析与授权校验，两者独立。
 */

/** 权限值域枚举 */
export type SkillPermission =
  | 'network'
  | 'file-write'
  | 'command'
  | 'host-access';

/** 全部权限值 */
export const SKILL_PERMISSIONS: readonly SkillPermission[] = [
  'network',
  'file-write',
  'command',
  'host-access',
];

/** 敏感权限（导入需审批） */
export const SENSITIVE_PERMISSIONS: readonly SkillPermission[] = [
  'file-write',
  'command',
  'host-access',
];

/**
 * 解析 SKILL.md frontmatter 中的 permissions
 * @param rawContent SKILL.md 原文
 * @returns 合法权限列表（未知项忽略）
 */
export function parseSkillPermissions(rawContent: string): SkillPermission[] {
  const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return [];

  let permissions: unknown[] = [];
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^permissions:\s*(.+)$/);
    if (m) {
      // 支持 "permissions: [network, command]" 或 "permissions: network, command"
      const raw = m[1].trim();
      const cleaned = raw.replace(/^\[|\]$/g, '');
      permissions = cleaned
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      break;
    }
  }

  const valid = new Set<SkillPermission>(SKILL_PERMISSIONS);
  return permissions.filter(
    (p): p is SkillPermission =>
      typeof p === 'string' && valid.has(p as SkillPermission)
  );
}

/**
 * 校验权限声明是否合法（全部在枚举内）
 * @param permissions 待校验权限
 * @returns 错误消息（合法返回 null）
 */
export function validateSkillPermissions(
  permissions: unknown[]
): string | null {
  if (!Array.isArray(permissions)) return 'permissions 必须是数组';
  const valid = new Set<SkillPermission>(SKILL_PERMISSIONS);
  for (const p of permissions) {
    if (typeof p !== 'string' || !valid.has(p as SkillPermission)) {
      return `未知权限: ${String(p)}`;
    }
  }
  return null;
}

/**
 * 是否包含敏感权限（需导入审批）
 */
export function hasSensitivePermission(
  permissions: SkillPermission[]
): boolean {
  return permissions.some((p) => SENSITIVE_PERMISSIONS.includes(p));
}
