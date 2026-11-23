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
 * CoreAPI 实现
 * 串联现有的 ChatManager、ToolManager、Coordinator、ConverterEngine 等服务
 * 作为应用唯一对外门面，为所有外部入口提供一致的功能入口
 */

import { configManager } from '@openliri/infra/config';
// C1（2026-09-30 D-98/D-101）：任务运维**服务层端口**（用于给 `getTaskOpsPort()` 显式标注返回类型）
import type { TaskOpsPort } from '@openliri/service/runtime/api/taskOpsPorts';
// C1（2026-09-30 D-106）：AI 运维**服务层端口**（用于给 `getAiOpsPort()` 显式标注返回类型）
import type { AiOpsPort } from '@openliri/service/ports/aiOpsPorts';
// C1（2026-09-30 D-111）：三个小域**服务层端口**（用于给 `getXxxOpsPort()` 显式标注返回类型）
import type { QueryOpsPort } from '@openliri/service/runtime/api/queryOpsPorts';
import type { BuddyOpsPort } from '@openliri/service/runtime/api/buddyOpsPorts';
import type { CommandsOpsPort } from '@openliri/service/runtime/api/commandsOpsPorts';
import type { WorkspaceOpsPort } from '@openliri/service/runtime/api/workspaceOpsPorts';
import type { ProjectOpsPort } from '@openliri/service/runtime/api/projectOpsPorts';
import type { SkillsOpsPort } from '@openliri/service/runtime/api/skillsOpsPorts';
import type { AutoReplyPort } from '@openliri/service/runtime/api/autoReplyPorts';
import type { A2APort } from '@openliri/service/runtime/api/a2aPorts';
import type { BridgePort } from '@openliri/service/runtime/api/bridgePorts';
import type { AutoCompactServiceRefPort } from '@openliri/service/runtime/api/compactPorts';
import type { EmbeddingRefPort } from '@openliri/service/runtime/api/embeddingPorts';
import type { SessionCheckpointRefPort } from '@openliri/service/runtime/api/sessionCheckpointPorts';
// D-227（2026-10-02，B12 `runtime -> app` 收口）：`AutoCompactService` 原为压缩域**同步**门面所需
// （见 `createAutoCompactService()`）；现改经 `CoreApiAppDeps.createAutoCompactService` 由组合根注入
// ⇒ 删除 `@modules/compaction` 静态值导入（该「文件 × 模块」豁免对随之消失）。
// 2026-10-01（子批 F `runtime -> query` 收口）：B13 的「检查点清理同步门面」已**作废**
// —— `FileCheckpointStorage` 已下沉 `session/storage/`(service)，`session/**` 回归同模块直连
// ⇒ 本文件不再需要静态导入 `@modules/query`（该「文件 × 模块」对随之消失）。
import { DomainSnapshotOps } from './domainSnapshotOps';
import { resolveStreamFinishReason } from '@openliri/service/runtime/api/streamTermination';
import { SessionMessagesRead } from '@openliri/service/runtime/api/sessionMessagesRead';
import { MessageMutation } from '@openliri/service/runtime/api/messageMutation';
import { SessionTitling } from '@openliri/service/runtime/api/sessionTitling';
// C3-S1（2026-10-09，`.trae/specs/core-api-impl-split.md`）：工具查询 / 会话 CRUD 与查询 /
// 代理任务 / 文件类型 —— 自本文件**纯搬迁**（只搬不改）至 `sessionAgentOps.ts`；此处仅薄转发。
import { SessionAgentOps } from './sessionAgentOps';
// C3-S3（2026-10-09，`.trae/specs/core-api-impl-split.md`）：LLM 客户端懒初始化 / 模型解析 /
// 非流式 `chat` —— 自本文件**纯搬迁**（只搬不改）至 `llmChatOps.ts`；此处仅薄转发。
import { LlmChatOps } from './llmChatOps';
// S2（2026-11-19）：流式对话（chatStream + 私有助手）**纯搬迁**至 chatStreamOps.ts → 薄转发
import { ChatStreamOps } from './chatStreamOps';
import type { CoreAPI } from './CoreAPI';
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  ToolCallSpec,
  ToolResult,
  ToolInfo,
  SessionInfo,
  SessionCreateParams,
  AgentTaskParams,
  AgentProgress,
  AgentResult,
  ConvertFileParams,
} from './CoreAPI';
import type {
  ConversionResult,
  FileInfo,
  ToolVisibilityReport,
} from '@modules/tools';
// D-227（2026-10-02，B12）：仅保留**类型位**（`ReturnType<typeof getConverterEngine>` / `FileTypeDetector`）；
// 值改经 `CoreApiAppDeps` 注入 ⇒ 删除 `@modules/tools` 静态值导入。
import type { getConverterEngine, FileTypeDetector } from '@modules/tools';
// C3-S3（2026-10-09）：`createPermissionManager` 随 `ensureLLMClientInitialized` 迁至 `llmChatOps.ts`
// ⇒ 本文件不再需要该静态值导入（已移除）。
import type { ChatManager } from '@modules/chat';
// D-227（2026-10-02，B12 `runtime -> app` 收口）：原静态值导入 `createChatManager` / `computeUnifiedDiff` /
// `eventNotificationService` / `getCheckpointService` 分别改经 `CoreApiAppDeps` 注入（同步门面）
// 或**方法内动态导入**（异步路径）⇒ 删除 `@modules/chat` 静态值导入（该「文件 × 模块」豁免对随之消失）。
// B2（2026-10-05）：`verifySessionDerivation` 转发签名所需的类型位（实现已外迁 `sessionMessagesRead.ts`）
import type { DerivationDiff, LiteSessionSummary } from '@modules/session';
import type { SessionRoundSummariesResult } from '@openliri/service/runtime/api/roundSummaries'; // B2：按轮摘要返回体

