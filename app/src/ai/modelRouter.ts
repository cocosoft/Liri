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

import { handleError } from '@modules/error/handleError.js';
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { ModelRegistry } from './models/ModelRegistry.js';
import type { APIProvider } from './models/ModelConfigs.js';
import type { AppModelConfigService } from './models/AppModelConfigService';
import {
  dependencyRegistry,
  DepChange,
} from '@modules/context/DependencyRegistry.js';

const logger = getLogger('ai:model-router');

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
  | 'ocr' // 文字识别/提取（EasyOCR / PaddleOCR / GPT-4o Vision 等）
  | 'text_to_video' // 文生视频（Sora / Kling T2V 等）
  | 'image_to_video' // 图生视频（Kling I2V / Runway 等）
  | 'video' // 视频生成（兼容旧配置，优先用 text_to_video / image_to_video）
  | 'tts' // 语音合成（ElevenLabs / OpenAI TTS 等）
  | 'stt' // 语音识别（Whisper / Deepgram 等）
  | 'reranking' // 重排序（Cohere Rerank / BGE 等）
  | 'knowledge_compile'; // 知识库编译（raw 文档 → many-to-many wiki 页面）

/** PDCA 阶段上下文（S3 ModelPhaseRouter） */
export type PdcaPhase = 'plan' | 'do' | 'check' | 'act';

export interface PhaseContext {
  phase: PdcaPhase;
  confidence?: number; // 意图置信度 0~1，<0.7 时建议降级
}

/** 阶段 → TaskType 默认映射 */
export const DEFAULT_PHASE_TASK_MAP: Record<PdcaPhase, TaskType> = {
  plan: 'coding', // 规划阶段用推理强模型（用户可改为 reasoning 专用模型）
  do: 'quick', // 执行阶段用性价比模型
  check: 'chat', // 审查阶段用默认对话模型（结合 temperature 控制）
  act: 'chat', // 总结/反馈用默认模型
};

/** PDCA 阶段枚举（持久化 app_type = phase_<phase>） */
export const PHASE_KEYS: PdcaPhase[] = ['plan', 'do', 'check', 'act'];

/**
 * S3: 从用户消息内容推断 PDCA 阶段（关键词匹配，MVP 方案）
 * 增强方案可用 embedding 语义相似度替代关键词匹配
 */
export function detectPhase(content: string): PhaseContext | undefined {
  const text = content.slice(0, 500); // 仅分析前 500 字符

  // Plan: 分析、设计、规划、调研
  if (
    /分析|设计|规划|方案|架构|调研|评估|选型|比较|对比|review.*方案|设计.*模式/.test(
      text
    )
  ) {
    return { phase: 'plan', confidence: 0.75 };
  }

  // Do: 实现、写代码、修改、修复、开发
  if (
    /实现|写.*代码|开发|修改|修复|创建|新建|添加|删除|重构|迁移|升级|集成|配置/.test(
      text
    )
  ) {
    return { phase: 'do', confidence: 0.75 };
  }

  // Check: 检查、验证、测试、审查
  if (
    /检查|验证|测试|审查|review|排查|调试|debug|问题|报错|错误|bug|异常/.test(
      text
    )
  ) {
    return { phase: 'check', confidence: 0.75 };
  }

  // Act: 优化、改进、总结、调整
  if (
    /优化|改进|改善|总结|调整|整理|归纳|文档|readme|changelog|发布|部署/.test(
      text
    )
  ) {
    return { phase: 'act', confidence: 0.75 };
  }

  return undefined;
}

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
  'ocr',
  'text_to_video',
  'image_to_video',
  'video',
  'tts',
  'stt',
  'reranking',
  'knowledge_compile',
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
  ocr?: string;
  text_to_video?: string;
  image_to_video?: string;
  video?: string;
  tts?: string;
  stt?: string;
  reranking?: string;
  knowledge_compile?: string;
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
    type: 'ocr',
    label: 'OCR',
    description: '文字识别/提取（EasyOCR / PaddleOCR / GPT-4o Vision 等）',
    icon: '🔤',
  },
  {
    type: 'text_to_video',
    label: '文生视频',
    description: '文字生成视频（Sora / Kling / Wan T2V 等）',
    icon: '📝→🎬',
  },
  {
    type: 'image_to_video',
    label: '图生视频',
    description: '图片生成视频（Kling I2V / Runway / Wan I2V 等）',
    icon: '🖼️→🎬',
  },
  {
    type: 'video',
    label: '生视频',
    description: '视频生成（兼容旧配置，建议改用文生视频/图生视频）',
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
  {
    type: 'knowledge_compile',
    label: '知识库编译',
    description: '知识库定时/手动编译（raw 文档 → many-to-many wiki 页面生成）',
    icon: '📚',
  },
];

