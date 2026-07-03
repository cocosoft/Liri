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
 *       不参与管理 API 的应用级模型配置（由 AppModelConfigService 负责）。
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
 * 与 AppModelConfigService 的关系：
 *   AppModelConfigService 按应用类型（AppModelTarget）从 SQLite 路由，
 *   仅由 ModelManagementAPI 使用，不参与运行时 chat 请求。
 */

import { configManager } from '@modules/config/ConfigManager';
import type { ModelConfig } from '@modules/config/types';
import { handleError } from '@modules/error';
import { Logger, LogLevel } from '@modules/monitoring';
import { ModelRegistry } from '@modules/ai';
import type { APIProvider } from '@modules/ai';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:model-router' });

// ============================================================
// 任务类型枚举
// ============================================================

/** 系统任务类型，与前端 TaskAssignment 严格同步 */
export type TaskType =
  | 'default' // 兜底默认模型（状态栏选择的模型即此值）
  | 'chat' // 日常对话、问题解答
  | 'coding' // 代码生成、调试、审查
  | 'translation' // 多语言翻译、润色
  | 'quick' // 简单问答、摘要（低成本）
  | 'agent' // SubAgent / 自主代理任务
  | 'scheduled' // 定时任务
  | 'local' // 本地模型（Ollama 等）
  | 'embedding' // 文本向量化（知识库）
  | 'image' // 图片生成（DALL-E / Stable Diffusion 等）
  | 'vision' // 图片识别/分析（GPT-4o / Gemini Vision 等）
  | 'video' // 视频生成（Sora / Kling 等）
  | 'tts' // 语音合成（ElevenLabs / OpenAI TTS 等）
  | 'stt' // 语音识别（Whisper / Deepgram 等）
  | 'reranking'; // 重排序（Cohere Rerank / BGE 等）

/** 所有任务类型列表 */
export const ALL_TASK_TYPES: TaskType[] = [
  'default',
  'chat',
  'coding',
  'translation',
  'quick',
  'agent',
  'scheduled',
  'local',
  'embedding',
  'image',
  'vision',
  'video',
  'tts',
  'stt',
  'reranking',
];

// ============================================================
// 配置接口
// ============================================================

/** 任务模型映射配置（与前端 TaskModelConfig 接口对齐） */
export interface TaskModelConfig {
  default?: string;
  chat?: string;
  coding?: string;
  translation?: string;
  quick?: string;
  agent?: string;
  scheduled?: string;
  local?: string;
  embedding?: string;
  image?: string;
  vision?: string;
  video?: string;
  tts?: string;
  stt?: string;
  reranking?: string;
}

/**
 * 任务定义
 * 包含任务类型、显示标签、描述和图标，供前端渲染使用
 */
export interface TaskDefinition {
  type: TaskType;
  label: string;
  description: string;
  icon: string;
}

/**
 * 全量任务定义列表（同源事实来源）
 * 前后端共享此数据，前端 TaskAssignment 页面从 API 拉取
 */
export const TASK_DEFINITIONS: TaskDefinition[] = [
  {
    type: 'default',
    label: '默认',
    description: '未指定任务类型时的兜底模型，状态栏选择的模型即此值',
    icon: '⭐',
  },
  {
    type: 'chat',
    label: '对话',
    description: '日常对话、问题解答',
    icon: '💬',
  },
  {
    type: 'coding',
    label: '编程',
    description: '代码生成、调试、审查',
    icon: '💻',
  },
  {
    type: 'translation',
    label: '翻译',
    description: '多语言翻译、润色',
    icon: '🌐',
  },
  {
    type: 'quick',
    label: '快速',
    description: '简单问答、摘要（低成本）',
    icon: '⚡',
  },
  {
    type: 'agent',
    label: '代理',
    description: 'SubAgent / 自主代理任务',
    icon: '🤖',
  },
  { type: 'scheduled', label: '定时', description: '定时任务', icon: '⏰' },
  {
    type: 'local',
    label: '本地',
    description: '本地模型（Ollama 等）',
    icon: '🖥️',
  },
  {
    type: 'embedding',
    label: '嵌入',
    description: '文本向量化（知识库）',
    icon: '📐',
  },
  {
    type: 'image',
    label: '生图',
    description: '图片生成（DALL-E / Stable Diffusion 等）',
    icon: '🖼️',
  },
  {
    type: 'vision',
    label: '识图',
    description: '图片识别/分析（GPT-4o / Gemini Vision 等）',
    icon: '👁️',
  },
  {
    type: 'video',
    label: '生视频',
    description: '视频生成（Sora / Kling 等）',
    icon: '🎬',
  },
  {
    type: 'tts',
    label: '语音合成',
    description: '文本转语音（ElevenLabs / OpenAI TTS 等）',
    icon: '🔊',
  },
  {
    type: 'stt',
    label: '语音识别',
    description: '语音转文字（Whisper / Deepgram 等）',
    icon: '🎙️',
  },
  {
    type: 'reranking',
    label: '重排序',
    description: '检索结果重排序（Cohere Rerank / BGE 等）',
    icon: '📊',
  },
];

