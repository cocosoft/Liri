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
 * PatchApplier —— 配置补丁应用器（配置层叠 5.3 模块）
 *
 * 删除语义（配置层叠方案 11.1 P0-2/P0-3 决策，方案 C）：
 * - 现有 common.deepMerge 不支持 null 删除（null 以字面值写入）；
 * - 本模块自实现「墓碑机制」：patch 中 `key: null` 为删除标记，
 *   合并后统一 post-process 将该 key 从最终对象**物理移除**（穿透低层值）。
 *
 * 不修改 common.deepMerge / ConfigManager 合并逻辑（避免全项目回归）。
 */

export interface PatchApplyResult {
  config: Record<string, unknown>;
  /** 本次应用实际删除的 key 路径（点号分隔），供 dump --layers / 日志可观测 */
  deletedKeys: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 深合并补丁到 base（null 标记删除，不写入值；其余按深合并覆盖）。
 * 数组整体替换（补丁值覆盖 base 数组）。
 */
function deepMergeForPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      // 删除标记：不在此写入，由墓碑后处理物理移除
      continue;
    }
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeForPatch(
        result[key] as Record<string, unknown>,
        value
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** 墓碑后处理：沿 patch 的 null 路径，从 config 物理移除 key（穿透低层值） */
function removeTombstoned(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  deletedKeys: string[]
): void {
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null) {
      if (key in config) {
        delete config[key];
        deletedKeys.push(path);
      }
      continue;
    }
    if (isPlainObject(value) && isPlainObject(config[key])) {
      removeTombstoned(
        config[key] as Record<string, unknown>,
        value,
        path,
        deletedKeys
      );
    }
  }
}

/**
 * 应用补丁（墓碑删除语义）。
 *
 * @param base 被补丁的基础配置对象（不修改原对象）
 * @param patch 补丁对象（`key: null` = 删除标记）
 * @returns 合并后新对象 + 删除的 key 路径列表
 */
export function applyPatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): PatchApplyResult {
  const config = deepMergeForPatch(base, patch);
  const deletedKeys: string[] = [];
  removeTombstoned(config, patch, '', deletedKeys);
  return { config, deletedKeys };
}

/**
 * 顺序应用多个补丁（后层覆盖前层），并聚合所有删除路径。
 *
 * @param base 基础配置
 * @param patches 按优先级升序排列的补丁列表（最后一个优先级最高）
 */
export function applyPatches(
  base: Record<string, unknown>,
  patches: Array<Record<string, unknown>>
): PatchApplyResult {
  let config = base;
  const deletedKeys: string[] = [];
  for (const patch of patches) {
    const result = applyPatch(config, patch);
    config = result.config;
    deletedKeys.push(...result.deletedKeys);
  }
  return { config, deletedKeys };
}