/** ModelRouter 构造选项 */
export interface ModelRouterOptions {
  /** 默认模型 ID（各任务未配置时回退到此值） */
  defaultModel?: string;
}

/**
 * 任务→能力映射的兜底值（仅 CapabilityService 不可用时生效）。
 * 键名与 capabilities.default.yaml / types.ts CapabilityKey 标准集合一致
 * （能力类任务）；运行时映射优先来自 CapabilityService（DB task_capability_mappings）。
 * 用于启动自引导：从 DB 中查找具有对应能力的模型自动填充任务分工。
 */
const DEFAULT_TASK_CAPABILITY: Partial<Record<TaskType, string[]>> = {
  embedding: ['embedding'],
  image: ['image_generation'],
  vision: ['vision'],
  text_to_video: ['text_to_video'],
  image_to_video: ['image_to_video'],
  video: ['video_generation'],
  tts: ['text_to_speech'],
  stt: ['speech_recognition'],
  reranking: ['reranking'],
};

/** 动态任务-能力映射缓存 */
let taskCapabilityMapping: Partial<Record<TaskType, string[]>> = {
  ...DEFAULT_TASK_CAPABILITY,
};

/** 从 CapabilityService 刷新任务-能力映射 */
async function refreshTaskCapabilityMapping(): Promise<void> {
  try {
    const { getCapabilityService } =
      await import('./services/CapabilityService.js');
    const service = getCapabilityService();
    await service.init();

    const mappings = await service.getTaskMappings();
    const newMapping: Partial<Record<TaskType, string[]>> = {};

    for (const mapping of mappings) {
      // 将 requiredCapabilities 和 optionalCapabilities 合并
      const allCaps = [
        ...mapping.requiredCapabilities,
        ...mapping.optionalCapabilities,
      ];
      if (allCaps.length > 0) {
        newMapping[mapping.taskType as TaskType] = allCaps;
      }
    }

    // 合并默认值（配置中没有的使用默认值）
    taskCapabilityMapping = { ...DEFAULT_TASK_CAPABILITY, ...newMapping };

    logger.debug('ModelRouter: 任务-能力映射已从 CapabilityService 刷新', {
      mappings: Object.keys(taskCapabilityMapping),
    });
  } catch (err) {
    void handleError(err, {
      module: 'ai:model-router',
      action: 'refreshCapabilityMapping',
    });
    taskCapabilityMapping = { ...DEFAULT_TASK_CAPABILITY };
  }
}

/** 获取任务所需的能力列表 */
function getTaskCapabilities(taskType: TaskType): string[] {
  return taskCapabilityMapping[taskType] || [];
}

/** 检查任务是否需要特定能力 */
function isCapabilityTask(taskType: TaskType): boolean {
  return getTaskCapabilities(taskType).length > 0;
}

// ============================================================
// ModelRouter
// ============================================================

/**
 * 统一模型路由器
 *
 * 用法：
 * ```ts
 * const router = ModelRouter.getInstance();
 * await router.initFromDb();  // 启动时调用一次
 * const modelName = router.resolve('chat');
 * ```
 *
 * 数据源：DB ai_app_model_configs 表（数出同源）
 * resolve() 依赖内存缓存，initFromDb() 后可用。
 */
export class ModelRouter {
  private static instance: ModelRouter;
  private defaultModel: string;

  /** UUID → 模型名 缓存（启动时预加载） */
  private uuidToModelName: Map<string, string> = new Map();

  /** 任务类型 → 模型 ID（DB 内存缓存，resolve() 同步读取） */
  private _taskCache: Map<string, string> = new Map();

  /** 当前模型 ID（DB 内存缓存） */
  private _currentModel: string = '';

  /** DB 是否已加载 */
  private _dbReady = false;

  /** 缓存自引导 Promise，避免重复触发 */
  private _autoDiscoverPromise: Promise<void> | null = null;

  /** 缓存旧配置迁移 Promise，避免重复触发 */
  private _legacyMigrationPromise: Promise<void> | null = null;

  /** S3: 用户自定义阶段→模型直配映射（值为模型 UUID 或模型名；空则回退 DEFAULT_PHASE_TASK_MAP） */
  private _phaseMapping: Partial<Record<PdcaPhase, string>> = {};

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
  // DB 初始化 + 内存缓存
  // ============================================================

