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

/* eslint-disable @typescript-eslint/no-explicit-any -- legacy code with dynamic types */
/**
 * Schema 加载器 — SchemaLoader
 *
 * 从 YAML 文件加载实体/关系/xref 定义，提供运行时校验。
 * 这是对现有 KnowledgeCompiler 自由格式编译的补充，
 * 它处理的是结构化 YAML → 类型安全的数据定义。
 *
 * Schema 目录结构：
 *   ~/.pyapp/knowledge/.schema/
 *   ├── entities.yaml    实体类型定义
 *   ├── edges.yaml       关系类型定义
 *   └── xref.yaml        双向链接契约
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { resolveKnowledgeDir, resolveDomainSchemaDir } from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO });

/** 默认 schema 目录名（用户知识库根目录下的隐藏目录） */
const SCHEMA_DIR_NAME = '.schema';

/**
 * 字段定义
 */
export interface FieldDef {
  /** 字段类型 */
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  /** 是否必填 */
  required?: boolean;
  /** 字段描述 */
  description?: string;
  /** 可选示例 */
  example?: string;
}

/**
 * 实体类型定义
 */
export interface EntitySchema {
  /** 实体种类标识 */
  kind: string;
  /** 显示名称 */
  displayName: string;
  /** 描述 */
  description: string;
  /** 字段定义表 */
  fields: Record<string, FieldDef>;
  /** 是否叶子节点（不可再关联子实体） */
  terminal?: boolean;
}

/**
 * 关系类型定义
 */
export interface EdgeSchema {
  /** 关系类型标识 */
  type: string;
  /** 显示名称 */
  displayName: string;
  /** 端点约束 */
  endpoints: {
    /** 源实体类型 */
    from: string;
    /** 目标实体类型 */
    to: string;
  };
  /** 方向：directed（有向）| symmetric（对称） */
  direction: 'directed' | 'symmetric';
  /** 关系上的属性 */
  attributes?: Record<string, FieldDef>;
}

/**
 * 双向链接契约
 */
export interface XrefRule {
  /** 源关系类型 */
  from: string;
  /** 目标关系类型 */
  to: string;
  /** 是否自动建立反向边 */
  auto: boolean;
  /** 可选的目标实体类型白名单 */
  terminalTargets?: string[];
}

/**
 * Schema 容器（一次 loadAll 的完整结果）
 */
export interface SchemaContainer {
  /** 实体类型映射 */
  entities: Map<string, EntitySchema>;
  /** 关系类型映射 */
  edges: Map<string, EdgeSchema>;
  /** 链接契约列表 */
  xref: XrefRule[];
}

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否通过 */
  valid: boolean;
  /** 错误信息列表 */
  errors: string[];
}

/**
 * Schema 加载器
 * 从指定目录加载 YAML schema 定义文件
 *
 * Domain-First 模式下，通过 domainName 指定域：
 *   schema 路径为 ~/.pyapp/knowledge/domains/{domain}/.schema/
 *   若域 schema 不存在，fallback 到全局 ~/.pyapp/knowledge/.schema/
 */
export class SchemaLoader {
  private schemaDir: string;
  private domainName?: string;

  /**
   * @param schemaDir schema 目录路径，默认 ~/.pyapp/knowledge/.schema/
   * @param domainName 域名称（可选）。指定后优先读域 schema，fallback 到全局
   */
  constructor(schemaDir?: string, domainName?: string) {
    this.domainName = domainName;

    if (schemaDir) {
      this.schemaDir = schemaDir;
    } else if (domainName) {
      // 域模式：优先读域专属 schema 目录
      this.schemaDir = resolveDomainSchemaDir(domainName);
    } else {
      this.schemaDir = join(resolveKnowledgeDir(), SCHEMA_DIR_NAME);
    }
  }

  /**
   * 获取域名称（可能为空）
   */
  getDomainName(): string | undefined {
    return this.domainName;
  }