import type { LiriEvent } from '@modules/session/types/events';
import type { SessionManager } from '@modules/session/types/session';
// P3-2（2026-11-16）：onToolCall 两阶段（start / end）产物外移为独立模块
// （原闭包内联段 ~280 行，曾使本文件越过 R04-001 的 2000 行上限）
import type { ToolManager } from '@modules/tools';
import type { Coordinator } from '@openliri/service/runtime/coordinator';
import { coordinator as defaultCoordinator } from '@openliri/service/runtime/coordinator';
import { getLogger } from '@openliri/infra/monitoring';
// D-227（2026-10-02，B12）：`AppError` / `ErrorCategory` / `ErrorSeverity` 供 `appDeps` 懒解析缺注入时抛错。
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
// C3-S3（2026-10-09）：`DEFAULT_MODEL_SENTINEL` 随 `resolveSmartModel` 迁至 `llmChatOps.ts`（已移除）。
// 状态块 statusType 契约（CS02：判据为结构化标记，勿写字面量）
// D-227（2026-10-02，B12 `runtime -> app` 收口）：`@modules/ai` 仅保留**类型位**。
// 同步门面所需（`modelRouter` / `RouteKey` / `resolveModelRoute`）改经 `CoreApiAppDeps.router` 注入；
// 异步路径（`resolveModelRoute` / `RouteKey` / `providerRegistry` / `ToolAwareClient` / `detectPhase` /
// `syncDBProvidersToRegistry` / `detectUnifiedProviders`）改**方法内动态导入**。
import type { SmartRouter, RouteDecision } from '@modules/ai';
// D-227：`getToolManager` 值改经 `CoreApiAppDeps.toolManager` 注入 ⇒ 删除静态值导入。
// 2026-10-01（子批 F `runtime -> agent` 收口）：原顶层静态导入 `getTitleGenerator`，但其**唯一**
// 使用点在 **async** 方法 `generateSessionTitle()` 内 ⇒ 按本文件**既有模式**（同 `getToolsPort()`
// 内的 `await import('@modules/tools')`）改为**方法内动态导入** ⇒ 该「文件 × 模块」对消失
// （转入 R00-003 上报），并附带**懒加载**收益（模块求值期不再拉入 `agent`）。

// [v1.2] costTracker.addCost / recordCost / getCostMetricsBridge 已迁移到 COST_RECORDED 事件订阅者（cost/index.ts）

const logger = getLogger('runtime:api:CoreAPIImpl');

let _coreApiInstance: CoreAPIImpl | null = null;

// C3-S1（2026-10-09）：`countConversationMessages` / `countUserMessages` 已随会话查询实现
// 迁至 `sessionAgentOps.ts`（仅在彼处使用）。

/**
 * 模型路由**窄契约**（U7 试点，2026-10-06）。
 *
 * 缘起：`dev_docs/任务计划-20261004.md` §19.4-**U7**「为 14 个 `*Router` 定义 `IRouter` 基契约」
 * 原判「不排期」。回仓做 **13 个 `*Router` 全量族普查**后**订正试点对象**：
 * - ❌ 原建议的「3 个 generation Router」前提**不成立** —— `ImageInputRouter` 是**决策**路由器
 *   （`route()` 返回 `ImageInputDecision`，且该 `route()` **生产零调用**），与两个生成编排器不同族；
 *   `ImageGenerationRouter` / `VideoGenerationRouter` **各只有 1 个生产消费者**（各自 Tool）⇒ 抽公共
 *   契约只会得到"零多态消费者的死契约"（违反 06 报告判据「收口靠删非合」与 CS03 不做投机抽象）。
 * - ✅ 全仓**唯一**满足「≥1 真实多态消费者」的角色 = **模型路由**：`ai/router/resolveModelRoute.ts:103-126`
 *   与 `CoreAPIImpl.resolveSmartModel()` 在 `SmartRouter` / `ModelRouter` 间真实二选一；且本端口
 *   已有**两个实现**（生产适配 = 组合根 `BootPipelineIntegrator.ts:66-71`；测试桩）。
 *
 * 因此本契约**不新增抽象层**，只把此处**既有的内联匿名类型具名化**（零行为变更），
 * 使其可被单测直接锁定（`app/tests/runtime/modelRouteResolverContract.test.ts` 穷尽断言）。
 *
 * ⚠️ 字段一律用 `unknown` / 基础类型，**不引入 app 类型导入**（沿用本文件端口约定，见下）。
 */
export interface ModelRouteResolver {
  /** 默认任务档的模型名（空串表示未配置） */
  resolveDefault(): string;
  /** 按阶段上下文解析（`phase` 用 `unknown`，落点由组合根收窄） */
  resolveWithPhase(phase: unknown): string | null;
  /** 对话档模型名（异步：需读任务分工 / DB） */
  resolveChat(): Promise<string>;
}

/**
 * app 层能力注入包（组合根注册；CoreAPIImpl 属 service 层，禁止静态依赖 app 层）
 *
 * D-227（2026-10-02，B12 `runtime -> app` 收口）：`CoreAPIImpl` 原**静态**值导入
 * `@modules/{tools,chat,ai,compaction}`（4 条 `runtime -> app` 倒挂）⇒ 改为由**入口层组合根**
 * （`bootstrap/pipeline/BootPipelineIntegrator` / `entrypoints/init`）经 `setCoreApiAppDeps()` 注入。
 *
 * ⚠️ 字段用 `unknown` 以**避免新增 app 类型导入**（端口不引 app 类型，连 `import type` 也按仓内
 * 既有端口约定避免）；各**落点**处用 `as` 收窄（本文件已有 `as never` 收窄先例）。
 */
export interface CoreApiAppDeps {
  chatManager: unknown; // 运行期类型 ChatManager（落点处收窄）
  toolManager: unknown; // ToolManager
  converterEngine: unknown; // ReturnType<typeof getConverterEngine>
  fileTypeDetector: unknown; // FileTypeDetector
  /** ai 路由器：**已绑定**操作（隐藏 modelRouter + RouteKey + resolveModelRoute 三符号）；契约见 `ModelRouteResolver` */
  router: ModelRouteResolver;
  /** chat 的检查点服务（同步门面 getSessionCheckpointRef 用） */
  getCheckpointService: () => unknown;
  /** compaction 的每调用新建工厂（createAutoCompactService 用） */
  createAutoCompactService: () => unknown;
  /** ai 的全局 embedding 管理器（同步门面用） */
  globalEmbeddingManager: unknown;
  /**
   * 命令端口工厂（2026-11-24，R00-003 收口）：`commands` 域实现留在 app 层，由**入口层组合根**注入。
   *
   * 原先 `DomainSnapshotOps.getCommandsOpsPort()` 内部 `await import('@modules/commands')` /
   * `.../CommandExecutor.js` —— 属 service → app 的动态跨层引用（静态正则看不见）。
   * 现改为与 `chatManager` / `toolManager` 同一手法：组合根注入，service 侧只调端口。
   *
   * @param chatManager 会话管理器（`brief` 等会话级命令经 `context.chatManager` 取本会话消息）
   */
  commandsOps: (chatManager?: unknown) => CommandsOpsPort;
}

