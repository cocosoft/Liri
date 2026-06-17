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
 * Schema 展平与重新嵌套
 *
 * DeepSeek V3/R1 丢弃超过 2 层嵌套或 10 个叶子的 schema。
 * 在发送前展平为点路径，接收后重新嵌套回原始结构。
 *
 * 借鉴: DeepSeek-Reasonix src/repair/flatten.ts
 */

import type { JSONSchema, FlattenDecision } from './types';

/**
 * 分析 schema 是否需要展平
 * 条件: 叶节点数 > 10 或 最大深度 > 2
 */
export function analyzeSchema(schema: JSONSchema | undefined): FlattenDecision {
  if (!schema) return { shouldFlatten: false, leafCount: 0, maxDepth: 0 };
  let leafCount = 0;
  let maxDepth = 0;
  walk(schema, 0, (depth, isLeaf) => {
    if (isLeaf) leafCount++;
    if (depth > maxDepth) maxDepth = depth;
  });
  return {
    shouldFlatten: leafCount > 10 || maxDepth > 2,
    leafCount,
    maxDepth,
  };
}

/**
 * 展平 schema：将深层嵌套属性转换为 "a.b.c" 格式的点路径
 */
export function flattenSchema(schema: JSONSchema): JSONSchema {
  const flatProps: Record<string, JSONSchema> = {};
  const required: string[] = [];
  collect('', schema, flatProps, required, true);
  return {
    type: 'object',
    properties: flatProps,
    required,
  };
}

/**
 * 重新嵌套：将展平的点路径参数还原为嵌套结构
 */
export function nestArguments(
  flatArgs: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flatArgs)) {
    setByPath(out, key.split('.'), value);
  }
  return out;
}

// ─── 内部遍历 ──────────────────────────────────────────────────────────────

function walk(
  schema: JSONSchema,
  depth: number,
  visit: (depth: number, isLeaf: boolean) => void
): void {
  if (schema.type === 'object' && schema.properties) {
    for (const child of Object.values(schema.properties)) {
      walk(child, depth + 1, visit);
    }
    return;
  }
  if (schema.type === 'array' && schema.items) {
    walk(schema.items, depth + 1, visit);
    return;
  }
  visit(depth, true);
}

function collect(
  prefix: string,
  schema: JSONSchema,
  out: Record<string, JSONSchema>,
  required: string[],
  isRootRequired: boolean
): void {
  if (schema.type === 'object' && schema.properties) {
    const requiredSet = new Set(schema.required ?? []);
    for (const [key, child] of Object.entries(schema.properties)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      const childRequired = isRootRequired && requiredSet.has(key);
      collect(nextPrefix, child, out, required, childRequired);
    }
    return;
  }
  // 非 object 类型（包括 array）视为叶子节点
  out[prefix] = schema;
  if (isRootRequired) required.push(prefix);
}

function setByPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (typeof cur[key] !== 'object' || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[path[path.length - 1]!] = value;
}