  /**
   * 获取 schema 目录路径
   */
  getSchemaDir(): string {
    return this.schemaDir;
  }

  /**
   * 加载 schema 目录下的所有 YAML 文件
   * @returns SchemaContainer（entities / edges / xref）
   */
  async loadAll(): Promise<SchemaContainer> {
    this.ensureDefaults();

    const entities = await this.loadEntities();
    const edges = await this.loadEdges();
    const xref = await this.loadXref();

    return { entities, edges, xref };
  }

  /**
   * 加载 entities.yaml
   */
  async loadEntities(): Promise<Map<string, EntitySchema>> {
    const filePath = join(this.schemaDir, 'entities.yaml');
    const map = new Map<string, EntitySchema>();

    if (!existsSync(filePath)) {
      logger.info('entities.yaml 不存在，返回空映射');
      return map;
    }

    try {
      const doc = load(readFileSync(filePath, 'utf-8')) as any;
      if (!doc || !Array.isArray(doc.entities)) {
        logger.warning('entities.yaml 格式无效：缺少 entities 数组');
        return map;
      }

      for (const item of doc.entities) {
        if (item.kind) {
          map.set(item.kind, item as EntitySchema);
        }
      }
      logger.info(`已加载 ${map.size} 个实体类型定义`);
    } catch (err) {
      await handleError(err, {
        module: 'knowledge:schema',
        action: 'load_entity_schemas',
      });
    }

    return map;
  }

  /**
   * 加载 edges.yaml
   */
  async loadEdges(): Promise<Map<string, EdgeSchema>> {
    const filePath = join(this.schemaDir, 'edges.yaml');
    const map = new Map<string, EdgeSchema>();

    if (!existsSync(filePath)) {
      logger.info('edges.yaml 不存在，返回空映射');
      return map;
    }

    try {
      const doc = load(readFileSync(filePath, 'utf-8')) as any;
      if (!doc || !Array.isArray(doc.edges)) {
        logger.warning('edges.yaml 格式无效：缺少 edges 数组');
        return map;
      }

      for (const item of doc.edges) {
        if (item.type) {
          map.set(item.type, item as EdgeSchema);
        }
      }
      logger.info(`已加载 ${map.size} 个关系类型定义`);
    } catch (err) {
      void handleError(err, {
        module: 'knowledge:schema',
        action: 'load_edge_schemas',
      });
    }

    return map;
  }

  /**
   * 加载 xref.yaml
   */
  async loadXref(): Promise<XrefRule[]> {
    const filePath = join(this.schemaDir, 'xref.yaml');

    if (!existsSync(filePath)) {
      logger.info('xref.yaml 不存在，返回空列表');
      return [];
    }

    try {
      const doc = load(readFileSync(filePath, 'utf-8')) as any;
      if (!doc || !Array.isArray(doc.xref)) {
        logger.warning('xref.yaml 格式无效：缺少 xref 数组');
        return [];
      }

      logger.info(`已加载 ${doc.xref.length} 个链接契约`);
      return doc.xref as XrefRule[];
    } catch (err) {
      await handleError(err, {
        module: 'knowledge:schema',
        action: 'load_xref',
      });
      return [];
    }
  }