let _registeredAppDeps: CoreApiAppDeps | undefined;
/** 组合根注册（entry 层调用；见 `bootstrap/pipeline/BootPipelineIntegrator.ts`） */
export function setCoreApiAppDeps(deps: CoreApiAppDeps): void {
  _registeredAppDeps = deps;
}

/**
 * 创建 CoreAPIImpl 实例
 * 支持传入可选依赖覆盖，未传入时使用全局默认实例
 */
export function createCoreAPI(
  options?: ConstructorParameters<typeof CoreAPIImpl>[0]
): CoreAPIImpl {
  return new CoreAPIImpl(options);
}

/**
 * 获取全局 CoreAPIImpl 单例
 * 首次调用时自动创建，使用全局默认依赖
 */
export function getCoreAPI(): CoreAPIImpl {
  if (!_coreApiInstance) {
    _coreApiInstance = createCoreAPI();
  }
  return _coreApiInstance;
}

/**
 * S2（2026-11-19，`.trae/specs/core-api-impl-split.md`）：`resolveStreamErrorCode` /
 * `shouldPersistStreamFallback` 两个纯函数随 `chatStream` **原样搬迁**至 `chatStreamOps.ts`
 * （其消费面就是该文件的流式主路径；契约单测已改指新文件）。
 */

// 2026-11-06（N-2）：`resolveStreamFinishReason` 已外移到
// `@openliri/service/runtime/api/streamTermination`（本文件逼近 R04-001 的 2000 行上限）；
// 此处**转发导出**保留既有消费面（测试与通道侧仍从 CoreAPIImpl 取用）。
export { resolveStreamFinishReason };

/**
 * CoreAPI 实现类
 * 通过构造函数注入依赖，所有参数均为可选，默认使用全局单例
 */
export class CoreAPIImpl implements CoreAPI {
  /**
   * D-227（2026-10-02，B12）：内联 app 依赖（构造器注入；测试/入口覆盖用）。
   * 未提供时统一回退到组合根注册的 {@link CoreApiAppDeps}（懒解析，见 `appDeps` getter）。
   */
  private readonly _inlineAppDeps?: CoreApiAppDeps;
  private readonly _inlineChatManager?: ChatManager;
  private readonly _inlineToolManager?: ToolManager;
  private readonly _inlineConverterEngine?: ReturnType<
    typeof getConverterEngine
  >;
  private readonly _inlineFileTypeDetector?: FileTypeDetector;
  /** D-227：会话管理器懒解析（避免构造期访问 app 依赖 —— 与注册时序解耦） */
  private _sessionManager?: SessionManager;
  private coordinator: Coordinator;
  /** 模型名内存缓存（仅作后备，事实来源为 ModelRouter DB） */
  private _modelName: string;
  /** B1（2026-10-05）：领域只读快照 / 梦境 / 知识库文档 / 端口聚合实现（外迁 `domainSnapshotOps.ts`） */
  private readonly domainSnapshotOps = new DomainSnapshotOps();
  /** B2（2026-10-05）：消息读取 / 事件派生 / 派生校验 / 事件流 / 审批块实现（外迁 `sessionMessagesRead.ts`） */
  private readonly sessionMessagesRead: SessionMessagesRead =
    new SessionMessagesRead({
      getChatManager: () => this.chatManager,
      getSessionManager: () => this.sessionManager,
      // B3（2026-10-05）：`_filterDeletedRanges` 已随 C14 外迁并改名 public `filterDeletedRanges`。
      getFilterDeletedRanges:
        () =>
        <T>(sessionId: string, messages: T[]) =>
          this.messageMutation.filterDeletedRanges<T>(sessionId, messages),
    });

  /** B3（2026-10-05）：消息编辑 / 回滚实现（外迁 `messageMutation.ts`） */
  private readonly messageMutation: MessageMutation = new MessageMutation({
    getChatManager: () => this.chatManager,
    getSessionManager: () => this.sessionManager,
    getCleanupOrphanAttachments: () => (sid, ids) =>
      this.cleanupOrphanAttachments(sid, ids),
    // ⚠️ 闭包惰性求值：`sessionMessagesRead` 的 `getFilterDeletedRanges` 与
    // `messageMutation` 的 `getDeriveSessionMessagesFromEvents` 互指（两模块形成惰性引用环），
    // 因均为**调用时**求值 ⇒ 无构造顺序问题、无运行时递归。
    getDeriveSessionMessagesFromEvents: () => (sid) =>
      this.sessionMessagesRead._deriveSessionMessagesFromEvents(sid),
  });
  /** B4（2026-10-05）：标题 / 元数据 / 执行阶段追踪实现（外迁 `sessionTitling.ts`） */
  private readonly sessionTitling: SessionTitling = new SessionTitling({
    getChatManager: () => this.chatManager,
  });

