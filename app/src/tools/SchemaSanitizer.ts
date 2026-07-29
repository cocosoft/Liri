/**
 * SchemaSanitizer — 跨模型 JSON Schema 兼容性净化
 *
 * P2-3: 对标 hermes-agent schema_sanitizer.py
 * 修复对 llama.cpp GBNF 语法、Ollama 限制不兼容的 Schema 特性。
 *
 * 净化规则：
 *   1. 移除 $defs/$ref（内联展开）— llama.cpp 不支持
 *   2. 移除 oneOf/anyOf/allOf 组合 — GBNF 不支持
 *   3. 扁平化嵌套 object（深度>3层）
 *   4. 移除 format 字段 — Ollama 不支持
 *   5. 移除 default 值 — GBNF 不支持
 *   6. 限制 enum 长度（>50时合并为描述）
 *   7. 移除 patternProperties — 不可靠
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'tools:schemaSanitizer' });

export interface SanitizeOptions {
  /** 目标提供商 */
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'local' | 'auto';
  /** 是否扁平化深层嵌套 */
  flattenDeepNesting?: boolean;
  /** enum 最大保留数 */
  maxEnumSize?: number;
}

export interface SanitizeResult {
  schema: Record<string, unknown>;
  modified: boolean;
  changes: string[];
}

/**
 * P2-3: 净化 JSON Schema 以兼容目标模型
 */
export function sanitizeSchema(
  schema: Record<string, unknown>,
  options: SanitizeOptions = { provider: 'auto' }
): SanitizeResult {
  const changes: string[] = [];
  const cleaned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  // Rule 1: Remove $defs/$ref (llama.cpp doesn't support)
  if (
    '$defs' in cleaned &&
    ['ollama', 'local', 'auto'].includes(options.provider)
  ) {
    delete cleaned.$defs;
    changes.push('removed $defs');
  }
  if ('$ref' in cleaned && options.provider !== 'anthropic') {
    delete cleaned.$ref;
    changes.push('removed $ref');
  }

  // Rule 2: Remove oneOf/anyOf/allOf (GBNF unsupported)
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (
      key in cleaned &&
      ['ollama', 'local', 'auto'].includes(options.provider)
    ) {
      delete cleaned[key];
      changes.push(`removed ${key}`);
    }
  }

  // Rule 4: Remove format (Ollama unsupported)
  if (options.provider === 'ollama' || options.provider === 'auto') {
    if (removeFormatFields(cleaned, [])) {
      changes.push('removed format fields');
    }
  }

  // Rule 5: Remove default values (GBNF unsupported)
  if (['ollama', 'local', 'auto'].includes(options.provider)) {
    if (removeDefaultValues(cleaned, [])) {
      changes.push('removed default values');
    }
  }

  // Rule 6: Limit enum size
  const maxEnum = options.maxEnumSize ?? 50;
  if (truncateEnums(cleaned, maxEnum, [])) {
    changes.push(`truncated large enums (max ${maxEnum})`);
  }

  // Rule 7: Remove patternProperties
  if (removePatternProperties(cleaned, [])) {
    changes.push('removed patternProperties');
  }

  // P2-3 Rule 3: 扁平化深度>3 的嵌套 object
  if (options.flattenDeepNesting !== false) {
    if (flattenDeepNesting(cleaned, [], 0, 3)) {
      changes.push('flattened deep nesting (>3 levels)');
    }
  }

  if (changes.length > 0) {
    logger.info('schema:sanitized', { changes, provider: options.provider });
  }

  return { schema: cleaned, modified: changes.length > 0, changes };
}

// ==========================================
// Recursive helpers
// ==========================================

/**
 * P2-3 Rule 3: 扁平化深度>3 的嵌套 object 属性
 * 将深层嵌套的属性提升到上一级，用点号连接键名
 */
function flattenDeepNesting(
  obj: Record<string, unknown>,
  path: string[],
  depth: number,
  maxDepth: number
): boolean {
  if (!obj.properties || typeof obj.properties !== 'object') return false;

  let modified = false;
  const props = obj.properties as Record<string, unknown>;
  const keysToFlatten: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (value && typeof value === 'object') {
      const child = value as Record<string, unknown>;
      if (
        child.type === 'object' &&
        child.properties &&
        typeof child.properties === 'object'
      ) {
        if (depth >= maxDepth) {
          keysToFlatten.push(key);
        } else if (
          flattenDeepNesting(child, [...path, key], depth + 1, maxDepth)
        ) {
          modified = true;
        }
      }
    }
  }

  if (keysToFlatten.length > 0) {
    for (const key of keysToFlatten) {
      const child = props[key] as Record<string, unknown>;
      const childProps = child.properties as Record<string, unknown>;
      for (const [childKey, childValue] of Object.entries(childProps)) {
        const flatKey = `${key}.${childKey}`;
        props[flatKey] = childValue;
      }
      delete props[key];
    }
    modified = true;
  }

  return modified;
}

const FORMAT_FIELDS = [
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
];

function removeFormatFields(
  obj: Record<string, unknown>,
  path: string[]
): boolean {
  let modified = false;
  for (const f of FORMAT_FIELDS) {
    if (f in obj) {
      delete obj[f];
      modified = true;
    }
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [k, v] of Object.entries(
      obj.properties as Record<string, unknown>
    )) {
      if (v && typeof v === 'object') {
        if (removeFormatFields(v as Record<string, unknown>, [...path, k]))
          modified = true;
      }
    }
  }
  if (obj.items && typeof obj.items === 'object') {
    if (
      removeFormatFields(obj.items as Record<string, unknown>, [
        ...path,
        'items',
      ])
    )
      modified = true;
  }
  return modified;
}

function removeDefaultValues(
  obj: Record<string, unknown>,
  path: string[]
): boolean {
  let modified = false;
  if ('default' in obj) {
    delete obj.default;
    modified = true;
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [k, v] of Object.entries(
      obj.properties as Record<string, unknown>
    )) {
      if (v && typeof v === 'object') {
        if (removeDefaultValues(v as Record<string, unknown>, [...path, k]))
          modified = true;
      }
    }
  }
  return modified;
}

function truncateEnums(
  obj: Record<string, unknown>,
  maxSize: number,
  path: string[]
): boolean {
  let modified = false;
  if (Array.isArray(obj.enum) && obj.enum.length > maxSize) {
    const enumArr = obj.enum as unknown[];
    const originalLen = enumArr.length;
    obj.enum = enumArr.slice(0, maxSize);
    (obj as Record<string, unknown>).description =
      `${obj.description ?? ''} (truncated from ${originalLen} values, showing first ${maxSize})`.trim();
    modified = true;
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [k, v] of Object.entries(
      obj.properties as Record<string, unknown>
    )) {
      if (v && typeof v === 'object') {
        if (truncateEnums(v as Record<string, unknown>, maxSize, [...path, k]))
          modified = true;
      }
    }
  }
  return modified;
}

function removePatternProperties(
  obj: Record<string, unknown>,
  path: string[]
): boolean {
  let modified = false;
  if ('patternProperties' in obj) {
    delete obj.patternProperties;
    modified = true;
  }
  if (obj.properties && typeof obj.properties === 'object') {
    for (const [k, v] of Object.entries(
      obj.properties as Record<string, unknown>
    )) {
      if (v && typeof v === 'object') {
        if (removePatternProperties(v as Record<string, unknown>, [...path, k]))
          modified = true;
      }
    }
  }
  return modified;
}
