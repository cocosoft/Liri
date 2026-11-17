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
 * `permission` 配置段的**写入口守卫**（R1，2026-11-17）
 *
 * 背景（治理方案 §3.1 修正版）：`PUT /v1/config/{key}` 是**通用配置段写入**，
 * `permission` 段承载的是 **B 体系**命令黑白名单、受信任工作区与信任档
 * （`config.json#permission`）；工具规则（A 体系）的唯一写入口是
 * `POST/DELETE /v1/permissions/rules`（落 `tool_rules.json`）。
 *
 * 两者若混写，就会出现"UI 显示 A、实际生效 B"的双套存储 —— 这里在**写入时**拦截
 * A 体系专属字段，并指回唯一入口。只拦**明确属于工具规则**的字段，避免误伤
 * 未来在 `permission` 段新增的配置（拒绝理由可定位到具体字段路径）。
 */

/**
 * 只属于工具规则（`tool_rules.json`）的字段。
 *
 * - `contentPattern` / `inputFingerprint` / `workspaceRoot`：`PermissionRule` 的匹配维度；
 * - `behavior`：规则档位（`allow|ask|deny`）—— `permission` 段用的是 `mode`
 *   （`default|strict|permissive`）与命令黑白名单的 `mode`（`whitelist|blacklist`），
 *   不负载 `behavior`。
 */
export const TOOL_RULE_ONLY_FIELDS = [
  'contentPattern',
  'inputFingerprint',
  'workspaceRoot',
  'behavior',
] as const;

export interface ToolRuleFieldHit {
  /** 命中的字段名 */
  field: string;
  /** 命中位置（如 `customRules.commandRules.blacklist[0].contentPattern`） */
  path: string;
}

/**
 * 深扫配置值，找出第一个工具规则专属字段。
 *
 * @param value 待写入的 `permission` 配置值（对象 / 数组 / 标量）
 * @returns 命中字段与路径；无命中 ⇒ `null`
 */
export function findToolRuleField(value: unknown): ToolRuleFieldHit | null {
  const fields = new Set<string>(TOOL_RULE_ONLY_FIELDS);

  const walk = (
    node: unknown,
    path: string,
    depth: number
  ): ToolRuleFieldHit | null => {
    // 深度上限：配置段是浅结构；超出即视为异常负载，不再深挖（宁可放过也不栈溢出）
    if (depth > 8 || node === null || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const hit = walk(node[i], `${path}[${i}]`, depth + 1);
        if (hit) return hit;
      }
      return null;
    }

    for (const [key, child] of Object.entries(
      node as Record<string, unknown>
    )) {
      const childPath = path ? `${path}.${key}` : key;
      if (fields.has(key)) return { field: key, path: childPath };
      const hit = walk(child, childPath, depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  return walk(value, '', 0);
}