  /**
   * 从 DB 加载任务分工到内存缓存（启动时调用一次）
   *
   * 加载顺序：
   * 1. 从 DB ai_app_model_configs 读取所有任务配置
   * 2. 若 DB 为空，尝试从 config.json 迁移（一次性）
   * 3. 填充 _taskCache 和 _currentModel
   *
   * 必须在使用 resolve() 之前调用。
   */
  async initFromDb(): Promise<void> {
    if (this._dbReady) return;

    try {
      const { appModelConfigService } =
        await import('./models/AppModelConfigService.js');
      await appModelConfigService.initialize();

      await this._loadTaskCacheFromDb(appModelConfigService);

      // S3: 加载阶段→模型直配映射（持久化在 ai_app_model_configs，app_type = phase_<phase>）
      await this._loadPhaseMappingFromDb(appModelConfigService);

      if (this._taskCache.size === 0) {
        await this._migrateFromConfigJson(appModelConfigService);
      }

      await this.preloadUuidCache();

      // 刷新任务-能力映射（从 CapabilityService）
      await refreshTaskCapabilityMapping();

      this.triggerAutoDiscover();
      // 一次性迁移旧任务配置（模型名 → UUID），不阻塞启动
      this.triggerLegacyMigration();

      this._dbReady = true;
      logger.info('ModelRouter: DB 初始化完成', {
        taskCount: this._taskCache.size,
        currentModel: this._currentModel || '(未设置)',
      });
    } catch (err) {
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'initFromDb',
      });
      this._dbReady = true;
    }
  }

  /**
   * 从 DB 重新加载任务缓存（模型删除 / 外部变更后调用）
   */
  async refreshTaskCache(): Promise<void> {
    try {
      const { appModelConfigService } =
        await import('./models/AppModelConfigService.js');
      await appModelConfigService.initialize();
      await this._loadTaskCacheFromDb(appModelConfigService);

      // T2.2: 全量刷新后发布任务模型变更通知
      this.notifyAllTaskChanges();
      logger.debug('ModelRouter: 任务缓存已刷新');
    } catch (err) {
      void handleError(err, {
        module: 'ai:model-router',
        action: 'refreshTaskCache',
      });
    }
  }

  /**
   * 清理指定模型的任务分工引用（模型删除时级联清理）
   */
  async cleanupTaskRef(modelId: string): Promise<void> {
    try {
      const { appModelConfigService } =
        await import('./models/AppModelConfigService.js');
      await appModelConfigService.initialize();

      for (const taskType of ALL_TASK_TYPES) {
        const config = await appModelConfigService.getConfig(taskType);
        if (config && config.model === modelId) {
          await appModelConfigService.deleteConfig(taskType);
          this._taskCache.delete(taskType);
          // T2.2: 模型删除 → 该任务依赖被 withdraw（订阅方按预停用处理）
          dependencyRegistry.withdraw(`model:${taskType}`);
          logger.info('ModelRouter: 级联清理任务引用', {
            taskType,
            modelId,
          });
        }
      }

      // S3: 级联清理阶段直配映射引用
      for (const phase of PHASE_KEYS) {
        const config = await appModelConfigService.getConfig(`phase_${phase}`);
        if (config && config.model === modelId) {
          await appModelConfigService.deleteConfig(`phase_${phase}`);
          delete this._phaseMapping[phase];
          logger.info('ModelRouter: 级联清理阶段引用', { phase, modelId });
        }
      }

      const currentConfig = await appModelConfigService.getConfig('current');
      if (currentConfig && currentConfig.model === modelId) {
        await appModelConfigService.deleteConfig('current');
        this._currentModel = '';
        // T2.2: current 模型删除 → default 依赖 withdraw（若 default 也引用该模型）
        dependencyRegistry.withdraw(`model:default`);
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:model-router',
        action: 'cleanupTaskRef',
        context: { modelId },
      });
    }
  }

  /** 从 DB 加载任务配置到内存缓存 */
  private async _loadTaskCacheFromDb(
    svc: AppModelConfigService
  ): Promise<void> {
    this._taskCache.clear();

    for (const taskType of ALL_TASK_TYPES) {
      const config = await svc.getConfig(taskType);
      if (config?.model) {
        this._taskCache.set(taskType, config.model);
      }
    }

    const currentConfig = await svc.getConfig('current');
    if (currentConfig?.model) {
      this._currentModel = currentConfig.model;
    }
  }

  /** 从 DB 加载阶段→模型直配映射（app_type = phase_<phase>） */
  private async _loadPhaseMappingFromDb(
    svc: AppModelConfigService
  ): Promise<void> {
    this._phaseMapping = {};
    for (const phase of PHASE_KEYS) {
      const config = await svc.getConfig(`phase_${phase}`);
      if (config?.model) {
        this._phaseMapping[phase] = config.model;
      }
    }
  }

  /**
   * 从 config.json 迁移到 DB（一次性）
   */
  private async _migrateFromConfigJson(
    svc: AppModelConfigService
  ): Promise<void> {
    try {
      const { configManager } = await import('@modules/config');

      const models = configManager.getConfigValue<{
        current?: string;
        tasks?: Record<string, string>;
      }>('models');

      if (!models) return;

      let migrated = 0;

      if (models.tasks && Object.keys(models.tasks).length > 0) {
        for (const [taskType, modelId] of Object.entries(models.tasks)) {
          if (modelId) {
            await svc.setConfig(taskType, { model: modelId });
            this._taskCache.set(taskType, modelId);
            migrated++;
          }
        }
      }

      if (models.current) {
        await svc.setConfig('current', { model: models.current });
        this._currentModel = models.current;
        migrated++;
      }

      if (migrated > 0) {
        logger.info('ModelRouter: 已从 config.json 迁移到 DB', {
          taskCount: Object.keys(models.tasks || {}).length,
          hasCurrent: !!models.current,
        });
      }
    } catch (err) {
      void handleError(err, {
        module: 'ai:model-router',
        action: 'migrateFromConfigJson',
      });
    }
  }

  // ============================================================
  // 公共 API — 模型解析
  // ============================================================

  /**
   * 根据任务类型解析模型名
   * 优先级：显式任务配置 > default 兜底 > 当前模型（旧格式） > 硬编码默认
   * UUID 解析：三级兜底（缓存 → 预加载重试 → 空字符串）
   *   返回空字符串（非 UUID 原文）防止下游 getByModel(UUID) 匹配失败
   *
   * 性能埋点：同步高频方法，仅当单次耗时 > 5ms 时输出 warning（正常微秒级路径零额外日志）
   */
  resolve(taskType: TaskType): string {
    const t0 = performance.now();
    const result = this.resolveInner(taskType);
    const elapsedMs = performance.now() - t0;
    if (elapsedMs > 5) {
      logger.warning(
        `ModelRouter.resolve: 性能埋点 单次耗时=${elapsedMs.toFixed(2)}ms task=${taskType} → ${result || '(空)'}（正常应 <1ms，检查是否频繁触发 UUID 预加载）`
      );
    }
    return result;
  }

  /** resolve() 内部实现（独立方法以便统一出口计时） */
  private resolveInner(taskType: TaskType): string {
    const tasks = this.readTasks();
    const configured = tasks[taskType];
    logger.debug(
      `ModelRouter.resolve: 入口 task=${taskType} 配置=${configured || '(无)'} 标识=${configured && this.isUUID(configured) ? 'UUID' : '模型名'}`
    );

    if (tasks[taskType]) {
      const value = tasks[taskType]!;
      if (this.isUUID(value)) {
        const modelName = this.uuidToModelName.get(value);
        if (modelName) {
          logger.debug(
            `ModelRouter.resolve: UUID缓存命中 task=${taskType} uuid=${value} → model=${modelName}`
          );
          return modelName;
        }
        // 缓存未命中 → 触发异步预加载（下次调用可用），当前次返回空
        void this.preloadUuidCache();
        logger.warning(
          `ModelRouter.resolve: UUID缓存未命中 task=${taskType} uuid=${value} → 已触发异步预加载，本次返回空（resolveAsync 将走 DB 兜底）`
        );
        return '';
      }
      logger.debug(
        `ModelRouter.resolve: 直接模型名 task=${taskType} → model=${value}`
      );
      return value;
    }

    // 能力路由（视频/图片/嵌入等）不 fallback 到对话模型
    // 对话模型如 deepseek-chat 不具备生图/生视频能力，fallback 会导致调用失败
    if (isCapabilityTask(taskType)) {
      logger.debug(
        `ModelRouter.resolve: 能力路由 ${taskType} 未配置且不 fallback 到对话模型`
      );
      return '';
    }

    if (taskType !== 'default' && tasks.default) {
      const defaultVal = tasks.default;
      if (this.isUUID(defaultVal)) {
        const modelName = this.uuidToModelName.get(defaultVal);
        if (modelName) {
          logger.debug(
            `ModelRouter.resolve: 回退default UUID缓存命中 task=${taskType} uuid=${defaultVal} → model=${modelName}`
          );
          return modelName;
        }
        void this.preloadUuidCache();
        logger.warning(
          `ModelRouter.resolve: 回退default UUID缓存未命中 task=${taskType} uuid=${defaultVal} → 已触发异步预加载，本次返回空`
        );
        return '';
      }
      logger.debug(
        `ModelRouter.resolve: 回退default模型名 task=${taskType} → model=${defaultVal}`
      );
      return defaultVal;
    }

    const current = this.readCurrentModel();
    if (current) {
      // 与 tasks.default 同规则：config.current 可能存 UUID（setCurrentModel 写入），须转模型名
      if (this.isUUID(current)) {
        const modelName = this.uuidToModelName.get(current);
        if (modelName) {
          logger.debug(
            `ModelRouter.resolve: 回退current UUID缓存命中 task=${taskType} uuid=${current} → model=${modelName}`
          );
          return modelName;
        }
        void this.preloadUuidCache();
        logger.warning(
          `ModelRouter.resolve: 回退current UUID缓存未命中 task=${taskType} uuid=${current} → 已触发异步预加载，本次返回空`
        );
        return '';
      }
      logger.debug(
        `ModelRouter.resolve: 回退current模型名 task=${taskType} → model=${current}`
      );
      return current;
    }

    logger.debug(
      `ModelRouter: 任务 ${taskType} 使用硬编码默认 → ${this.defaultModel || '(空)'}`
    );
    return this.defaultModel;
  }

  /**
   * S3: 阶段感知解析 — 根据 PDCA 阶段选择模型
   * 优先使用阶段直配模型（模型管理 → 任务分工 → 阶段偏好），
   * 未配置时回退到阶段默认任务类型；置信度 < 0.7 降级为原始 taskType
   */
  resolveWithPhase(taskType: TaskType, phaseContext?: PhaseContext): string {
    // 无阶段上下文或无置信度 → 用原始 taskType
    if (
      !phaseContext ||
      (phaseContext.confidence != null && phaseContext.confidence < 0.7)
    ) {
      return this.resolve(taskType);
    }

    // 阶段直配模型（值可能是模型 UUID 或模型名）
    const phaseModel = this._phaseMapping[phaseContext.phase];
    if (phaseModel) {
      // 兼容旧配置：值若是任务类型（如 'coding'），按任务解析
      if ((ALL_TASK_TYPES as readonly string[]).includes(phaseModel)) {
        const legacy = this.resolve(phaseModel as TaskType);
        if (legacy) {
          logger.debug(
            `ModelRouter: 阶段 ${phaseContext.phase} → 旧任务类型 ${phaseModel} → ${legacy}`
          );
          return legacy;
        }
      } else {
        // 模型直配：UUID → 模型名，或直接是模型名
        // 与 resolve() 一致：UUID 缓存 miss 时返回空（触发预加载），
        // 禁止把 UUID 原文泄漏到运行时（下游 getByModel(UUID) 会匹配失败）
        let resolved: string | undefined;
        if (this.isUUID(phaseModel)) {
          resolved = this.uuidToModelName.get(phaseModel);
          if (!resolved) {
            void this.preloadUuidCache();
            logger.warning(
              `ModelRouter: 阶段直配 UUID ${phaseModel} 缓存未命中，已触发预加载，本次返回空`
            );
          }
        } else {
          resolved = phaseModel;
        }
        if (resolved) {
          logger.debug(
            `ModelRouter: 阶段直配模型 ${phaseContext.phase}(${phaseContext.confidence}) → ${resolved}`
          );
          return resolved;
        }
      }
    }

    // 回退：阶段 → 默认任务类型 → 任务模型
    const phaseTaskType = DEFAULT_PHASE_TASK_MAP[phaseContext.phase];
    const result = this.resolve(phaseTaskType);

    // 如果阶段映射的 taskType 未配置模型，回退到原始 taskType
    if (!result) {
      logger.debug(
        `ModelRouter: 阶段 ${phaseContext.phase} → ${phaseTaskType} 未配置，回退 ${taskType}`
      );
      return this.resolve(taskType);
    }

    logger.debug(
      `ModelRouter: 阶段路由 ${phaseContext.phase}(${phaseContext.confidence}) → ${phaseTaskType} → ${result}`
    );
    return result;
  }

  /**
   * 异步解析模型名（带 UUID 缓存 miss 时的 DB 兜底）
   *
   * 与 resolve() 的区别：UUID 缓存未命中时，resolve() 返回空字符串并异步预加载；
   * resolveAsync() 则同步查 DB 并填充缓存，确保当前请求不返回空。
   * 适合作为 resolveModelRoute() 等关键路径的入口。
   */
  async resolveAsync(taskType: TaskType): Promise<string> {
    const otel = getOTelTracing();
    const span = otel.startSpan('modelRouter.resolveAsync', {
      'task.type': taskType,
    });
    try {
      const result = this.resolve(taskType);
      if (result) {
        logger.debug(
          `ModelRouter.resolveAsync: resolve() 直接命中 task=${taskType} → model=${result}（未走 DB 兜底）`
        );
        otel.endSpan(span, SpanStatusCode.OK);
        return result;
      }

      // resolve() 返回空 → 可能是 UUID 缓存 miss → 查 DB 兜底
      const tasks = this.readTasks();
      const value = tasks[taskType] || tasks.default;
      logger.debug(
        `ModelRouter.resolveAsync: resolve() 返回空，进入 DB 兜底 task=${taskType} 待解析=${value || '(无)'} 标识=${value && this.isUUID(value) ? 'UUID' : '模型名/空'}`
      );
      if (value && this.isUUID(value)) {
        try {
          const { modelPricingService } =
            await import('./models/ModelPricingService');
          await modelPricingService.initialize();
          const record = await modelPricingService.getPricingById(value);
          if (record?.modelId) {
            this.uuidToModelName.set(value, record.modelId);
            logger.info(
              `ModelRouter.resolveAsync: UUID DB兜底命中 task=${taskType} uuid=${value} → model=${record.modelId}（缓存已填充，后续 resolve 直接命中）`
            );
            otel.endSpan(span, SpanStatusCode.OK);
            return record.modelId;
          }
          logger.warning('ModelRouter.resolveAsync: UUID DB兜底查无此记录', {
            uuid: value,
            taskType,
          });
        } catch (err) {
          await handleError(err, {
            module: 'ai:model-router',
            action: 'resolveAsync:dbLookup',
            context: { uuid: value, taskType },
          });
        }
      }

      // DB 兜底也失败，回退到 current/default
      const current = this.readCurrentModel();
      if (current && this.isUUID(current)) {
        try {
          const { modelPricingService } =
            await import('./models/ModelPricingService');
          const record = await modelPricingService.getPricingById(current);
          if (record?.modelId) {
            this.uuidToModelName.set(current, record.modelId);
            logger.info(
              `ModelRouter.resolveAsync: current UUID DB兜底命中 task=${taskType} uuid=${current} → model=${record.modelId}（缓存已填充）`
            );
            otel.endSpan(span, SpanStatusCode.OK);
            return record.modelId;
          }
          logger.warning(
            'ModelRouter.resolveAsync: current UUID DB兜底查无此记录',
            {
              uuid: current,
              taskType,
            }
          );
        } catch (err) {
          await handleError(err, {
            module: 'ai:model-router',
            action: 'resolveAsync:currentFallback',
            context: { uuid: current, taskType },
          });
        }
      }

      const finalResult = current || this.defaultModel;
      logger.warning(
        `ModelRouter.resolveAsync: 所有路径均未解析到有效模型，返回兜底=${finalResult || '(空)'}`,
        {
          taskType,
          current,
          defaultModel: this.defaultModel,
        }
      );
      otel.endSpan(span, SpanStatusCode.ERROR, 'all paths exhausted');
      return finalResult;
    } catch (err) {
      otel.recordError(
        span,
        err instanceof Error ? err : new Error(String(err))
      );
      otel.endSpan(span, SpanStatusCode.ERROR, String(err));
      // §1.9: catch 统一走 handleError；随后重新抛出，保持调用方（resolveModelRoute 等）可感知
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'resolveAsync',
      });
      throw err;
    }
  }

  /**
   * 根据任务类型解析模型名，并映射为指定提供商的 API 模型名
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
   * 设置当前模型 ID（持久化到 DB ai_app_model_configs 的 current + default）
   *
   * @param modelId - 模型 UUID
   * @param modelName - 可选模型名，传入时同步更新 uuidToModelName 缓存，
   *                    确保 resolve() 的 UUID→名称转换能命中
   */
  async setCurrentModel(modelId: string, modelName?: string): Promise<void> {
    try {
      const { appModelConfigService } =
        await import('./models/AppModelConfigService.js');
      await appModelConfigService.initialize();

      await appModelConfigService.setConfig('current', { model: modelId });
      this._currentModel = modelId;

      // 保存旧 default（用于后续判断 chat 任务是否"从 default 继承"），
      // 必须在 setConfig('default') 之前读取，否则拿到的是新值。
      const previousDefault = this._taskCache.get('default');

      await appModelConfigService.setConfig('default', { model: modelId });
      this._taskCache.set('default', modelId);

      // 同步更新 UUID→模型名 缓存，避免 resolve() 查 UUID 时返回空
      if (modelName && this.isUUID(modelId)) {
        this.uuidToModelName.set(modelId, modelName);
      }

      // 仅清除与被替换模型相同的聊天任务（从 default 继承来的），
      // 保留用户显式配置的任务分工（如 chat→GPT-4, default→DeepSeek 时切换不改 chat）
      const chatOverrides = [
        'chat',
        'coding',
        'quick',
        'agent',
        'scheduled',
        'local',
        'translation',
        'knowledge_compile',
      ];
      let preservedCount = 0;
      let clearedCount = 0;
      for (const t of chatOverrides) {
        const current = this._taskCache.get(t);
        // 仅当任务无显式配置，或配置值等于旧 default（即从 default 继承的）时才清除
        if (!current || current === previousDefault) {
          this._taskCache.delete(t);
          await appModelConfigService.deleteConfig(t).catch(() => {
            /* 条目不存在则跳过 */
          });
          clearedCount++;
        } else {
          preservedCount++;
        }
      }

      logger.info(
        `ModelRouter: 当前模型已设置为 ${modelId}` +
          (modelName ? ` (${modelName})` : '') +
          ` | 清除继承任务: ${clearedCount} | 保留显式任务: ${preservedCount}`
      );

      // T2.2: 发布 default/current 变更（chat 类任务继承 default 的已清除，一并通知）
      this.notifyTaskChange('default');
      for (const t of chatOverrides) {
        this.notifyTaskChange(t as TaskType);
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:model-router',
        action: 'setCurrentModel',
        context: { modelId, modelName },
      });
      throw err;
    }
  }

  /**
   * 获取所有任务分工配置（从内存缓存读取）
   */
  getTasks(): TaskModelConfig {
    const tasks: Record<string, string> = {};
    for (const [k, v] of this._taskCache) {
      tasks[k] = v;
    }
    return tasks as TaskModelConfig;
  }

  /**
   * T2.2: 订阅指定任务的模型变更（模型热切换通知）。
   * 通知 payload：{ type, prev, next, at }（next 为新模型 ID，withdraw 时为 undefined）。
   * 订阅契约（重激活协议）：
   *   a) 无在途请求 → 立即采用新模型；
   *   b) 有在途请求且可取消 → 默认允许完成当前请求，下一次请求采用新模型（保守）；
   *   c) 在途请求不可取消 → 本次继续，下次采用。
   * 返回 unsub 函数。
   */
  subscribeTask(
    taskType: TaskType,
    cb: (change: DepChange) => void
  ): () => void {
    return dependencyRegistry.subscribe(`model:${taskType}`, cb);
  }

  /** T2.2: 读取任务当前模型（未就绪返回 undefined，等待而非报错） */
  injectTask(taskType: TaskType): string | undefined {
    return dependencyRegistry.inject<string>(`model:${taskType}`);
  }

  /**
   * T2.2: 发布单任务模型变更通知。
   * 仅当模型值变化（Object.is）时通知订阅者；依赖注册表未提供时跳过。
   */
  private notifyTaskChange(taskType: TaskType): void {
    const modelId = this._taskCache.get(taskType);
    // 仅发布已配置的任务；未配置（undefined）不发布，避免 withdraw 语义混淆
    if (modelId) {
      dependencyRegistry.provide(`model:${taskType}`, modelId);
    }
  }

  /** T2.2: 发布所有任务模型变更通知（refreshTaskCache 全量刷新后调用） */
  private notifyAllTaskChanges(): void {
    for (const taskType of ALL_TASK_TYPES) {
      this.notifyTaskChange(taskType);
    }
  }

  /**
   * 保存任务分工配置（持久化到 DB + 更新内存缓存）
   */
  async setTasks(tasks: TaskModelConfig): Promise<void> {
    const { appModelConfigService } =
      await import('./models/AppModelConfigService.js');
    await appModelConfigService.initialize();

    const entries = Object.entries(tasks) as [string, string][];

    for (const [taskType, modelId] of entries) {
      if (modelId) {
        await appModelConfigService.setConfig(taskType, { model: modelId });
        this._taskCache.set(taskType, modelId);
      }
    }

    // T2.2: 发布任务模型变更通知（模型热切换）
    for (const [taskType] of entries) {
      this.notifyTaskChange(taskType as TaskType);
    }

    logger.info('ModelRouter: 任务分工已保存', { taskCount: entries.length });
  }

  /**
   * S3: 获取阶段→模型自定义映射
   */
  getPhaseMapping(): Partial<Record<PdcaPhase, string>> {
    return { ...this._phaseMapping };
  }

  /**
   * S3: 保存阶段→模型自定义映射（持久化到 DB + 更新内存缓存）
   *
   * 与任务分工一致：每个阶段以 app_type = phase_<phase> 存到
   * ai_app_model_configs 表，后端重启后自动恢复（由 initFromDb 加载）。
   */
  async setPhaseMapping(
    mapping: Partial<Record<PdcaPhase, string>>
  ): Promise<void> {
    this._phaseMapping = { ...mapping };
    logger.info('ModelRouter: 阶段映射已保存', mapping);

    try {
      const { appModelConfigService } =
        await import('./models/AppModelConfigService.js');
      await appModelConfigService.initialize();

      for (const phase of PHASE_KEYS) {
        const model = mapping[phase];
        if (model) {
          await appModelConfigService.setConfig(`phase_${phase}`, { model });
        } else {
          await appModelConfigService.deleteConfig(`phase_${phase}`);
        }
      }
    } catch (err) {
      // 持久化失败不阻断内存更新（内存映射已生效，重启后可能丢失）
      await handleError(err, {
        module: 'ai:modelRouter',
        action: 'setPhaseMappingPersist',
      });
    }
  }

  // ============================================================
  // 内部读取（内存缓存）
  // ============================================================

  /** 任务配置（内存缓存读取） */
  private readTasks(): TaskModelConfig {
    return this.getTasks();
  }

  /** 当前模型（内存缓存读取） */
  private readCurrentModel(): string {
    if (this._currentModel) return this._currentModel;

    const defaultTask = this._taskCache.get('default');
    if (defaultTask) return defaultTask;

    return '';
  }

  /**
   * 异步触发启动自引导：从 model_registry 扫描模型能力，
   * 自动填充 taskType → modelId 映射并持久化到 DB
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
      for (const taskType of ALL_TASK_TYPES) {
        const requiredCaps = getTaskCapabilities(taskType);
        if (requiredCaps.length === 0) continue;

        // 找到具备所有必需能力的模型（AND 语义）
        const match = allModels.find((m) => {
          if (!m.enabled) return false;
          const modelCaps = m.capabilities || [];
          return requiredCaps.every((cap) => modelCaps.includes(cap));
        });

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
        'knowledge_compile',
      ];
      // 非聊天能力标签（与 handleGetCurrentModel 保持一致）
      const nonChatCaps = new Set([
        'embedding',
        'image_generation',
        'video_generation',
        'text_to_video',
        'image_to_video',
        'text_to_speech',
        'speech_recognition',
        'reranking',
        'moderation',
        'image_editing',
      ]);
      const usedModels = new Set(Object.values(tasks));
      const chatModel = allModels.find((m) => {
        if (!m.enabled) return false;
        if (usedModels.has(m.id || m.modelId)) return false;
        // 排除只有非聊天能力的模型（如纯 embedding 模型）
        const caps = m.capabilities || [];
        if (caps.length > 0 && caps.every((c) => nonChatCaps.has(c)))
          return false;
        return true;
      });
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
        await this.setTasks(merged as TaskModelConfig);
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
        await this.setTasks(newTasks as TaskModelConfig);
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

      // 遍历所有需要特定能力的任务类型
      for (const taskType of ALL_TASK_TYPES) {
        const requiredCaps = getTaskCapabilities(taskType);
        if (requiredCaps.length === 0) continue;

        const modelId = (tasks as Record<string, string>)[taskType];
        if (!modelId) continue;

        const model = allModels.find(
          (m) => m.id === modelId || m.modelId === modelId
        );
        if (!model) {
          // 模型不存在
          for (const cap of requiredCaps) {
            issues.push({
              taskType,
              modelId,
              requiredCapability: cap,
              missing: true,
            });
          }
          logger.warning(
            `ModelRouter: 任务 ${taskType} 的模型 ${modelId} 不存在`
          );
          continue;
        }

        // 检查每个必需能力
        for (const cap of requiredCaps) {
          if (!model.capabilities?.includes(cap)) {
            issues.push({
              taskType,
              modelId,
              requiredCapability: cap,
              missing: true,
            });
            logger.warning(
              `ModelRouter: 任务 ${taskType} 的模型 ${modelId} 缺少所需能力 ${cap}`
            );
          }
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
