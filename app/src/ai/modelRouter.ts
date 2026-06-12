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
 * ModelRouter — 统一模型路由层
 *
 * 职责：作为全系统获取模型名的唯一入口，根据任务类型解析出具体模型 ID。
 *       运行时按任务类型（TaskType）从 ConfigManager 静态路由。
 *       不参与管理 API 的应用级模型配置（由 AppModelRouter 负责）。
 * 配置源：ConfigManager（持久化到 config.json），向前兼容 process.env 读取。
 *
 * 设计原则：
 * - 调用方只需告知任务类型，无需关心模型名来源
 * - 为未来智能路由（SmartRouter）预留扩展点：本类的 resolve() 可被子类覆盖
 * - 保持无状态（所有状态来自 ConfigManager），可安全用于各处
 *
 * 与 SmartRouter 的关系：
 *   SmartRouter 持有 ModelRouter 实例作为兜底（fallbackToModelRouter），
 *   当智能路由开关关闭或无配置时回退到此静态路由。
 *
 * 与 AppModelRouter 的关系：
 *   AppModelRouter 按应用类型（AppModelTarget）从 SQLite 路由，
 *   仅由 ModelManagementAPI 使用，不参与运行时 chat 请求。
 */

import { configManager } from '@modules/config/ConfigManager';
import type { ModelConfig } from '@modules/config/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { ModelRegistry } from '@modules/ai/models/ModelRegistry';
import type { APIProvider } from '@modules/ai/models/ModelConfigs';

const logger = new Logger({ level: LogLevel.INFO });

// ============================================================
// 任务类型枚举
// ============================================================

/** 系统任务类型，与前端 TaskAssignment 严格同步 */
export type TaskType =
  | 'chat'        // 日常对话、问题解答
  | 'coding'      // 代码生成、调试、审查
  | 'translation' // 多语言翻译、润色
  | 'quick'       // 简单问答、摘要（低成本）
  | 'agent'       // SubAgent / 自主代理任务
  | 'scheduled'   // 定时任务
  | 'local'       // 本地模型（Ollama 等）
  | 'embedding';  // 文本向量化（知识库）

/**
 * 默认任务分工配置
 * 当 ConfigManager 中无持久化配置时使用此默认值，
 * 确保前后端默认值同源，前端无需硬编码。
 */
export const DEFAULT_TASKS: TaskModelConfig = {
  chat: 'deepseek-v4-pro',
  coding: 'deepseek-v4-pro',
  translation: 'gpt-4o-mini',
  quick: 'deepseek-v4-flash',
  embedding: 'deepseek-v4-pro',
};

/** 所有任务类型列表 */
export const ALL_TASK_TYPES: TaskType[] = [
  'chat',
  'coding',
  'translation',
  'quick',
  'agent',
  'scheduled',
  'local',
  'embedding',
];

// ============================================================
// 配置接口
// ============================================================

/** 任务模型映射配置（与前端 TaskModelConfig 接口对齐） */
export interface TaskModelConfig {
  chat?: string;
  coding?: string;
  translation?: string;
  quick?: string;
  agent?: string;
  scheduled?: string;
  local?: string;
  embedding?: string;
}

/** ModelRouter 构造选项 */
export interface ModelRouterOptions {
  /** 默认模型 ID（各任务未配置时回退到此值） */
  defaultModel?: string;
}

// ============================================================
// ConfigManager 存取 Key
// ============================================================

/** 结构化 models 配置键（GlobalConfig.models） */
const CONFIG_KEY = 'models';

// ============================================================
// ModelRouter
// ============================================================

/**
 * 统一模型路由器
 *
 * 用法：
 * ```ts
 * const router = ModelRouter.getInstance();
 * const modelName = router.resolve('chat');
 * ```
 */
export class ModelRouter {
  private static instance: ModelRouter;
  private defaultModel: string;

  private constructor(options?: ModelRouterOptions) {
    this.defaultModel = options?.defaultModel || '';
  }