  /** C3-S1（2026-10-09）：工具查询 / 会话 CRUD / 代理任务 / 文件类型（外迁 `sessionAgentOps.ts`） */
  private readonly sessionAgentOps: SessionAgentOps = new SessionAgentOps({
    getToolManager: () => this.toolManager,
    getChatManager: () => this.chatManager,
    getSessionManager: () => this.sessionManager,
    getSessionMessagesRead: () => this.sessionMessagesRead,
    getMessageMutation: () => this.messageMutation,
    getSessionTitling: () => this.sessionTitling,
    getCoordinator: () => this.coordinator,
    getConverterEngine: () => this.converterEngine,
    getFileTypeDetector: () => this.fileTypeDetector,
    // P1（2026-11-03）：HTTP/CoreAPI 工具执行的权限门（唯一入口 `authorizeToolCall`）
    getPermissionManager: () => this.chatManager.getPermissionManager(),
  });
  /** C3-S3（2026-10-09）：LLM 懒初始化 / 模型解析 / 非流式 chat（外迁 `llmChatOps.ts`） */
  private readonly llmChatOps: LlmChatOps = new LlmChatOps({
    getChatManager: () => this.chatManager,
    getToolManager: () => this.toolManager,
    getSessionTitling: () => this.sessionTitling,
    getRouter: () => this.appDeps.router,
    isLlmReady: () => this._llmReady,
    setLlmReady: (ready) => {
      this._llmReady = ready;
    },
    getSmartRouter: () => this.smartRouter,
    setLastRouteDecision: (decision) => {
      this.lastRouteDecision = decision;
    },
  });
  /** S2（2026-11-19）：流式对话实现（外迁 `chatStreamOps.ts`） */
  private readonly chatStreamOps: ChatStreamOps = new ChatStreamOps({
    getChatManager: () => this.chatManager,
    getSessionTitling: () => this.sessionTitling,
    getLlmChatOps: () => this.llmChatOps,
    setModelName: (model: string) => {
      this._modelName = model;
    },
  });

  /** SmartRouter 智能路由实例（可选，未设置时使用 modelRouter.resolve 静态路由） */
  private smartRouter: SmartRouter | null = null;

  /** 最近一次路由决策缓存（用于前端 status bar 展示） */
  private lastRouteDecision: RouteDecision | null = null;

  /** LLM 客户端延迟初始化标记 */
  private _llmReady = false;

  /**
   * E-1 diff（2026-08-23）：文件写入工具执行前的内容缓存（key: 文件路径，供 end 时计算 unified diff）
   */

  constructor(options?: {
    chatManager?: ChatManager;
    sessionManager?: SessionManager;
    toolManager?: ToolManager;
    coordinator?: Coordinator;
    converterEngine?: ReturnType<typeof getConverterEngine>;
    fileTypeDetector?: FileTypeDetector;
    modelName?: string;
    /** D-227（2026-10-02）：app 层能力注入包（组合根/测试内联） */
    appDeps?: CoreApiAppDeps;
  }) {
    // D-227：不再在构造期求值 app 依赖默认值（旧为 createChatManager()/globalToolManager/
    // getConverterEngine()/new FileTypeDetector()）⇒ 改为 getter 懒解析，启动期「创建」与「注册」解耦。
    this._inlineAppDeps = options?.appDeps;
    this._inlineChatManager = options?.chatManager;
    this._inlineToolManager = options?.toolManager;
    this._inlineConverterEngine = options?.converterEngine;
    this._inlineFileTypeDetector = options?.fileTypeDetector;
    this._sessionManager = options?.sessionManager;
    this.coordinator = options?.coordinator ?? defaultCoordinator;
    this._modelName =
      options?.modelName ??
      configManager.env('DEEPSEEK_MODEL') ??
      configManager.env('AI_MODEL') ??
      '';
  }

  /**
   * D-227（2026-10-02，B12 `runtime -> app` 收口）：app 层依赖的**懒解析**注入包。
   *
   * ⚠️ 懒解析是关键 —— 组合根的「注册」与「创建」顺序无关，仅当**访问**某个 app 能力时才解析
   * （启动时序：`getCoreAPI()` 的创建先于任何 app 依赖访问，注册由其前的组合根完成）。
   */
  private get appDeps(): CoreApiAppDeps {
    const d = this._inlineAppDeps ?? _registeredAppDeps;
    if (!d) {
      throw new AppError(
        'CoreAPIImpl: app 层依赖未注入（组合根未调用 setCoreApiAppDeps）',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH
      );
    }
    return d;
  }

  /**
   * P1-5: 公开 ChatManager 以支持会话流式状态查询。
   * D-227：由构造期字段改为懒解析 getter（值经 `CoreApiAppDeps.chatManager` 注入）。
   */
  get chatManager(): ChatManager {
    return (this._inlineChatManager ?? this.appDeps.chatManager) as ChatManager;
  }

  /** D-227：ToolManager 懒解析（`getToolManager()` 门面保持签名不变，内部读本 getter） */
  private get toolManager(): ToolManager {
    return (this._inlineToolManager ?? this.appDeps.toolManager) as ToolManager;
  }

  /** D-227：会话管理器懒解析（默认 `chatManager.getSessionManager()`，避免构造期访问） */
  private get sessionManager(): SessionManager {
    if (!this._sessionManager) {
      this._sessionManager =
        this.chatManager.getSessionManager() as SessionManager;
    }
    return this._sessionManager;
  }

  /** D-227：转换引擎懒解析（值经 `CoreApiAppDeps.converterEngine` 注入） */
  private get converterEngine(): ReturnType<typeof getConverterEngine> {
    return (this._inlineConverterEngine ??
      this.appDeps.converterEngine) as ReturnType<typeof getConverterEngine>;
  }

  /** D-227：文件类型检测器懒解析（值经 `CoreApiAppDeps.fileTypeDetector` 注入） */
  private get fileTypeDetector(): FileTypeDetector {
    return (this._inlineFileTypeDetector ??
      this.appDeps.fileTypeDetector) as FileTypeDetector;
  }

  /**
   * 设置当前模型名称（同步更新内存缓存，调用方需同时写 ModelRouter DB）
   */
  setModelName(modelName: string): void {
    this._modelName = modelName;
  }

  /**
   * 获取当前模型名称
   * 收敛为 ModelRouter 单源：优先从 DB 读取 default 任务模型，_modelName 仅作后备
   */
  getModelName(): string {
    // D-227（2026-10-02）：`modelRouter.resolve('default')` → 经注入路由器（隐藏 app 符号）。
    const routerModel = this.appDeps.router.resolveDefault();
    if (routerModel) return routerModel;
    return this._modelName;
  }

  /**
   * 设置 SmartRouter 实例（启用智能路由决策）
   */
  setSmartRouter(router: SmartRouter): void {
    this.smartRouter = router;
    logger.info('SmartRouter 已接入 CoreAPIImpl');
  }

  /**
   * 移除 SmartRouter（回退到静态路由）
   */
  removeSmartRouter(): void {
    this.smartRouter = null;
    this.lastRouteDecision = null;
  }

  /**
   * 获取当前 SmartRouter 实例
   */
  getSmartRouter(): SmartRouter | null {
    return this.smartRouter;
  }

