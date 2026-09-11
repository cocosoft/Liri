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
 * schemaFormModel —— 表单模式的结构化模型 ↔ YAML 文本（D1 = C 混合编辑器的服务端一半）
 *
 * 分工原则（方案 §11.6 归一化）：
 * - **YAML 的解析与序列化只存在于服务端**（js-yaml），前端不引入第二套 YAML 实现；
 * - 前端表单只编辑**结构化模型**（本轮编辑 kind/displayName/description 与
 *   endpoints/direction），`PUT /schema/{file}` 接受 `{ model }` 后由本模块 dump 成 YAML，
 *   再走与"原始 YAML 模式"**完全相同**的校验 + 备份 + 原子写链路。
 *
 * 防"静默丢字段"（方案 §11.2）：
 * - 行内**未知键原样保留**（表单改的是同一份对象，不是重建对象）；
 * - 但**顶层出现表单无法表达的键**、或条目不是映射、或解析出 JSON 无法往返的值（如
 *   js-yaml 把时间戳解析成 `Date`）时 → `expressible: false` + 原因，前端据此**禁用**表单切换，
 *   禁止有损转换。
 *
 * 已知限制：js-yaml `dump()` 不保留注释与原始排版（YAML 语义等价，仅注释丢失）。
 */

import { dump } from 'js-yaml';
import { getLogger } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { readSchemaRawDoc } from './SchemaLoader';

const logger = getLogger('knowledge:schema:form');

/** 表单目前覆盖的本体文件（xref 归 B2c） */
export type FormSchemaFile = 'entities.yaml' | 'edges.yaml';

/** 文件 → 顶层数组键 */
const ARRAY_KEY: Record<FormSchemaFile, string> = {
  'entities.yaml': 'entities',
  'edges.yaml': 'edges',
};

/** 表单可表达性判定结果 */
export interface FormModelSupport {
  expressible: boolean;
  /** 不可表达时的原因（面向用户，前端直接展示） */
  reason?: string;
  /** 可表达时的行数据（原样保留未知键） */
  rows?: Array<Record<string, unknown>>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 递归探测"JSON 往返会改变语义"的值。
 *
 * js-yaml 默认 schema 会把 ISO 时间戳解析成 `Date`；经 HTTP JSON 传输后会变成字符串，
 * dump 回去就成了带引号的字符串 —— 属静默语义变更，必须拒绝表单化。
 *
 * @returns 首个不安全值的路径；全部安全时返回 null
 */
function findUnsafeValue(value: unknown, path: string): string | null {
  if (value instanceof Date) return path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnsafeValue(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (record) {
    for (const [key, nested] of Object.entries(record)) {
      const found = findUnsafeValue(nested, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 把磁盘上解析出的 doc 转成表单模型
 *
 * @param file 目标文件
 * @param doc  已解析的 YAML 文档（`undefined` = 文件不存在或为空 → 视为可表达的空表）
 */
export function toFormModel(
  file: FormSchemaFile,
  doc: Record<string, unknown> | undefined
): FormModelSupport {
  const key = ARRAY_KEY[file];
  if (!doc) return { expressible: true, rows: [] };

  const extraKeys = Object.keys(doc).filter((k) => k !== key);
  if (extraKeys.length > 0) {
    return {
      expressible: false,
      reason: `顶层含表单无法表达的键：${extraKeys.join('、')}`,
    };
  }

  const list = doc[key];
  if (!Array.isArray(list)) {
    return {
      expressible: false,
      reason: `顶层缺少 ${key} 数组（请改用原始 YAML 模式）`,
    };
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < list.length; index++) {
    const row = asRecord(list[index]);
    if (!row) {
      return {
        expressible: false,
        reason: `${key}[${index + 1}] 不是映射条目（请改用原始 YAML 模式）`,
      };
    }
    const unsafe = findUnsafeValue(row, `${key}[${index + 1}]`);
    if (unsafe) {
      return {
        expressible: false,
        reason: `${unsafe} 的值无法用表单往返（请改用原始 YAML 模式）`,
      };
    }
    rows.push(row);
  }
  return { expressible: true, rows };
}

/**
 * 读取磁盘上的本体文件并转成表单模型
 *
 * ⚠️ 文件**存在但无法解析**时必须返回 `expressible: false`：否则前端展示空表，
 * 用户一保存就把原本的内容覆盖成空 —— 属静默毁数据。
 */
export function formSupportFor(
  schemaDir: string,
  file: FormSchemaFile
): FormModelSupport {
  const raw = readSchemaRawDoc(schemaDir, file);
  if (raw.status === 'missing') return toFormModel(file, undefined);
  if (raw.status === 'ok') return toFormModel(file, raw.doc);
  return {
    expressible: false,
    reason:
      raw.status === 'parse_error'
        ? `YAML 解析失败：${raw.error}`
        : '文件内容不是 YAML 映射（顶层应为键值结构）',
  };
}

/** 表单模型不合法（交由 handler 映射为 400） */
function invalidModel(message: string): AppError {
  return new AppError(
    message,
    ErrorCategory.VALIDATION,
    ErrorSeverity.LOW,
    'SCHEMA_INVALID_MODEL',
    { module: 'knowledge:schema:form' }
  );
}

/**
 * 把表单模型序列化回 YAML 文本
 *
 * @throws AppError(VALIDATION) 当 rows 不是"映射条目数组"时
 */
export function fromFormModel(file: FormSchemaFile, rows: unknown): string {
  if (!Array.isArray(rows)) {
    throw invalidModel(`${ARRAY_KEY[file]} 应为数组`);
  }
  const list = rows.map((row, index) => {
    const record = asRecord(row);
    if (!record) {
      throw invalidModel(`${ARRAY_KEY[file]}[${index + 1}] 应为映射条目`);
    }
    return record;
  });

  const yaml = dump(
    { [ARRAY_KEY[file]]: list },
    { lineWidth: 100, noRefs: true, quotingType: '"' }
  );
  logger.info('表单模型已序列化为 YAML', { file, rows: list.length });
  return yaml;
}