  static getInstance(options?: ModelRouterOptions): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter(options);
    }
    return ModelRouter.instance;
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 根据任务类型解析模型名
   * 优先级：任务配置 > 当前模型 > 默认模型
   */
  resolve(taskType: TaskType): string {
    const tasks = this.readTasks();
    const taskModel = tasks[taskType];
    if (taskModel) {
      logger.debug(`ModelRouter: 任务 ${taskType} → ${taskModel}`);
      return taskModel;
    }

    // 回退到当前模型
    const current = this.readCurrentModel();
    if (current) {
      logger.debug(`ModelRouter: 任务 ${taskType} 回退当前模型 → ${current}`);
      return current;
    }

    logger.debug(`ModelRouter: 任务 ${taskType} 使用默认模型 → ${this.defaultModel || '(空)'}`);
    return this.defaultModel;
  }

  /**
   * 根据任务类型解析模型名，并映射为指定提供商的 API 模型名
   *
   * 内部调用 resolve() 获取 internal key，再通过 ModelRegistry
   * getModelNameForProvider() 映射为 provider 专用的 API 模型名。
   * 若映射失败（无记录），fallback 为 internal key 原值。
   *
   * @param taskType - 任务类型
   * @param providerId - 供应商 ID（如 'deepseek'、'ollama'）
   * @returns API 模型名
   */
  resolveMapped(taskType: TaskType, providerId: string): string {
    const modelKey = this.resolve(taskType);
    if (!modelKey || !providerId) return modelKey;

    try {
      const registry = ModelRegistry.getInstance();
      const mapped = registry.getModelNameForProvider(modelKey, providerId as APIProvider);
      if (mapped) {
        logger.debug(`ModelRouter: ${modelKey} → ${mapped} (provider: ${providerId})`);
        return mapped;
      }
    } catch {
      // registry 不可用时，返回 modelKey 原值
    }
    return modelKey;
  }

  /**
   * 获取当前选中的模型 ID
   */
  getCurrentModel(): string {
    return this.readCurrentModel();
  }

  /**
   * 设置当前模型 ID（持久化到 GlobalConfig.models.current）
   */
  setCurrentModel(modelId: string): void {
    const current = this.readModelConfig();
    this.writeModelConfig({ ...current, current: modelId });
    logger.info(`ModelRouter: 当前模型已设置为 ${modelId}`);
  }

  /**
   * 获取所有任务分工配置
   */
  getTasks(): TaskModelConfig {
    return this.readTasks();
  }

  /**
   * 保存任务分工配置（持久化到 GlobalConfig.models.tasks）
   */
  setTasks(tasks: TaskModelConfig): void {
    const current = this.readModelConfig();
    this.writeModelConfig({ ...current, tasks: tasks as Record<string, string> });
    logger.info('ModelRouter: 任务分工已保存', { tasks });
  }

  // ============================================================
  // 内部读取（结构化 models + 向前兼容 flat keys + process.env）
  // ============================================================

  /** 读取 GlobalConfig.models 结构化对象 */
  private readModelConfig(): ModelConfig {
    return configManager.getConfigValue<ModelConfig>(CONFIG_KEY) || {};
  }

  /** 写入 GlobalConfig.models 结构化对象 */
  private writeModelConfig(models: ModelConfig): void {
    configManager.setConfigValue(CONFIG_KEY, models);
  }

  private readCurrentModel(): string {
    // 优先从结构化 models.current 读取
    const models = this.readModelConfig();
    if (models.current) return models.current;

    // 向前兼容：读取旧 flat key models.current
    const flatCurrent = configManager.getConfigValue<string>('models.current');
    if (flatCurrent) return flatCurrent;

    // 向前兼容：读取旧 process.env
    const envModel = configManager.env('Liri_MODEL') || configManager.env('DEEPSEEK_MODEL') || configManager.env('AI_MODEL');
    if (envModel) return envModel;

    return '';
  }

  private readTasks(): TaskModelConfig {
    // 优先从结构化 models.tasks 读取
    const models = this.readModelConfig();
    if (models.tasks && Object.keys(models.tasks).length > 0) {
      return models.tasks as TaskModelConfig;
    }

    // 向前兼容：读取旧 flat key models.tasks
    const flatTasks = configManager.getConfigValue<TaskModelConfig>('models.tasks');
    if (flatTasks && Object.keys(flatTasks).length > 0) return flatTasks;

    // 向前兼容：读取旧 process.env
    const envTasks: TaskModelConfig = {};
    const envMap: Record<string, string | undefined> = {
      chat: configManager.env('Liri_TASK_CHAT'),
      coding: configManager.env('Liri_TASK_CODING'),
      translation: configManager.env('Liri_TASK_TRANSLATION'),
      quick: configManager.env('Liri_TASK_QUICK'),
      embedding: configManager.env('Liri_TASK_EMBEDDING'),
    };
    for (const [key, val] of Object.entries(envMap)) {
      if (val) (envTasks as Record<string, string>)[key] = val;
    }
    if (Object.keys(envTasks).length > 0) return envTasks;

    // 无任何配置时返回系统默认值，确保前后端同源
    logger.info('ModelRouter: 使用默认任务分工配置', DEFAULT_TASKS);
    return { ...DEFAULT_TASKS };
  }
}

/** 全局单例 */
export const modelRouter = ModelRouter.getInstance();
