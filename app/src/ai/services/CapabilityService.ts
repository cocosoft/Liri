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
 * 模型能力服务层
 *
 * 负责能力定义的持久化、缓存和验证。
 * 采用双重持久化策略：YAML 基线 + 数据库覆盖层。
 */

import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath, resolveProjectRoot } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const logger = new Logger({ module: 'ai:capabilities', level: LogLevel.INFO });

/** 数据库表名 */
const CAPABILITIES_TABLE = 'model_capabilities';
const TASK_MAPPINGS_TABLE = 'task_capability_mappings';

/** YAML 配置文件路径 */
const YAML_CONFIG_PATH = path.join(
  resolveProjectRoot(),
  'app',
  'src',
  'ai',
  'config',
  'capabilities.default.yaml'
);

/**
 * 能力分类
 */
export enum CapabilityCategory {
  CORE = 'core',
  VISION = 'vision',
  MEDIA = 'media',
  TOOLS = 'tools',
  SPECIAL = 'special',
}

/**
 * 能力定义接口
 */
export interface ModelCapabilityDefinition {
  /** 能力唯一标识 */
  key: string;
  /** 能力分类 */
  category: CapabilityCategory;
  /** 显示名称（国际化 key） */
  labelKey: string;
  /** 描述（国际化 key） */
  descriptionKey: string;
  /** 显示名称 fallback */
  labelFallback: string;
  /** 描述 fallback */
  descriptionFallback: string;
  /** 是否为默认能力 */
  isDefault: boolean;
  /** 是否启用 */
  enabled: boolean;
  /** 关联的任务类型 */
  taskTypes: string[];
  /** 排序权重 */
  sortOrder: number;
  /** 引入版本 */
  sinceVersion?: string;
  /** 废弃版本 */
  deprecatedSince?: string;
  /** 依赖的其他能力 */
  dependencies: string[];
  /** 乐观锁版本号 */
  version: number;
}

/**
 * 分类定义接口
 */
export interface CapabilityCategoryDefinition {
  key: string;
  labelKey: string;
  sortOrder: number;
}

/**
 * 任务-能力映射定义
 */
export interface TaskCapabilityMapping {
  taskType: string;
  /** AND 语义：必须全部满足 */
  requiredCapabilities: string[];
  /** OR 语义：至少满足其中一个 */
  optionalCapabilities: string[];
  sortOrder: number;
}

/**
 * 验证问题
 */
export interface ValidationIssue {
  type: string;
  taskType?: string;
  modelId?: string;
  capability?: string;
  dependency?: string;
  requiredCapability?: string[];
  optionalCapabilities?: string[];
  message: string;
}

/**
 * CapabilityService
 */
export class CapabilityService {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  /** 内存缓存 */
  private capabilitiesCache: ModelCapabilityDefinition[] = [];
  private categoriesCache: CapabilityCategoryDefinition[] = [];
  private taskMappingsCache: TaskCapabilityMapping[] = [];
  private cacheVersion = '0';

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库和缓存
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 初始化数据库
    await this.initDatabase();

    // 从 YAML 加载默认配置并合并到数据库（幂等）
    await this.mergeYamlToDatabase();

    // 加载到内存缓存
    await this.refreshCache();