/** ModelRouter 构造选项 */
export interface ModelRouterOptions {
  /** 默认模型 ID（各任务未配置时回退到此值） */
  defaultModel?: string;
}

/**
 * 任务类型 → 所需能力映射
 * 用于启动自引导：从 DB 中查找具有对应能力的模型自动填充任务分工
 */
const TASK_CAPABILITY: Partial<Record<TaskType, string>> = {
  embedding: 'embedding',
  image: 'image_generation',
  vision: 'vision',
  video: 'video_generation',
  tts: 'text_to_speech',
  stt: 'speech_recognition',
  reranking: 'reranking',
};

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

  /** UUID → 模型名 缓存（启动时预加载） */
  private uuidToModelName: Map<string, string> = new Map();

  /** 缓存自引导 Promise，避免重复触发 */
  private _autoDiscoverPromise: Promise<void> | null = null;

  /** 缓存旧配置迁移 Promise，避免重复触发 */
  private _legacyMigrationPromise: Promise<void> | null = null;

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
  // UUID 辅助方法
  // ============================================================

  /** 检测字符串是否为 UUID 格式 */
  private isUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    );
  }

  /** 预加载 UUID→模型名 缓存（从 DB 全量加载） */
  private async preloadUuidCache(): Promise<void> {
    try {
      const { modelPricingService } =
        await import('./models/ModelPricingService');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();
      this.uuidToModelName.clear();
      allModels.forEach((m) => {
        if (m.id) this.uuidToModelName.set(m.id, m.modelId);
      });
      logger.debug(
        `ModelRouter: 已预加载 ${this.uuidToModelName.size} 条 UUID→模型名映射`
      );
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'preloadUuidCache',
      });
      logger.warning('ModelRouter: UUID 缓存预加载失败', {
        error: (err as Error).message,
      });
    }
  }

  /** 失效并重新预加载 UUID 缓存（模型增删后调用） */
  async invalidateUuidCache(): Promise<void> {
    await this.preloadUuidCache();
    logger.debug('ModelRouter: UUID 缓存已刷新');
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 根据任务类型解析模型名
   * 优先级：显式任务配置 > default 兜底 > 当前模型（旧格式） > 硬编码默认
   * UUID 解析：三级兜底（缓存 → 实时 DB 查询 → 原值）
   */
  resolve(taskType: TaskType): string {
    const tasks = this.readTasks();

    // 1. 显式任务分配
    if (tasks[taskType]) {
      const value = tasks[taskType]!;
      // UUID 格式检测：如果是 UUID，解析为模型名
      if (this.isUUID(value)) {
        // 一级：缓存命中
        const modelName = this.uuidToModelName.get(value);
        if (modelName) {
          logger.debug(
            `ModelRouter: 任务 ${taskType} UUID ${value} → ${modelName}`
          );
          return modelName;
        }
        // 二级：缓存未命中，异步预加载，同时返回原值兜底（不断服）
        this.preloadUuidCache();
        logger.warning(
          `ModelRouter: 任务 ${taskType} UUID ${value} 缓存未命中，返回原值兜底`
        );
        return value;
      }
      logger.debug(`ModelRouter: 任务 ${taskType} → ${value}`);
      return value;
    }

    // 2. 非 default 任务回退到 default 兜底
    if (taskType !== 'default' && tasks.default) {
      const defaultVal = tasks.default;
      if (this.isUUID(defaultVal)) {
        const modelName = this.uuidToModelName.get(defaultVal);
        if (modelName) return modelName;
        this.preloadUuidCache();
        return defaultVal;
      }
      logger.debug(`ModelRouter: 任务 ${taskType} 回退默认 → ${defaultVal}`);
      return defaultVal;
    }

    // 3. 回退到当前模型（旧格式兼容）
    const current = this.readCurrentModel();
    if (current) {
      logger.debug(`ModelRouter: 任务 ${taskType} 回退当前模型 → ${current}`);
      return current;
    }

    // 4. 最后回退到硬编码默认值
    logger.debug(
      `ModelRouter: 任务 ${taskType} 使用硬编码默认 → ${this.defaultModel || '(空)'}`
    );
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
      const mapped = registry.getModelNameForProvider(
        modelKey,
        providerId as APIProvider
      );
      if (mapped) {
        logger.debug(
          `ModelRouter: ${modelKey} → ${mapped} (provider: ${providerId})`
        );
        return mapped;
      }
    } catch (err) {
      // registry 不可用时，返回 modelKey 原值
      handleError(err, { module: 'ai:modelRouter', action: 'resolveMapped' });
      logger.warning('ModelRouter: resolveMapped 失败，回退到原始模型名', {
        error: (err as Error).message,
      });
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
   * 设置当前模型 ID（持久化到 GlobalConfig.models.current + tasks.default）
   * 双写确保 resolve() 无论走显式任务匹配还是 default 兜底都能命中
   */
  setCurrentModel(modelId: string): void {
    const current = this.readModelConfig();
    this.writeModelConfig({
      ...current,
      current: modelId,
      tasks: {
        ...(current.tasks || {}),
        default: modelId,
      },
    });
    logger.info(
      `ModelRouter: 当前模型已设置为 ${modelId}（同步写入 tasks.default）`
    );
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
    this.writeModelConfig({
      ...current,
      tasks: tasks as Record<string, string>,
    });
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
    const envModel =
      configManager.env('Liri_MODEL') ||
      configManager.env('DEEPSEEK_MODEL') ||
      configManager.env('AI_MODEL');
    if (envModel) return envModel;

    logger.warn(
      'ModelRouter: 当前模型未配置（models.current / flat key / env 均为空）'
    );
    return '';
  }

  private readTasks(): TaskModelConfig {
    // 优先从结构化 models.tasks 读取
    const models = this.readModelConfig();
    if (models.tasks && Object.keys(models.tasks).length > 0) {
      return models.tasks as TaskModelConfig;
    }

    // 向前兼容：读取旧 flat key models.tasks
    const flatTasks =
      configManager.getConfigValue<TaskModelConfig>('models.tasks');
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

    // 启动自引导：从 DB 中按能力自动匹配模型填充任务分工
    // 异步触发，首次调用返回空，自引导完成后通过 setTasks 写入
    this.triggerAutoDiscover();
    // 旧配置迁移：模型名 → UUID（异步触发）
    this.triggerLegacyMigration();

    // 无任何配置时返回空，由 resolve() 返回明确提示
    logger.warn('ModelRouter: 无任务分工配置，将触发自动发现');
    return {};
  }

  /**
   * 异步触发启动自引导：从 model_registry 扫描模型能力，
   * 自动填充 taskType → modelId 映射并持久化到 config.json
   */
  private triggerAutoDiscover(): void {
    if (this._autoDiscoverPromise) return;
    this._autoDiscoverPromise = this.runAutoDiscover();
  }

  private async runAutoDiscover(): Promise<void> {
    try {
      const { modelPricingService } =
        await import('./models/ModelPricingService');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();

      if (!allModels || allModels.length === 0) {
        logger.info('ModelRouter: 自动发现跳过（无已注册模型）');
        return;
      }

      const tasks: Record<string, string> = {};

      // 为需要特定能力的任务找匹配模型
      for (const [taskType, capability] of Object.entries(TASK_CAPABILITY)) {
        const match = allModels.find(
          (m) => m.enabled && m.capabilities?.includes(capability)
        );
        if (match) {
          tasks[taskType] = match.id || match.modelId; // 优先 UUID，回退模型名
        }
      }

      // 为 chat 类任务找任意可用聊天模型
      const chatTasks: TaskType[] = [
        'default',
        'chat',
        'coding',
        'quick',
        'agent',
        'scheduled',
        'local',
        'translation',
      ];
      const usedModels = new Set(Object.values(tasks));
      const chatModel = allModels.find(
        (m) => m.enabled && !usedModels.has(m.id || m.modelId)
      );
      if (chatModel) {
        for (const t of chatTasks) {
          if (!tasks[t]) tasks[t] = chatModel.id || chatModel.modelId; // 优先 UUID
        }
      }

      if (Object.keys(tasks).length > 0) {
        // 合并而非覆盖：用户手动配置的任务优先保留，仅填充空位
        const existing = this.readTasks();
        const merged: Record<string, string> = { ...tasks };
        for (const [key, val] of Object.entries(existing)) {
          if (val) merged[key] = val;
        }
        this.setTasks(merged as TaskModelConfig);
        logger.info('ModelRouter: 自动发现完成，已合并任务分工', {
          discovered: Object.keys(tasks),
          existing: Object.keys(existing).filter(
            (k) => (existing as Record<string, string | undefined>)[k]
          ),
        });
      } else {
        logger.info('ModelRouter: 自动发现完成（无匹配模型）');
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'runAutoDiscover',
      });
      logger.warn('ModelRouter: 自动发现异常', {
        error: (err as Error).message,
      });
    }
  }

  /** 触发旧配置迁移（仅首次调用） */
  private triggerLegacyMigration(): void {
    if (this._legacyMigrationPromise) return;
    this._legacyMigrationPromise = this.migrateLegacyTaskConfig();
  }

  /**
   * 迁移旧任务配置：模型名 → UUID（批量查询，避免 N+1）
   * 写回失败不阻塞启动，仅记录日志供排查
   */
  private async migrateLegacyTaskConfig(): Promise<void> {
    try {
      const tasks = this.readTasks();
      if (Object.keys(tasks).length === 0) return;

      // 一次性加载所有模型映射
      const { modelPricingService } =
        await import('./models/ModelPricingService');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();
      const nameToUuid = new Map(
        allModels
          .filter((m) => m.id)
          .map((m) => [m.modelId, m.id] as [string, string])
      );

      let migrated = false;
      const newTasks: Record<string, string> = {};

      for (const [taskType, value] of Object.entries(tasks)) {
        if (this.isUUID(value)) {
          newTasks[taskType] = value;
        } else {
          const uuid = nameToUuid.get(value);
          if (uuid) {
            newTasks[taskType] = uuid;
            migrated = true;
          } else {
            newTasks[taskType] = value; // 保留原值
          }
        }
      }

      if (migrated) {
        this.setTasks(newTasks as TaskModelConfig);
        logger.info('ModelRouter: 已完成旧任务配置的 UUID 迁移');
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'migrateLegacyTaskConfig',
      });
      logger.warning('ModelRouter: 旧任务配置 UUID 迁移失败，下次启动重试', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * 检查任务模型的可用性
   * @returns 每个任务对应的模型是否可用
   */
  getTaskAvailability(): Record<
    TaskType,
    { modelId: string; available: boolean; missingCapability?: string }
  > {
    const tasks = this.readTasks();
    const result: Record<
      TaskType,
      { modelId: string; available: boolean; missingCapability?: string }
    > = {} as Record<
      TaskType,
      { modelId: string; available: boolean; missingCapability?: string }
    >;
    for (const taskType of ALL_TASK_TYPES) {
      result[taskType] = {
        modelId: tasks[taskType] || '',
        available: !!tasks[taskType],
      };
    }
    return result;
  }

  /**
   * 校验任务分工：检查分配的模型是否具备对应能力
   *
   * 对每个有特定能力要求的任务（如 image 需要 image_generation），
   * 检查 DB 中注册的模型是否包含所需 capability。
   * 仅校验的任务返回缺失信息，chat 类任务（chat/coding/translation/quick/agent/scheduled/local）
   * 无特定能力要求，始终通过。
   *
   * @returns 校验结果列表，仅包含不通过的任务
   */
  async validateTaskAssignment(): Promise<
    Array<{
      taskType: TaskType;
      modelId: string;
      requiredCapability: string;
      missing: boolean;
    }>
  > {
    const tasks = this.readTasks();
    const issues: Array<{
      taskType: TaskType;
      modelId: string;
      requiredCapability: string;
      missing: boolean;
    }> = [];

    try {
      const { modelPricingService } =
        await import('./models/ModelPricingService');
      await modelPricingService.initialize();
      const allModels = await modelPricingService.getAllPricing();

      for (const [taskType, capability] of Object.entries(TASK_CAPABILITY)) {
        const modelId = (tasks as Record<string, string>)[taskType];
        if (!modelId) continue;

        const model = allModels.find(
          (m) => m.id === modelId || m.modelId === modelId
        );
        if (!model || !model.capabilities?.includes(capability)) {
          issues.push({
            taskType: taskType as TaskType,
            modelId,
            requiredCapability: capability,
            missing: true,
          });
          logger.warning(
            `ModelRouter: 任务 ${taskType} 的模型 ${modelId} 缺少所需能力 ${capability}`
          );
        }
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'validateTaskAssignment',
      });
      logger.warning('ModelRouter: 任务分工校验异常', {
        error: (err as Error).message,
      });
    }

    return issues;
  }
}

/** 全局单例 */
export const modelRouter = ModelRouter.getInstance();