  /**
   * 获取最近一次路由决策（供前端展示）
   */
  getLastRouteDecision(): RouteDecision | null {
    return this.lastRouteDecision;
  }

  /**
   * HTTP 服务就绪后的 LLM 预热（2026-09-03）
   *
   * 根因修复：此前 LLM 客户端完全依赖"首个请求触发延迟初始化"，用户在应用启动
   * 窗口期（启动清理等重量级 initialize 未完成）发消息时，chatStream 会串行等待
   * 完整初始化（实测 43s）→ 前端等 37s 无字节 abort 流 → 用户感知"才提要求就中断"。
   * 本方法在 HTTP listen 回调中后台预热（fire-and-forget），把初始化从"首条消息
   * 关键路径"提前到"服务就绪时刻"，显著缩短启动窗口期消息的等待。
   */
  warmupLLM(): void {
    this.llmChatOps.ensureLLMClientInitialized().catch((err) => {
      logger.warning('warmupLLM: LLM 预热失败（首条消息将承担延迟初始化）', {
        error: String(err),
      });
    });
  }

  /**
   * 确保会话已从磁盘加载（幂等）
   * 与 LLM 客户端初始化解耦，用于在 HTTP session handler 中提前加载会话列表。
   */
  async ensureSessionsLoaded(): Promise<void> {
    await this.chatManager.ensureSessionsLoaded();
  }

  /**
   * 非流式对话（实现已外迁 `llmChatOps.ts`；`ensureLLMClientInitialized` / `resolveSmartModel`
   * 亦随之外迁，C3-S3）
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.llmChatOps.chat(request);
  }

  /**
   * S2（2026-11-19，`.trae/specs/core-api-impl-split.md`）：整块与私有助手已**原样搬迁**至
   * `chatStreamOps.ts`；此处仅薄转发（签名与行为不变）。
   */
  async *chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown> {
    return yield* this.chatStreamOps.chatStream(request);
  }

  async executeTool(
    sessionId: string,
    toolCall: ToolCallSpec
  ): Promise<ToolResult> {
    return this.sessionAgentOps.executeTool(sessionId, toolCall);
  }

  // ---- B1 纯搬迁（2026-10-05）：以下 22 个「领域只读快照 / 梦境 / 知识库文档 / 技能·插件·通道端口」
  // 的实现已外迁至同目录 `domainSnapshotOps.ts`（`DomainSnapshotOps`，零宿主依赖）；
  // 此处仅保留与被迁实现逐字等价的薄转发。

  async getGitContextSnapshot(): Promise<{
    isGitRepo: boolean;
    status: {
      branch: string;
      mainBranch: string;
      status: string;
      recentCommits: string;
      userName: string | null;
    } | null;
  }> {
    return this.domainSnapshotOps.getGitContextSnapshot();
  }

  async getPathGuardMetrics(): Promise<Record<string, unknown>> {
    return this.domainSnapshotOps.getPathGuardMetrics();
  }

  async resetPathGuardMetrics(): Promise<void> {
    return this.domainSnapshotOps.resetPathGuardMetrics();
  }

  async listWorkspaceEntries(): Promise<
    Array<{
      id: string;
      name: string;
      path: string;
      description: string | undefined;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    return this.domainSnapshotOps.listWorkspaceEntries();
  }

  async getWorkspacePath(workspaceId: string): Promise<string | null> {
    return this.domainSnapshotOps.getWorkspacePath(workspaceId);
  }

  async deleteWorkspace(path: string): Promise<void> {
    return this.domainSnapshotOps.deleteWorkspace(path);
  }