  /**
   * 校验数据是否符合某实体类型的 schema
   * @param kind 实体类型标识
   * @param data 待校验的数据
   * @param entityMap 实体类型映射（从 loadAll/loadEntities 获得）
   * @returns 校验结果
   */
  validateEntity(
    kind: string,
    data: Record<string, unknown>,
    entityMap: Map<string, EntitySchema>
  ): ValidationResult {
    const schema = entityMap.get(kind);
    if (!schema) {
      return { valid: false, errors: [`未知实体类型: ${kind}`] };
    }

    const errors: string[] = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
      const value = data[fieldName];

      // 必填字段检查
      if (
        fieldDef.required &&
        (value === undefined || value === null || value === '')
      ) {
        errors.push(`${kind}.${fieldName}: 必填字段缺失`);
        continue;
      }

      // 类型检查（有值时）
      if (value !== undefined && value !== null) {
        if (!this.checkType(value, fieldDef.type)) {
          errors.push(
            `${kind}.${fieldName}: 类型不匹配，期望 ${fieldDef.type}`
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 校验值的类型
   */
  private checkType(value: unknown, expected: string): boolean {
    switch (expected) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number';
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return (
          typeof value === 'object' && value !== null && !Array.isArray(value)
        );
      case 'date':
        return value instanceof Date || !isNaN(Date.parse(String(value)));
      default:
        return true;
    }
  }

  /**
   * 确保默认 schema 文件存在
   * 首次调用时在 schema 目录下创建开箱即用的 YAML 定义
   */
  private ensureDefaults(): void {
    if (existsSync(this.schemaDir)) return;

    mkdirSync(this.schemaDir, { recursive: true });

    // entities.yaml
    const entitiesYaml = `# 实体类型定义 — 开箱即用
entities:
  - kind: note
    displayName: 笔记
    description: 笔记/文档
    fields:
      title:        { type: string,  required: true,  description: 标题 }
      content:      { type: string,  required: true,  description: 正文 }
      tags:         { type: array,   required: false, description: 标签列表 }
      created_at:   { type: date,    required: false, description: 创建时间 }
      updated_at:   { type: date,    required: false, description: 更新时间 }

  - kind: person
    displayName: 人物
    description: 人物/角色
    fields:
      name:         { type: string,  required: true,  description: 姓名 }
      alias:        { type: string,  required: false, description: 别名 }
      role:         { type: string,  required: false, description: 角色/身份 }
      tags:         { type: array,   required: false, description: 标签列表 }

  - kind: project
    displayName: 项目
    description: 项目/任务
    fields:
      name:         { type: string,  required: true,  description: 项目名称 }
      status:       { type: string,  required: false, description: 状态 }
      priority:     { type: string,  required: false, description: 优先级 }
      tags:         { type: array,   required: false, description: 标签列表 }

  - kind: topic
    displayName: 话题
    description: 话题/主题
    fields:
      name:         { type: string,  required: true,  description: 话题名称 }
      summary:      { type: string,  required: false, description: 摘要 }
      tags:         { type: array,   required: false, description: 标签列表 }
`;
    writeFileSync(join(this.schemaDir, 'entities.yaml'), entitiesYaml, 'utf-8');

    // edges.yaml
    const edgesYaml = `# 关系类型定义 — 开箱即用
edges:
  - type: relates_to
    displayName: 关联到
    endpoints: { from: note, to: note }
    direction: symmetric
    attributes:
      weight: { type: number, required: false, description: 关联强度 }

  - type: mentions
    displayName: 提及
    endpoints: { from: note, to: person }
    direction: directed
    attributes:
      context: { type: string, required: false, description: 上下文 }

  - type: created_by
    displayName: 创建者
    endpoints: { from: note, to: person }
    direction: directed

  - type: part_of
    displayName: 属于
    endpoints: { from: note, to: project }
    direction: directed

  - type: wiki_link
    displayName: Wiki 链接
    description: 知识库页面间的 [[link]] 双向链接
    endpoints: { from: note, to: note }
    direction: symmetric
    attributes:
      source: { type: string, required: false, description: 来源标识 }
`;
    writeFileSync(join(this.schemaDir, 'edges.yaml'), edgesYaml, 'utf-8');

    // xref.yaml
    const xrefYaml = `# 双向链接契约 — 开箱即用
xref:
  - from: mentions
    to: created_by
    auto: true
    bidirectional: true
  - from: relates_to
    to: relates_to
    auto: true
    bidirectional: true
`;
    writeFileSync(join(this.schemaDir, 'xref.yaml'), xrefYaml, 'utf-8');

    logger.info('默认 schema 文件已创建', { path: this.schemaDir });
  }
}
