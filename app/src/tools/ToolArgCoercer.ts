/**
 * ToolArgCoercer — 工具参数类型强制修复
 *
 * P2-2: 对标 hermes-agent coerce_tool_args() 的 7 种类型强制修复。
 * 自动修正 LLM 输出的 JSON 参数偏差，减少 `invalid_tool_input` 错误。
 *
 * 7 种修复：
 *   1. string → int   ("42" → 42)
 *   2. string → bool  ("true"/"false" → true/false)
 *   3. string → number ("3.14" → 3.14)
 *   4. 裸标量 → 单元素列表 (schema expects array)
 *   5. JSON 编码字符串 → 嵌套对象/数组（深层递归）
 *   6. "null" → None (当 schema 允许 null)
 *   7. 多余键去除 (additionalProperties: false 修复)
 *
 * 对标：hermes-agent model_tools.py coerce_tool_args()
 *       PilotDeck validateToolInput.ts
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'tools:argCoercer' });

// ==========================================
// Types
// ==========================================

export interface ToolSchema {
  type: 'object';
  properties?: Record<string, ToolProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolProperty {
  type?: string | string[];
  items?: ToolProperty;
  properties?: Record<string, ToolProperty>;
  description?: string;
  enum?: unknown[];
}

export interface CoerceResult {
  /** 修复后的输入 */
  input: Record<string, unknown>;
  /** 是否做了修改 */
  modified: boolean;
  /** 修改详情 */
  changes: CoerceChange[];
}

export interface CoerceChange {
  key: string;
  original: unknown;
  coerced: unknown;
  reason: string;
}

// ==========================================
// Core Coercer
// ==========================================

export function coerceToolArgs(
  input: Record<string, unknown>,
  schema: ToolSchema
): CoerceResult {
  const changes: CoerceChange[] = [];
  const coerced = { ...input };

  if (!schema.properties) return { input, modified: false, changes: [] };

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!(key in coerced)) continue;
    const value = coerced[key];

    if (value === undefined || value === null) {
      // #6: "null" → None but only if schema allows it
      if (!prop.type) continue;
      const types = Array.isArray(prop.type) ? prop.type : [prop.type];
      if (types.includes('null')) continue; // null is valid
      if (schema.required?.includes(key)) {
        // Required field with null — keep as-is, schema validator will catch
        continue;
      }
      delete coerced[key];
      changes.push({
        key,
        original: value,
        coerced: undefined,
        reason: 'null removed (field not nullable)',
      });
      continue;
    }

    // #1-3: type coercion for scalar values
    if (typeof prop.type === 'string') {
      const coercedValue = coerceScalar(value, prop.type);
      if (coercedValue !== value) {
        coerced[key] = coercedValue;
        changes.push({
          key,
          original: value,
          coerced: coercedValue,
          reason: `${typeof value} coerced to ${prop.type}`,
        });
        continue;
      }
    }

    // #4: scalar → array (schema expects array)
    if (prop.type === 'array' && prop.items && !Array.isArray(value)) {
      coerced[key] = [value];
      changes.push({
        key,
        original: value,
        coerced: [value],
        reason: 'scalar wrapped in array',
      });
      continue;
    }

    // #5: JSON-encoded string → nested object/array (recursive)
    if (
      typeof value === 'string' &&
      (prop.type === 'object' || prop.type === 'array')
    ) {
      const parsed = tryParseJSON(value);
      if (parsed !== undefined) {
        coerced[key] = parsed;
        changes.push({
          key,
          original: value,
          coerced: parsed,
          reason: 'JSON string parsed to object/array',
        });
        continue;
      }
    }
  }

  // #7: Remove extra keys (additionalProperties: false)
  if (schema.additionalProperties === false) {
    const allowedKeys = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(coerced)) {
      if (!allowedKeys.has(key)) {
        const removed = coerced[key];
        delete coerced[key];
        changes.push({
          key,
          original: removed,
          coerced: undefined,
          reason: 'extra key removed (additionalProperties: false)',
        });
      }
    }
  }

  return {
    input: coerced,
    modified: changes.length > 0,
    changes,
  };
}

// ==========================================
// Scalar Coercion
// ==========================================

const TRUE_VALUES = new Set(['true', 'True', 'TRUE', 'yes', 'Yes', 'YES']);
const FALSE_VALUES = new Set(['false', 'False', 'FALSE', 'no', 'No', 'NO']);

function coerceScalar(value: unknown, targetType: string): unknown {
  if (typeof value !== 'string') return value;

  switch (targetType) {
    case 'integer':
    case 'int': {
      // #1: "42" → 42
      const intVal = parseInt(value, 10);
      if (!isNaN(intVal) && String(intVal) === value.trim()) return intVal;
      break;
    }
    case 'number':
    case 'float': {
      // #3: "3.14" → 3.14
      const numVal = parseFloat(value);
      if (!isNaN(numVal)) return numVal;
      break;
    }
    case 'boolean':
    case 'bool': {
      // #2: "true"/"false" → true/false
      if (TRUE_VALUES.has(value)) return true;
      if (FALSE_VALUES.has(value)) return false;
      break;
    }
  }
  return value;
}

// ==========================================
// JSON Parsing (Recursive)
// ==========================================

function tryParseJSON(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Not valid JSON — keep original
    return undefined;
  }
}

// ==========================================
// Convenience
// ==========================================

/**
 * 尝试用 coercion 修复输入，如果失败返回原始输入。
 * 不支持中途失败的严格模式 —— 所有 coercion 都是 best-effort。
 */
export function tryCoerceToolArgs(
  input: Record<string, unknown>,
  schema: ToolSchema
): {
  input: Record<string, unknown>;
  modified: boolean;
  changes: CoerceChange[];
} {
  try {
    const result = coerceToolArgs(input, schema);
    if (result.modified) {
      logger.info('toolArgCoercer:fixed', {
        changes: result.changes.map((c) => `${c.key}: ${c.reason}`),
      });
    }
    return result;
  } catch (err) {
    logger.warn('toolArgCoercer:failed', { error: String(err) });
    return { input, modified: false, changes: [] };
  }
}