  async listDreamCycles(params: {
    page: number;
    pageSize: number;
    triggerSource?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<object> {
    return this.domainSnapshotOps.listDreamCycles(params);
  }

  async queryDreamCycles(filter: {
    from?: number;
    to?: number;
    triggerSource?: string;
    status?: string;
    limit?: number;
  }): Promise<{ cycles: unknown; stats: unknown }> {
    return this.domainSnapshotOps.queryDreamCycles(filter);
  }

  async getDreamCycle(cycleId: string): Promise<unknown | null> {
    return this.domainSnapshotOps.getDreamCycle(cycleId);
  }

  async readDreamMetrics(): Promise<unknown | null> {
    return this.domainSnapshotOps.readDreamMetrics();
  }

  async buildKnowledgeDocsIndex(): Promise<
    Array<{
      relativePath: string;
      content?: string | undefined;
      title?: string | undefined;
      source?: string | undefined;
      category?: string | undefined;
      tags?: string[] | undefined;
    }>
  > {
    return this.domainSnapshotOps.buildKnowledgeDocsIndex();
  }

  async clearKnowledgeDocsCache(): Promise<void> {
    return this.domainSnapshotOps.clearKnowledgeDocsCache();
  }

  async getClawHubSkillAdapter() {
    return this.domainSnapshotOps.getClawHubSkillAdapter();
  }

  async validateSkillId(id: string): Promise<string | null> {
    return this.domainSnapshotOps.validateSkillId(id);
  }

  async sanitizeSkillId(name: string): Promise<string> {
    return this.domainSnapshotOps.sanitizeSkillId(name);
  }

  async skillMdRequiresApproval(skillMdText: string): Promise<boolean> {
    return this.domainSnapshotOps.skillMdRequiresApproval(skillMdText);
  }

  async parseSkillFrontmatter(content: string): Promise<{
    frontmatter?: { description?: string | undefined } | undefined;
  }> {
    return this.domainSnapshotOps.parseSkillFrontmatter(content);
  }

  async getPluginAdminPort() {
    return this.domainSnapshotOps.getPluginAdminPort();
  }

  async getToolsPort() {
    return this.domainSnapshotOps.getToolsPort();
  }

  async getAutoReplyPort(): Promise<AutoReplyPort> {
    return this.domainSnapshotOps.getAutoReplyPort();
  }

  async getA2APort(): Promise<A2APort> {
    return this.domainSnapshotOps.getA2APort();
  }

  async getBridgePort(): Promise<BridgePort> {
    return this.domainSnapshotOps.getBridgePort();
  }

  /**
   * 压缩域**同步**门面（2026-10-01 D-217，子批 E `chat` 组）
   *
   * `session/compaction/ServiceAdapters.ts`（service）原先**静态**导入
   * `@openliri/service/services/compact/AutoCompactService`；该目录**改归 app**（现为独立模块
   * `@modules/compaction`，见 spec §3.5 D-217 方案乙）后会构成 `session -> app` 倒挂 ⇒ 改经本门面取用。
   *
   * ⚠️ **为何同步而非端口 Promise**：调用点在 `SessionGateway` 的**构造函数**与
   * **同步 fluent API**（`wireWithRealServices(): this`）内，改异步会向上传染 ⇒ 采用
   * 本仓既有 sanctioned 缝（同 `getChatManager()` / `getToolManager()`）：暴露**同步**取用方法。
   *
   * D-227（2026-10-02，B12）：不再**静态**导入 app 层 `AutoCompactService`，改由组合根经
   * `CoreApiAppDeps.createAutoCompactService` 注入工厂 ⇒ 消除 `runtime -> compaction` 倒挂。
   * 👉 语义不变：**每次调用新建实例**（下方仍以工厂现取现建）。
   */
  createAutoCompactService(): AutoCompactServiceRefPort {
    // D-227：注入工厂**每调用新建**（与旧 `new AutoCompactService()` 同语义）；`unknown` 于落点收窄。
    const service = this.appDeps.createAutoCompactService() as {
      checkAndCompact(
        sessionId: string,
        messages: unknown[],
        model: string
      ): { shouldCompact: boolean };
      performAutoCompact(
        sessionId: string,
        messages: unknown[],
        model: string
      ): Promise<{ success: boolean; error?: string | undefined }>;
    };
    return {
      checkAndCompact: (
        sessionId: string,
        messages: unknown[],
        model: string
      ) => service.checkAndCompact(sessionId, messages, model),
      performAutoCompact: async (
        sessionId: string,
        messages: unknown[],
        model: string
      ) => {
        const result = await service.performAutoCompact(
          sessionId,
          messages,
          model
        );
        return { success: result.success, error: result.error };
      },
    };
  }

  /**
   * 嵌入能力**同步**门面（2026-10-01 D-222，子批 F `ai` 组）
   *
   * `session/memory/SessionMemoryManager.ts` + `session/bootstrap/SessionSystemBootstrap.ts`（service）
   * 原先**静态**导入 app 层 `@modules/ai`（`EmbeddingManager` 类型 + `globalEmbeddingManager` 值）
   * ⇒ 2 条 `session -> ai`(app) 倒挂 ⇒ 改经本门面取用（投影见 `./embeddingPorts#EmbeddingRefPort`）。
   *
   * ⚠️ **为何同步而非端口 Promise**：`getSessionMemoryManager()` 是**同步懒初始化**
   * （`if (!memoryManager) { memoryManager = new SessionMemoryManager(…) }`）⇒ 改异步会向上传染
   * ⇒ 采用本仓既有 sanctioned 缝（同 `createAutoCompactService()` / `getChatManager()`）。
   *
   * D-227（2026-10-02，B12）：不再**静态**导入 app 层 `globalEmbeddingManager`，改由组合根经
   * `CoreApiAppDeps.globalEmbeddingManager` 注入 ⇒ 消除 `runtime -> ai` 倒挂（返回类型不变）。
   */
  getGlobalEmbeddingManager(): EmbeddingRefPort {
    return this.appDeps.globalEmbeddingManager as EmbeddingRefPort;
  }

  // ⚠️ 已删除（2026-10-01，子批 F `runtime -> query` 收口）：B13 曾在此提供
  // `getCheckpointCleanup(): CheckpointCleanupPort` 门面（当时 `FileCheckpointStorage` 还在
  // `query/`(app) 且被判"app 耦合、不可下沉"）。该前提**随 B11 失效**（其唯一 app 耦合
  // `chat/types/checkpoint` 已迁 `session/types/`(service)）⇒ 文件已下沉 `session/storage/`，
  // `session/**` 回归同模块直连 ⇒ **门面与 `./checkpointPorts.ts` 一并作废删除**（净 −1）。

  /**
   * 会话检查点取用**同步**门面（2026-10-01 B11 余 1 条 · `session -> chat` 收口）
   *
   * `session/compaction/ServiceAdapters.ts`（service）原先**静态**导入 app 层 `@modules/chat`
   * 的 `getCheckpointService`（值）与 `SessionCheckpointService`（类型）⇒ 1 条 `session -> chat`(app) 倒挂。
   * ⚠️ 该取用是**装配值**（非类型）⇒ 移类型文件无效 ⇒ 走门面（投影见
   * `./sessionCheckpointPorts#SessionCheckpointRefPort`）。
   *
   * ⚠️ **为何同步**：调用点在**同步函数** `createWiredCompactionBridge()` 体内（由 `SessionGateway`
   * 构造函数 / 同步 fluent API 调用）⇒ 不可改异步 ⇒ 采用本仓既有 sanctioned 缝。
   *
   * D-227（2026-10-02，B12）：不再**静态**导入 app 层 `getCheckpointService`，改由组合根经
   * `CoreApiAppDeps.getCheckpointService` 注入 ⇒ 消除 `runtime -> chat` 倒挂（返回类型不变）。
   */
  getSessionCheckpointRef(): SessionCheckpointRefPort {
    return this.appDeps.getCheckpointService() as SessionCheckpointRefPort;
  }

  // ---- B1 纯搬迁（2026-10-05）：以下 9 个 Ops 端口聚合实现已外迁至同目录 `domainSnapshotOps.ts`；
  // 此处仅保留与被迁实现逐字等价的薄转发。

  async getKnowledgeOpsPort() {
    return this.domainSnapshotOps.getKnowledgeOpsPort();
  }

  async getTaskOpsPort(): Promise<TaskOpsPort> {
    return this.domainSnapshotOps.getTaskOpsPort();
  }

  async getAiOpsPort(): Promise<AiOpsPort> {
    return this.domainSnapshotOps.getAiOpsPort();
  }

  async getQueryOpsPort(): Promise<QueryOpsPort> {
    return this.domainSnapshotOps.getQueryOpsPort();
  }

  async getBuddyOpsPort(): Promise<BuddyOpsPort> {
    return this.domainSnapshotOps.getBuddyOpsPort();
  }

  async getCommandsOpsPort(): Promise<CommandsOpsPort> {
    // 2026-11-24（R00-003 收口）：实现由组合根注入（见 `CoreApiAppDeps.commandsOps`）
    return this.appDeps.commandsOps(this.chatManager);
  }

  async getWorkspaceOpsPort(): Promise<WorkspaceOpsPort> {
    return this.domainSnapshotOps.getWorkspaceOpsPort();
  }

  async getSkillsOpsPort(): Promise<SkillsOpsPort> {
    return this.domainSnapshotOps.getSkillsOpsPort();
  }

  async getProjectOpsPort(): Promise<ProjectOpsPort> {
    return this.domainSnapshotOps.getProjectOpsPort();
  }

  /** 实现已外迁 `sessionAgentOps.ts`（C3-S1，2026-10-09） */
  async listTools(): Promise<ToolInfo[]> {
    return this.sessionAgentOps.listTools();
  }

  async getTool(name: string): Promise<ToolInfo | undefined> {
    return this.sessionAgentOps.getTool(name);
  }

  /** P1「可解释性」（2026-10-16）：薄转发到 `sessionAgentOps`，只读、零行为变更 */
  async getToolVisibilityReport(query?: {
    taskType?: string;
    extraCategories?: readonly string[];
  }): Promise<ToolVisibilityReport[]> {
    return this.sessionAgentOps.getToolVisibilityReport(query);
  }

  async createSession(params?: SessionCreateParams): Promise<SessionInfo> {
    return this.sessionAgentOps.createSession(params);
  }

  /** D3（2026-08-24）：事件级 fork（实现已外迁 `sessionAgentOps.ts`） */
  async forkSession(
    sourceId: string,
    options: {
      boundary?: number;
      childTitle?: string;
      childId?: string;
      truncateBeforeMessageId?: string;
    } = {}
  ): Promise<{
    success: boolean;
    session?: SessionInfo;
    boundary?: number;
    copied?: number;
    error?: string;
  }> {
    return this.sessionAgentOps.forkSession(sourceId, options);
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    return this.sessionAgentOps.getSession(sessionId);
  }

  // ---- B2 纯搬迁（2026-10-05）：以下「消息读取 / 事件派生 / 派生校验 / 事件流 / 审批块」
  // 的实现已外迁至同目录 `sessionMessagesRead.ts`（`SessionMessagesRead`）；
  // 此处仅保留对外入口（`implements CoreAPI` + HTTP 消费者）的薄转发。

  async getSessionMessages(
    sessionId: string,
    query?: Parameters<CoreAPI['getSessionMessages']>[1]
  ): Promise<{
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      tool_calls?: Array<Record<string, unknown>>;
      blocks?: Array<Record<string, unknown>>;
    }>;
    hasMore: boolean;
  }> {
    return this.sessionAgentOps.getSessionMessages(sessionId, query);
  }

  async verifySessionDerivation(sessionId: string): Promise<{
    available: boolean;
    diff?: DerivationDiff;
    reason?: string;
  }> {
    return this.sessionAgentOps.verifySessionDerivation(sessionId);
  }

  getSessionRoundSummaries(
    id: string,
    q?: { limit?: number }
  ): Promise<SessionRoundSummariesResult> {
    return this.sessionAgentOps.getSessionRoundSummaries(id, q);
  }

  async getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      /**
       * 向前补页（P1-1，2026-09-22）：只取 `seq < beforeSeq` 的事件，返回其中
       * **紧邻该点之前**的一页（至多 `limit` 条）。与 `fromSeq` 互斥优先。
       */
      beforeSeq?: number;
      types?: Array<string>;
      limit?: number;
      recent?: boolean;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    /** 更早方向是否还有事件（向前补页用；与 `hasMore` 对称） */
    hasEarlier: boolean;
    hasMore: boolean;
  }> {
    return this.sessionAgentOps.getSessionEvents(sessionId, query);
  }