    this.initialized = true;
    logger.info('CapabilityService 初始化完成', {
      capabilityCount: this.capabilitiesCache.length,
      categoryCount: this.categoriesCache.length,
      mappingCount: this.taskMappingsCache.length,
    });
  }

  /**
   * 初始化数据库连接和表结构
   */
  private async initDatabase(): Promise<void> {
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.createTables();
  }

  /**
   * 创建数据库表
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'CAPS_001'
      );
    }

    // 创建能力定义表
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE TABLE IF NOT EXISTS ${CAPABILITIES_TABLE} (
          key VARCHAR(64) PRIMARY KEY,
          category VARCHAR(32) NOT NULL,
          label_key VARCHAR(128) NOT NULL,
          description_key VARCHAR(256),
          label_fallback VARCHAR(64) NOT NULL,
          description_fallback VARCHAR(256),
          is_default BOOLEAN DEFAULT FALSE,
          enabled BOOLEAN DEFAULT TRUE,
          task_types TEXT,
          sort_order INTEGER DEFAULT 0,
          since_version VARCHAR(16),
          deprecated_since VARCHAR(16),
          dependencies TEXT,
          version INTEGER DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 创建索引
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE INDEX IF NOT EXISTS idx_capabilities_category ON ${CAPABILITIES_TABLE}(category)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE INDEX IF NOT EXISTS idx_capabilities_enabled ON ${CAPABILITIES_TABLE}(enabled)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 创建任务-能力映射表
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE TABLE IF NOT EXISTS ${TASK_MAPPINGS_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_type VARCHAR(64) NOT NULL UNIQUE,
          required_capabilities TEXT,
          optional_capabilities TEXT,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // 创建索引
    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `CREATE INDEX IF NOT EXISTS idx_task_mappings_type ON ${TASK_MAPPINGS_TABLE}(task_type)`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    logger.info('能力数据库表创建/验证完成');
  }

  /**
   * 从 YAML 加载配置并合并到数据库（幂等）
   */
  private async mergeYamlToDatabase(): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'CAPS_002'
      );
    }

    let yamlData: any;
    try {
      const content = fs.readFileSync(YAML_CONFIG_PATH, 'utf-8');
      yamlData = yaml.load(content);
    } catch (err) {
      logger.error('加载 YAML 配置失败', { error: String(err) });
      // YAML 加载失败不阻塞启动，使用数据库已有数据或空数据
      return;
    }

    // 验证 YAML 结构
    this.validateYamlSchema(yamlData);

    // 合并分类
    if (yamlData.categories) {
      for (const cat of yamlData.categories) {
        // 分类存储在能力表中，不需要单独表
        // 这里只记录到日志，实际分类通过能力的 category 字段体现
      }
    }

    // 合并能力定义
    if (yamlData.capabilities) {
      const dbCapabilities = await this.getAllFromDb();

      for (const yamlCap of yamlData.capabilities) {
        const dbCap = dbCapabilities.find((c) => c.key === yamlCap.key);

        if (!dbCap) {
          // 数据库没有 → insert
          await this.createFromYaml(yamlCap);
        } else {
          // 数据库已有 → 跳过（保留用户覆盖）
          // 如果 YAML 有新增字段但 DB 没有，可选择合并
          continue;
        }
      }

      // 检查废弃能力（YAML 中移除的能力）
      const currentVersion = '0.4.0'; // TODO: 从版本配置获取
      for (const dbCap of dbCapabilities) {
        const yamlCap = yamlData.capabilities.find(
          (c: any) => c.key === dbCap.key
        );
        if (!yamlCap && !dbCap.deprecatedSince) {
          // YAML 没有但 DB 有 → 标记废弃
          await this.update(dbCap.key, { deprecatedSince: currentVersion });
        }
      }
    }

    // 合并任务-能力映射
    if (yamlData.taskMappings) {
      const dbMappings = await this.getTaskMappingsFromDb();

      for (const yamlMapping of yamlData.taskMappings) {
        const dbMapping = dbMappings.find(
          (m) => m.taskType === yamlMapping.taskType
        );

        if (!dbMapping) {
          // 数据库没有 → insert
          await this.createTaskMappingFromYaml(yamlMapping);
        } else {
          // 数据库已有 → 跳过（保留用户覆盖）
          continue;
        }
      }
    }

    logger.info('YAML 配置合并到数据库完成');
  }

  /**
   * 验证 YAML 结构
   */
  private validateYamlSchema(yamlData: unknown): void {
    if (!yamlData || typeof yamlData !== 'object') {
      logger.error('YAML 数据格式无效');
      return;
    }

    const data = yamlData as Record<string, unknown>;

    if (data.capabilities) {
      const caps = data.capabilities as Array<unknown>;
      for (let i = 0; i < caps.length; i++) {
        const cap = caps[i] as Record<string, unknown>;
        if (!cap.key || !cap.category || !cap.labelKey) {
          logger.error(`YAML 能力配置第 ${i + 1} 条缺少必要字段`, { cap });
        }
      }
    }

    if (data.taskMappings) {
      const mappings = data.taskMappings as Array<unknown>;
      for (let i = 0; i < mappings.length; i++) {
        const mapping = mappings[i] as Record<string, unknown>;
        if (!mapping.taskType) {
          logger.error(`YAML 任务映射第 ${i + 1} 条缺少必要字段`, { mapping });
        }
      }
    }
  }

  /**
   * 从 YAML 数据创建能力
   */
  private async createFromYaml(yamlCap: any): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO ${CAPABILITIES_TABLE} (
          key, category, label_key, description_key,
          label_fallback, description_fallback, is_default, enabled,
          task_types, sort_order, since_version, deprecated_since, dependencies, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          yamlCap.key,
          yamlCap.category,
          yamlCap.labelKey || `capability.${yamlCap.key}`,
          yamlCap.descriptionKey || `capability.${yamlCap.key}.desc`,
          yamlCap.labelFallback || yamlCap.key,
          yamlCap.descriptionFallback || '',
          yamlCap.isDefault ? 1 : 0,
          yamlCap.enabled !== false ? 1 : 0,
          JSON.stringify(yamlCap.taskTypes || []),
          yamlCap.sortOrder || 0,
          yamlCap.sinceVersion,
          yamlCap.deprecatedSince,
          JSON.stringify(yamlCap.dependencies || []),
          1,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 从 YAML 数据创建任务映射
   */
  private async createTaskMappingFromYaml(yamlMapping: any): Promise<void> {
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO ${TASK_MAPPINGS_TABLE} (
          task_type, required_capabilities, optional_capabilities, sort_order
        ) VALUES (?, ?, ?, ?)`,
        [
          yamlMapping.taskType,
          JSON.stringify(yamlMapping.requiredCapabilities || []),
          JSON.stringify(yamlMapping.optionalCapabilities || []),
          yamlMapping.sortOrder || 0,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * 刷新内存缓存
   */
  private async refreshCache(): Promise<void> {
    this.capabilitiesCache = await this.getAllFromDb();
    this.taskMappingsCache = await this.getTaskMappingsFromDb();

    // 从能力中提取分类
    const categorySet = new Set<string>();
    for (const cap of this.capabilitiesCache) {
      categorySet.add(cap.category);
    }

    this.categoriesCache = Array.from(categorySet)
      .map((key) => ({
        key,
        labelKey: `capability.category.${key}`,
        sortOrder: this.getCategorySortOrder(key),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // 更新缓存版本
    this.cacheVersion = Date.now().toString();
  }

  /**
   * 获取分类排序顺序
   */
  private getCategorySortOrder(key: string): number {
    const order: Record<string, number> = {
      [CapabilityCategory.CORE]: 1,
      [CapabilityCategory.VISION]: 2,
      [CapabilityCategory.MEDIA]: 3,
      [CapabilityCategory.TOOLS]: 4,
      [CapabilityCategory.SPECIAL]: 5,
    };
    return order[key] || 99;
  }

  // ==================== 公开 API ====================

  /**
   * 获取所有能力定义
   */
  async getAll(params?: { category?: string; enabled?: boolean }): Promise<{
    capabilities: ModelCapabilityDefinition[];
    categories: CapabilityCategoryDefinition[];
    version: string;
    lastModified: string;
  }> {
    let caps = [...this.capabilitiesCache];

    if (params?.category) {
      caps = caps.filter((c) => c.category === params.category);
    }

    if (params?.enabled !== undefined) {
      caps = caps.filter((c) => c.enabled === params.enabled);
    }

    // 按分类和排序权重排序
    caps.sort((a, b) => {
      const catOrder =
        this.getCategorySortOrder(a.category) -
        this.getCategorySortOrder(b.category);
      if (catOrder !== 0) return catOrder;
      return a.sortOrder - b.sortOrder;
    });

    return {
      capabilities: caps,
      categories: this.categoriesCache,
      version: this.cacheVersion,
      lastModified: new Date().toISOString(),
    };
  }

  /**
   * 获取单个能力详情
   */
  async get(key: string): Promise<ModelCapabilityDefinition | null> {
    return this.capabilitiesCache.find((c) => c.key === key) || null;
  }

  /**
   * 创建新能力
   */
  async create(
    definition: Omit<ModelCapabilityDefinition, 'key' | 'version'> & {
      key: string;
    }
  ): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'CAPS_003'
      );
    }

    await new Promise<void>((resolve, reject) => {
      this.db?.run(
        `INSERT INTO ${CAPABILITIES_TABLE} (
          key, category, label_key, description_key,
          label_fallback, description_fallback, is_default, enabled,
          task_types, sort_order, since_version, deprecated_since, dependencies, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          definition.key,
          definition.category,
          definition.labelKey,
          definition.descriptionKey,
          definition.labelFallback,
          definition.descriptionFallback || '',
          definition.isDefault ? 1 : 0,
          definition.enabled ? 1 : 0,
          JSON.stringify(definition.taskTypes || []),
          definition.sortOrder || 0,
          definition.sinceVersion,
          definition.deprecatedSince,
          JSON.stringify(definition.dependencies || []),
          1,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    await this.refreshCache();
    logger.info('能力创建成功', { key: definition.key });
  }

  /**
   * 更新能力定义（乐观锁）
   */
  async update(
    key: string,
    updates: Partial<Omit<ModelCapabilityDefinition, 'key'>>
  ): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'CAPS_004'
      );
    }

    const existing = await this.get(key);
    if (!existing) {
      throw new AppError(
        `能力 ${key} 不存在`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'CAPS_005'
      );
    }

    // 构建更新语句
    const setClauses: string[] = [];
    const values: (string | number)[] = [];

    if (updates.category !== undefined) {
      setClauses.push('category = ?');
      values.push(updates.category);
    }
    if (updates.labelKey !== undefined) {
      setClauses.push('label_key = ?');
      values.push(updates.labelKey);
    }
    if (updates.descriptionKey !== undefined) {
      setClauses.push('description_key = ?');
      values.push(updates.descriptionKey);
    }
    if (updates.labelFallback !== undefined) {
      setClauses.push('label_fallback = ?');
      values.push(updates.labelFallback);
    }
    if (updates.descriptionFallback !== undefined) {
      setClauses.push('description_fallback = ?');
      values.push(updates.descriptionFallback);
    }
    if (updates.isDefault !== undefined) {
      setClauses.push('is_default = ?');
      values.push(updates.isDefault ? 1 : 0);
    }
    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.taskTypes !== undefined) {
      setClauses.push('task_types = ?');
      values.push(JSON.stringify(updates.taskTypes));
    }
    if (updates.sortOrder !== undefined) {
      setClauses.push('sort_order = ?');
      values.push(updates.sortOrder);
    }
    if (updates.sinceVersion !== undefined) {
      setClauses.push('since_version = ?');
      values.push(updates.sinceVersion);
    }
    if (updates.deprecatedSince !== undefined) {
      setClauses.push('deprecated_since = ?');
      values.push(updates.deprecatedSince);
    }
    if (updates.dependencies !== undefined) {
      setClauses.push('dependencies = ?');
      values.push(JSON.stringify(updates.dependencies));
    }

    if (setClauses.length === 0) {
      return;
    }

    // 添加版本检查（乐观锁）
    setClauses.push('version = version + 1');
    values.push(existing.version);

    const result = await new Promise<number>((resolve, reject) => {
      this.db?.run(
        `UPDATE ${CAPABILITIES_TABLE} SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND version = ?`,
        [...values, key, existing.version],
        function (this: { changes: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    if (result === 0) {
      throw new AppError(
        `能力 ${key} 更新冲突，可能已被其他用户修改`,
        ErrorCategory.DATA,
        ErrorSeverity.MEDIUM,
        'CAPS_006'
      );
    }

    await this.refreshCache();
    logger.info('能力更新成功', { key });
  }

  /**
   * 删除能力（软删除）
   */
  async delete(key: string): Promise<void> {
    await this.update(key, { enabled: false });
    logger.info('能力已禁用（软删除）', { key });
  }

  /**
   * 批量创建/更新能力
   */
  async batch(
    data: Array<
      | ModelCapabilityDefinition
      | (Omit<ModelCapabilityDefinition, 'key'> & { key: string })
    >
  ): Promise<void> {
    for (const item of data) {
      const existing = await this.get(item.key);
      if (existing) {
        await this.update(item.key, item);
      } else {
        await this.create(item as ModelCapabilityDefinition);
      }
    }
  }

  /**
   * 获取任务-能力映射
   */
  async getTaskMappings(): Promise<TaskCapabilityMapping[]> {
    return [...this.taskMappingsCache].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  }

  /**
   * 更新任务-能力映射
   */
  async updateTaskMappings(mappings: TaskCapabilityMapping[]): Promise<void> {
    if (!this.db) {
      throw new AppError(
        '数据库未初始化',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'CAPS_007'
      );
    }

    for (const mapping of mappings) {
      const existing = this.taskMappingsCache.find(
        (m) => m.taskType === mapping.taskType
      );

      if (existing) {
        // 更新
        await new Promise<void>((resolve, reject) => {
          this.db?.run(
            `UPDATE ${TASK_MAPPINGS_TABLE} SET 
              required_capabilities = ?, optional_capabilities = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
              WHERE task_type = ?`,
            [
              JSON.stringify(mapping.requiredCapabilities || []),
              JSON.stringify(mapping.optionalCapabilities || []),
              mapping.sortOrder || 0,
              mapping.taskType,
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      } else {
        // 插入
        await new Promise<void>((resolve, reject) => {
          this.db?.run(
            `INSERT INTO ${TASK_MAPPINGS_TABLE} (
              task_type, required_capabilities, optional_capabilities, sort_order
            ) VALUES (?, ?, ?, ?)`,
            [
              mapping.taskType,
              JSON.stringify(mapping.requiredCapabilities || []),
              JSON.stringify(mapping.optionalCapabilities || []),
              mapping.sortOrder || 0,
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    }

    await this.refreshCache();
    logger.info('任务-能力映射更新成功', { count: mappings.length });
  }

  /**
   * 获取分类列表
   */
  async getCategories(): Promise<CapabilityCategoryDefinition[]> {
    return this.categoriesCache;
  }

  /**
   * 验证模型是否具备任务所需的能力
   */
  async validateTaskAssignment(
    taskType: string,
    modelCapabilities: string[]
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // 获取任务映射
    const mapping = this.taskMappingsCache.find((m) => m.taskType === taskType);

    if (!mapping) {
      return [
        {
          type: 'mapping_not_found',
          taskType,
          message: `未找到任务类型 ${taskType} 的能力映射`,
        },
      ];
    }

    // 检查必需能力（AND）
    const missingRequired = mapping.requiredCapabilities.filter(
      (cap) => !modelCapabilities.includes(cap)
    );
    if (missingRequired.length > 0) {
      issues.push({
        type: 'capability_missing',
        taskType,
        requiredCapability: missingRequired,
        message: `模型缺少必需能力: ${missingRequired.join(', ')}`,
      });
    }

    // 检查可选能力（OR）
    if (mapping.optionalCapabilities.length > 0) {
      const hasOptional = mapping.optionalCapabilities.some((cap) =>
        modelCapabilities.includes(cap)
      );
      if (!hasOptional) {
        issues.push({
          type: 'capability_optional_missing',
          taskType,
          optionalCapabilities: mapping.optionalCapabilities,
          message: `模型缺少可选能力（至少需具备一个）: ${mapping.optionalCapabilities.join(', ')}`,
        });
      }
    }

    // 检查能力依赖（递归）
    const dependencyIssues =
      this.validateCapabilityDependencies(modelCapabilities);
    issues.push(...dependencyIssues);

    return issues;
  }

  /**
   * 递归检查能力依赖
   */
  private validateCapabilityDependencies(
    capabilities: string[]
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const capKey of capabilities) {
      const capability = this.capabilitiesCache.find((c) => c.key === capKey);
      if (!capability) continue;

      for (const depKey of capability.dependencies) {
        if (!capabilities.includes(depKey)) {
          issues.push({
            type: 'capability_dependency_missing',
            capability: capKey,
            dependency: depKey,
            message: `能力 ${capKey} 依赖 ${depKey}，但模型未配置`,
          });
        }
      }
    }

    return issues;
  }

  // ==================== 私有数据库操作 ====================

  /**
   * 从数据库获取所有能力
   */
  private async getAllFromDb(): Promise<ModelCapabilityDefinition[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${CAPABILITIES_TABLE}`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(this.mapRowsToDefinitions(rows));
        }
      );
    });
  }

  /**
   * 从数据库获取任务映射
   */
  private async getTaskMappingsFromDb(): Promise<TaskCapabilityMapping[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      this.db?.all(
        `SELECT * FROM ${TASK_MAPPINGS_TABLE}`,
        (err: Error | null, rows: any[]) => {
          if (err) reject(err);
          else resolve(this.mapRowsToMappings(rows));
        }
      );
    });
  }

  /**
   * 将数据库行映射为能力定义
   */
  private mapRowsToDefinitions(rows: any[]): ModelCapabilityDefinition[] {
    return rows.map((row) => ({
      key: row.key,
      category: row.category as CapabilityCategory,
      labelKey: row.label_key,
      descriptionKey: row.description_key,
      labelFallback: row.label_fallback,
      descriptionFallback: row.description_fallback || '',
      isDefault: row.is_default === 1,
      enabled: row.enabled === 1,
      taskTypes: row.task_types ? JSON.parse(row.task_types) : [],
      sortOrder: row.sort_order || 0,
      sinceVersion: row.since_version,
      deprecatedSince: row.deprecated_since,
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      version: row.version || 1,
    }));
  }

  /**
   * 将数据库行映射为任务映射
   */
  private mapRowsToMappings(rows: any[]): TaskCapabilityMapping[] {
    return rows.map((row) => ({
      taskType: row.task_type,
      requiredCapabilities: row.required_capabilities
        ? JSON.parse(row.required_capabilities)
        : [],
      optionalCapabilities: row.optional_capabilities
        ? JSON.parse(row.optional_capabilities)
        : [],
      sortOrder: row.sort_order || 0,
    }));
  }
}

/**
 * 全局单例
 */
let instance: CapabilityService | null = null;

export function getCapabilityService(): CapabilityService {
  if (!instance) {
    instance = new CapabilityService();
  }
  return instance;
}
