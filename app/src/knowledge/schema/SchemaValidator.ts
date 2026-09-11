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
 * SchemaValidator —— 本体 YAML 的只读诊断
 *
 * 与 `SchemaLoader` 的分工：
 * - `SchemaLoader` 面向**运行时**：解析失败/缺字段一律静默忽略（返回空映射），保证抽取链路不被打断；
 * - 本模块面向**给人看的诊断**：把同一条数据上的问题**逐项收集**出来（缺 `kind`/`type`、端点指向未声明
 *   的实体类型、重复定义、YAML 语法错…），供前端/CLI 展示。
 *
 * 只读保证：读取统一走 `readSchemaRawDoc()`（`existsSync` + `readFileSync` + 解析），
 * **不调用 `SchemaLoader.loadAll()`**（那会触发 `ensureDefaults()` 写盘）。
 */

import { getLogger } from '@modules/monitoring';
import { SchemaLoader, readSchemaRawDoc } from './SchemaLoader';

const logger = getLogger('knowledge:schema:validator');

/** 单个校验问题 */
export interface SchemaIssue {
  level: 'error' | 'warning';
  file: 'entities.yaml' | 'edges.yaml' | 'xref.yaml';
  /** 条目序号（1 起，仅条目级问题有） */
  item?: number;
  message: string;
}