  async recoverStaleSession(sessionId: string): Promise<boolean> {
    return this.sessionAgentOps.recoverStaleSession(sessionId);
  }

  async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string,
    override?: { content?: string; hiddenBlockIds?: string[] }
  ): Promise<void> {
    return this.sessionAgentOps.updateMessageBlocks(
      sessionId,
      messageId,
      blocks,
      text,
      override
    );
  }

  /**
   * 删除单条消息（软删除）
   */
  async deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{ success: boolean; messages: Array<Record<string, unknown>> }> {
    return this.sessionAgentOps.deleteMessage(sessionId, messageId);
  }

  /**
   * 截断消息（回退到指定消息之前）
   */
  async truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }> {
    return this.sessionAgentOps.truncateMessages(sessionId, beforeMessageId);
  }

  async listSessions(): Promise<SessionInfo[]> {
    return this.sessionAgentOps.listSessions();
  }

  /**
   * 全文搜索消息（FTS5 倒排索引）（实现已外迁 `sessionAgentOps.ts`）
   */
  async searchMessagesFTS(
    query: string,
    limit?: number,
    allowedSessionIds?: Set<string>
  ): Promise<
    Array<{
      id: string;
      sessionId?: string;
      title: string;
      content: string;
      snippet: string;
      score: number;
      timestamp: number;
    }>
  > {
    return this.sessionAgentOps.searchMessagesFTS(
      query,
      limit,
      allowedSessionIds
    );
  }

  /** 轻量列出会话元数据 — 只读文件头 64KB，不加载完整会话（P2：含作用域字段） */
  async listLiteSessions(): Promise<LiteSessionSummary[]> {
    return this.sessionAgentOps.listLiteSessions();
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionAgentOps.deleteSession(sessionId);
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    return this.sessionAgentOps.clearAllSessions(moduleType);
  }

  async switchSession(sessionId: string): Promise<void> {
    // 2026-09-25（附带发现 8 根因）：原写法 `this.chatManager.switchSession(sessionId);`
    // **既不 await 也不 catch** ⇒ 两个后果：① 该 promise 的 rejection 无人消费，泄漏为全局
    // `unhandledRejection`（曾产生 37 份崩溃转储）；② **`await coreAPI.switchSession()` 的调用方
    // （如 `session-handlers.ts` 的 HTTP 处理器）立刻拿到 `undefined`**，导致"切到不存在会话"
    // **返回成功而非设计中的 404**，前端 P2-3 的跳转/清空分支从未生效。
    // 必须**传播**该 promise（`return`），让 404 语义与拒绝归属都回到调用方。
    return this.sessionAgentOps.switchSession(sessionId);
  }

  /**
   * P2-5 修复：压缩会话（实现已外迁 `sessionAgentOps.ts`）
   */
  async compactSession(sessionId: string): Promise<unknown> {
    return this.sessionAgentOps.compactSession(sessionId);
  }

  /**
   * 修剪（清理过期/超出保留策略的会话）（实现已外迁 `sessionAgentOps.ts`）
   */
  async pruneSessions(): Promise<unknown> {
    return this.sessionAgentOps.pruneSessions();
  }

  /**
   * 重命名会话标题（实现已外迁 `sessionAgentOps.ts`；`implements CoreAPI` + HTTP/命令/测试消费者）
   */
  async renameSession(
    sessionId: string,
    title: string,
    source: 'user' | 'ai' = 'user'
  ): Promise<void> {
    return this.sessionAgentOps.renameSession(sessionId, title, source);
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：设置占位标题（实现已外迁 `sessionAgentOps.ts`）
   */
  async setPreliminaryTitle(sessionId: string, title: string): Promise<void> {
    return this.sessionAgentOps.setPreliminaryTitle(sessionId, title);
  }

  /**
   * E-3（2026-08-23，方案 D2-B）：是否需要生成/精化标题
   * （实现已外迁 `sessionAgentOps.ts` → `sessionTitling.ts`；
   * 测试消费者经实例方法调用形态访问宿主 ⇒ 保留同名私有转发）
   */
  private shouldAutoTitle(sessionId: string): boolean {
    return this.sessionAgentOps.shouldAutoTitle(sessionId);
  }

  /**
   * 更新会话元数据（实现已外迁 `sessionAgentOps.ts`；`implements CoreAPI` + HTTP 消费者）
   */
  async updateSessionMeta(
    sessionId: string,
    // 参数类型**直接取接口**（唯一事实源）——避免此处与 `CoreAPI` 漂移，
    // 也避免为本文件再抄一份字段清单（R04-001 行数上限亦受影响）。
    meta: Parameters<CoreAPI['updateSessionMeta']>[1]
  ): Promise<void> {
    return this.sessionAgentOps.updateSessionMeta(sessionId, meta);
  }

  /**
   * 生成会话标题（实现已外迁 `sessionAgentOps.ts`；`implements CoreAPI` + HTTP 消费者）
   */
  async generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null> {
    return this.sessionAgentOps.generateSessionTitle(
      sessionId,
      userMessage,
      assistantResponse
    );
  }

  async getCurrentSession(): Promise<SessionInfo | undefined> {
    return this.sessionAgentOps.getCurrentSession();
  }

  async executeAgentTask(params: AgentTaskParams): Promise<AgentResult> {
    return this.sessionAgentOps.executeAgentTask(params);
  }

  async getAgentProgress(agentId: string): Promise<AgentProgress | undefined> {
    return this.sessionAgentOps.getAgentProgress(agentId);
  }

  async convertFile(params: ConvertFileParams): Promise<ConversionResult> {
    return this.sessionAgentOps.convertFile(params);
  }

  async detectFileType(filePath: string): Promise<FileInfo> {
    return this.sessionAgentOps.detectFileType(filePath);
  }

  /**
   * 获取内部 ChatManager 实例
   * 供 REPL 等入口进行 LLM 客户端配置
   */
  getChatManager(): ChatManager {
    return this.chatManager;
  }

  /**
   * 获取内部 ToolManager 实例
   * 供 REPL 等入口获取工具注册表
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }

  /**
   * 解析待处理的用户交互（question 回答）
   * 当 LLM 通过 ask_user_question 工具向用户提问后，前端调用此方法提交回答
   */
  async resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean> {
    return this.chatManager.resolveInteraction(questionId, answers, sessionId);
  }

  /**
   * P0: 附件清理 — 删除消息后清理孤儿附件文件
   * 检查引用计数，仅当附件不被任何未删除消息引用时才删除文件
   */
  private async cleanupOrphanAttachments(
    sessionId: string,
    deletedMessageIds: string[]
  ): Promise<void> {
    try {
      const session = this.sessionManager.getSession(sessionId);
      if (!session) return;

      const allMessages = session.messages || [];
      const deletedSet = new Set(deletedMessageIds);

      // 收集被删消息的附件 URL 列表
      const deletedAttachments = new Map<
        string,
        { name: string; url: string }
      >();
      for (const msg of allMessages) {
        if (deletedSet.has(msg.id)) {
          const attachments = (msg as unknown as Record<string, unknown>)
            .attachments as Array<{ name: string; url: string }> | undefined;
          if (attachments) {
            for (const att of attachments) {
              if (att.url) {
                deletedAttachments.set(att.url, att);
              }
            }
          }
        }
      }

      if (deletedAttachments.size === 0) return;

      // 检查剩余消息是否引用相同的附件（引用计数）
      const remainingRefs = new Set<string>();
      for (const msg of allMessages) {
        if (!deletedSet.has(msg.id)) {
          const attachments = (msg as unknown as Record<string, unknown>)
            .attachments as Array<{ url: string }> | undefined;
          if (attachments) {
            for (const att of attachments) {
              if (att.url) {
                remainingRefs.add(att.url);
              }
            }
          }
        }
      }

      // 清理零引用附件
      const { unlink } = await import('fs/promises');
      let cleanedCount = 0;
      for (const [url] of deletedAttachments) {
        if (!remainingRefs.has(url)) {
          try {
            // 尝试从 URL 解析文件路径
            // URL 格式可能是 file:///path 或绝对路径
            let filePath = url;
            if (url.startsWith('file://')) {
              filePath = url.slice(7);
            }
            if (filePath.includes('attachments')) {
              await unlink(filePath);
              cleanedCount++;
            }
          } catch {
            // 文件不存在或无法删除，跳过
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info('附件清理完成', {
          sessionId,
          deletedMessageCount: deletedMessageIds.length,
          cleanedAttachments: cleanedCount,
        });
      }
    } catch (err) {
      // 非关键路径，失败不影响主流程
      logger.debug('附件清理异常', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