/** 校验结果 */
export interface SchemaValidationResult {
  ok: boolean;
  errors: SchemaIssue[];
  warnings: SchemaIssue[];
  /** 解析出的条目数（容错后的实际生效值） */
  summary: { entities: number; edges: number; xref: number };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class SchemaValidator {
  private schemaDir: string;
  /**
   * D1/B2：待保存内容覆盖（fileName → YAML 文本）
   *
   * 用于"保存前校验尚未落盘的内容"：给定覆盖项用覆盖内容，其余文件仍读磁盘
   * （语义 = 最终状态 = 磁盘现状 + 本文件被替换）。**不新增第二套校验实现**。
   */
  private overrides: Map<string, string>;
  /**
   * D6-4：**逐文件来源目录**（fileName → 目录）
   *
   * 与 `SchemaLoader.loadGraphSchemas()` 的"域→全局**逐文件**兜底"对齐：
   * 域目录有该文件就用域目录，否则用全局目录。
   * 未指定的文件回落到 `schemaDir`。
   */
  private fileDirs: Map<string, string>;

  constructor(
    schemaDir?: string,
    overrides?: Partial<
      Record<'entities.yaml' | 'edges.yaml' | 'xref.yaml', string>
    >,
    fileDirs?: Partial<
      Record<'entities.yaml' | 'edges.yaml' | 'xref.yaml', string>
    >
  ) {
    // 复用 SchemaLoader 的路径解析（保持"编译管线读同一目录"的单一事实来源）
    this.schemaDir = schemaDir ?? new SchemaLoader().getSchemaDir();
    this.overrides = new Map(
      Object.entries(overrides ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
    this.fileDirs = new Map(
      Object.entries(fileDirs ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  }

  getSchemaDir(): string {
    return this.schemaDir;
  }

  validate(): SchemaValidationResult {
    const errors: SchemaIssue[] = [];
    const warnings: SchemaIssue[] = [];

    const entityKinds = this.validateEntities(errors, warnings);
    this.validateEdges(errors, warnings, entityKinds);
    this.validateXref(errors, warnings);

    const result: SchemaValidationResult = {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: {
        entities: entityKinds.size,
        edges: this.lastEdgeCount,
        xref: this.lastXrefCount,
      },
    };
    logger.info('本体 schema 校验完成', {
      schemaDir: this.schemaDir,
      errors: errors.length,
      warnings: warnings.length,
    });
    return result;
  }

  private lastEdgeCount = 0;
  private lastXrefCount = 0;

  /** 解析文件并返回 doc；文件缺失返回 undefined；解析失败记录 error */
  private readDoc(
    fileName: 'entities.yaml' | 'edges.yaml' | 'xref.yaml',
    errors: SchemaIssue[]
  ): Record<string, unknown> | undefined {
    // D1/B2：优先校验"待保存内容"，否则读磁盘（读取实现唯一：readSchemaRawDoc）
    // D6-4：来源目录**逐文件**判定（域目录有该文件用域，否则回落到全局）
    const dir = this.fileDirs.get(fileName) ?? this.schemaDir;
    const raw = readSchemaRawDoc(dir, fileName, this.overrides.get(fileName));
    if (raw.status === 'missing') return undefined;
    if (raw.status === 'not_mapping') {
      errors.push({
        level: 'error',
        file: fileName,
        message: '文件内容不是 YAML 映射（顶层应为键值结构）',
      });
      return undefined;
    }
    if (raw.status === 'parse_error') {
      errors.push({
        level: 'error',
        file: fileName,
        message: `YAML 解析失败：${raw.error}`,
      });
      return undefined;
    }
    return raw.doc;
  }

  /** @returns 已声明的实体 kind 集合 */
  private validateEntities(
    errors: SchemaIssue[],
    warnings: SchemaIssue[]
  ): Set<string> {
    const kinds = new Set<string>();
    const doc = this.readDoc('entities.yaml', errors);
    if (!doc) {
      warnings.push({
        level: 'warning',
        file: 'entities.yaml',
        message: '文件不存在 → 实体类型不受约束（freeform 语义）',
      });
      return kinds;
    }
    const list = doc.entities;
    if (!Array.isArray(list)) {
      errors.push({
        level: 'error',
        file: 'entities.yaml',
        message: '顶层缺少 entities 数组',
      });
      return kinds;
    }
    list.forEach((raw, index) => {
      const item = asRecord(raw);
      if (!item) {
        errors.push({
          level: 'error',
          file: 'entities.yaml',
          item: index + 1,
          message: '条目不是映射（应为 { kind, displayName, ... }）',
        });
        return;
      }
      if (!isNonEmptyString(item.kind)) {
        errors.push({
          level: 'error',
          file: 'entities.yaml',
          item: index + 1,
          message: '缺少 kind（运行时该条会被静默忽略）',
        });
        return;
      }
      if (kinds.has(item.kind)) {
        warnings.push({
          level: 'warning',
          file: 'entities.yaml',
          item: index + 1,
          message: `kind "${item.kind}" 重复定义（后定义覆盖前者）`,
        });
      }
      kinds.add(item.kind);
    });
    return kinds;
  }

  private validateEdges(
    errors: SchemaIssue[],
    warnings: SchemaIssue[],
    entityKinds: Set<string>
  ): void {
    this.lastEdgeCount = 0;
    const doc = this.readDoc('edges.yaml', errors);
    if (!doc) {
      warnings.push({
        level: 'warning',
        file: 'edges.yaml',
        message: '文件不存在 → 关系类型不受约束（所有抽取出的边都会保留）',
      });
      return;
    }
    const list = doc.edges;
    if (!Array.isArray(list)) {
      errors.push({
        level: 'error',
        file: 'edges.yaml',
        message: '顶层缺少 edges 数组',
      });
      return;
    }
    const seenTypes = new Set<string>();
    list.forEach((raw, index) => {
      const item = asRecord(raw);
      if (!item) {
        errors.push({
          level: 'error',
          file: 'edges.yaml',
          item: index + 1,
          message: '条目不是映射（应为 { type, endpoints: { from, to } }）',
        });
        return;
      }
      if (!isNonEmptyString(item.type)) {
        errors.push({
          level: 'error',
          file: 'edges.yaml',
          item: index + 1,
          message: '缺少 type（运行时该条会被静默忽略）',
        });
        return;
      }
      if (seenTypes.has(item.type)) {
        warnings.push({
          level: 'warning',
          file: 'edges.yaml',
          item: index + 1,
          message: `type "${item.type}" 重复定义（后定义覆盖前者）`,
        });
      }
      seenTypes.add(item.type);
      this.lastEdgeCount++;

      const endpoints = asRecord(item.endpoints);
      if (!endpoints) {
        errors.push({
          level: 'error',
          file: 'edges.yaml',
          item: index + 1,
          message: `type "${item.type}" 缺少 endpoints: { from, to }（运行时端点校验会被跳过）`,
        });
        return;
      }
      for (const side of ['from', 'to'] as const) {
        const value = endpoints[side];
        if (!isNonEmptyString(value)) {
          errors.push({
            level: 'error',
            file: 'edges.yaml',
            item: index + 1,
            message: `type "${item.type}" 的 endpoints.${side} 缺失或非字符串`,
          });
          continue;
        }
        // 仅在 entities.yaml 已声明时才做交叉校验（否则无从比对）
        // D1/B2a（§11.4 语义层）：指向未声明 kind = 该端点约束永远匹配不上 →
        // 属错误（保存被拒），而非告警。范围仅限"编辑/保存"链路；
        // 运行时（D7）仍是"只告警 + 计数"，不放宽也不收紧抽取链路。
        if (entityKinds.size > 0 && !entityKinds.has(value)) {
          errors.push({
            level: 'error',
            file: 'edges.yaml',
            item: index + 1,
            message: `type "${item.type}" 的 endpoints.${side} = "${value}" 未在 entities.yaml 中声明 → 该端点约束永远匹配不上`,
          });
        }
      }
    });
  }

  private validateXref(errors: SchemaIssue[], warnings: SchemaIssue[]): void {
    this.lastXrefCount = 0;
    const doc = this.readDoc('xref.yaml', errors);
    if (!doc) {
      warnings.push({
        level: 'warning',
        file: 'xref.yaml',
        message: '文件不存在 → 无双向链接契约（可选，不影响抽取）',
      });
      return;
    }
    const list = doc.xref;
    if (!Array.isArray(list)) {
      errors.push({
        level: 'error',
        file: 'xref.yaml',
        message: '顶层缺少 xref 数组',
      });
      return;
    }
    this.lastXrefCount = list.length;
  }
}
