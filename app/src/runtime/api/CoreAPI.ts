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
 * CoreAPI 核心接口
 * 统一的应用门面，为所有外部入口（CLI、Bridge、通道插件）提供一致的功能入口
 liriliri*/

import type { ConversionResult, FileInfo } from '@modules/tools';
import type { TodoBlockData } from './todo-types';
import type { DocWorkflowProgressData } from '@modules/doc/types/outline';
import type { LiriEvent } from '@modules/session/types/events';
// P2-7 / G4（2026-09-25）：派生一致性校验结果
import type { DerivationDiff } from '@modules/session';
// C1 站点 7（2026-09-30 D-90）：第三方技能适配器**服务层端口**（见同目录 thirdPartySkillPorts.ts）
import type { ThirdPartySkillAdapterPort } from './thirdPartySkillPorts';
// C1（2026-09-30 D-92）：插件管理**服务层端口**（见同目录 pluginAdminPorts.ts）
import type { PluginAdminPort } from './pluginAdminPorts';
// C1（2026-09-30 D-93）：工具运行时**服务层端口**（见同目录 toolsPorts.ts）
import type { ToolsPort } from './toolsPorts';
// C1（2026-09-30 D-95）：知识库运维 P1**服务层端口**（见同目录 knowledgeOpsPorts.ts）
import type { KnowledgeOpsPort } from './knowledgeOpsPorts';
// C1（2026-09-30 D-98）：任务运维 P1**服务层端口**（见同目录 taskOpsPorts.ts）
import type { TaskOpsPort } from './taskOpsPorts';
// C1（2026-09-30 D-106）：AI 运维 P1**服务层端口**（见同目录 aiOpsPorts.ts）
import type { AiOpsPort } from './aiOpsPorts';
// C1（2026-09-30 D-111，零散单点收尾）：三个小域**服务层端口**
import type { QueryOpsPort } from './queryOpsPorts';
import type { BuddyOpsPort } from './buddyOpsPorts';
import type { CommandsOpsPort } from './commandsOpsPorts';
import type { WorkspaceOpsPort } from './workspaceOpsPorts';
import type { ProjectOpsPort } from './projectOpsPorts';

/** 进度事件，用于通知调用方当前 AI 处理阶段 */
export interface ProgressEvent {
  /** 处理阶段 */
  stage: 'analyzing' | 'tool_executing' | 'generating' | 'completed';
  /** 人类可读的描述 */
  message: string;
  /** 工具名称（仅在 tool_executing 阶段存在） */
  toolName?: string;
  /** 上下文水位状态（当 stage='generating' 且水位非 normal 时存在） */
  watermarkState?: {
    currentTokens: number;
    contextLimit: number;
    ratio: number;
    severity: 'normal' | 'warn' | 'compact';
  };
}

/** 聊天请求 */
export interface ChatRequest {
  content: string;
  sessionId?: string;
  /** 前端写前落盘的用户消息 id（幂等去重用） */
  messageId?: string;
  /** 前端流式消息 id（P0 根治：后端 createAssistantMessage 复用，使 blocks 落盘命中） */
  assistantMessageId?: string;
  stream?: boolean;
  metadata?: Record<string, unknown>;
  /** 用户消息附带的图片信息 */
  images?: Array<{ path: string; url: string; filename: string; size: number }>;
  /** 进度回调，用于在非流式路径中获取 AI 处理阶段信息 */
  onProgress?: (event: ProgressEvent) => void;
  /** 前端指定的模型名（用户在状态栏/侧边栏选择的模型）。
   *  设置后优先于 SmartRouter/ModelRouter 的自动决策。 */
  model?: string;
  /** LLM 温度参数 (0-2)，控制输出随机性 */
  temperature?: number;
  /** LLM top_p 参数 (0-1)，核采样阈值 */
  top_p?: number;
  /** 最大输出 token 数 */
  max_tokens?: number;
  /** 自定义系统提示词（覆盖默认） */
  systemPrompt?: string;
  /** P0-1（2026-08-26）：流中断续写——携带已生成内容，请求从断点继续而非从头重发 */
  continue_from?: { content: string; messageId?: string };
}

/** 聊天响应 */
export interface ChatResponse {
  content: string;
  sessionId: string;
  messageId?: string;
  toolCalls?: ToolCallSpec[];
  finishReason?: string;
  /** 非流式路径中，当工具需要用户交互时，返回待处理的提问数据 */
  pendingInteraction?: QuestionData;
}

/** 流式聊天数据块 */
/** Token 用量信息 */
export interface StreamUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** 工具需要用户交互时的选项数据 */
export interface QuestionOption {
  label: string;
  description: string;
}

/** 工具需要用户交互时的提问数据 */
export interface QuestionData {
  questionId: string;
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  /** 提问类型（v0.5 新增，对齐 PendingQuestion.type） */
  questionType?: 'choice' | 'open' | 'confirm';
}

export interface ChatStreamChunk {
  type:
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'status'
    | 'done'
    | 'error'
    | 'question'
    | 'todo'
    | 'execution_phase'
    | 'context_state'
    | 'doc_workflow'
    | 'deliverable'
    | 'diff';
  content: string;
  sessionId: string;
  toolCall?: ToolCallSpec;
  status?: string;
  /** P1-7（2026-08-23）：text/thinking chunk 携带归属 assistant 消息 id（SSE 透传） */
  messageId?: string;
  /**
   * O2-4（2026-09-24「会话暴露问题分析与优化方案」§五）：**正文取代标记**（仅 `type='text'`）。
   *
   * `true` = 本 delta **取代**该消息此前已下发的正文（续接/重试轮的首个 delta）。
   * 后端每轮把 `assistantMessage.content` 整体替换为本轮文本；前端此前只 append ⇒ 前端多出
   * 重复段落且与落盘不同源（违反 `project_rules §1.6`「所见即所存」）。前端收到本标记须**清空
   * 该消息已累积的正文块**再追加，使流内视图与落盘一致。
   */
  replace?: boolean;
  /** 仅当 type='status' 且为工具状态块时存在：关联的 toolCallId（前端按 toolCallId 去重，CS02） */
  toolCallId?: string;
  usage?: StreamUsageInfo;
  /** 仅在 type='question' 时存在 */
  questionData?: QuestionData;
  /** 仅在 type='todo' 时存在 */
  todoData?: TodoBlockData;
  /** 仅在 type='execution_phase' 时存在：执行阶段数据 */
  executionPhase?: ExecutionPhaseData;
  /** 进度数据（ProgressData 格式） */
  progressData?: ProgressBlockData;
  /** 交付物数据（DeliverableData 格式） */
  deliverableData?: DeliverableBlockData;
  /** diff 数据 */
  diffData?: DiffBlockData;
  /** 仅在 type='doc_workflow' 时存在：文档工作流进度数据 */
  docWorkflowData?: DocWorkflowProgressData;
  /** 工作模式（Plan/Do） */
  mode?: 'plan' | 'do';
  /** 仅当 type='done' 时存在：模型的终止原因 */
  finishReason?: string;
  /** 仅当 type='context_state' 时存在：上下文水位 */
  watermarkState?: {
    currentTokens: number;
    contextLimit: number;
    ratio: number;
    severity: 'normal' | 'warn' | 'compact';
  };
  /** 状态子类型 — 替代前端对 content 的字符串匹配 (CS02) */
  statusType?:
    | 'ai_thinking'
    | 'retry'
    | 'task_all_done'
    | 'resume'
    | 'tool_retry'
    | 'compaction'
    | 'tool_running'
    | 'tool_completed'
    | 'tool_failed'
    // A3（2026-09-05）：截断状态标记（取代 content 文本匹配）
    | 'truncated'
    // A1 T4/T5（2026-10-05）：挂起提问 fail-closed 结算（用户可见，不静默）
    | 'suspension_settled';
  /** 压缩状态阶段（仅 statusType='compaction' 时存在）：compacting=进行中 / done=完成 / error=压缩或构建异常（P0-1） */
  phase?: 'compacting' | 'done' | 'error';
  /** 结构化错误码 — 替代前端对 error message 的字符串匹配 (CS02) */
  errorCode?:
    | 'UNKNOWN'
    | 'RATE_LIMITED'
    | 'AUTH_ERROR'
    | 'QUOTA_EXCEEDED'
    | 'CONNECTION_RESET'
    | 'STREAM_INTERRUPTED'
    | 'BACKEND_UNREACHABLE';
  /** 前端导航/提示元数据（如 create_project 完成后建议跳转到项目页） */
  _meta?: Record<string, unknown>;
}

/** 执行阶段数据 */
export interface ExecutionPhaseData {
  phase:
    | 'analyzing'
    | 'designing'
    | 'implementing'
    | 'verifying'
    | 'presenting';
  progress: number;
  description: string;
  steps?: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  /** 完整 steps 条目数（截断前），供前端显示真实计数 */
  totalSteps?: number;
  /** 是否因超长被截断（仅保留最近 N 条，见 ToolLoopRunner.MAX_HEARTBEAT_STEPS） */
  truncated?: boolean;
  currentStep?: string;
}

/** 进度块数据 */
export interface ProgressBlockData {
  steps: {
    name: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed';
  }[];
  currentStep: string;
}

/** 交付物块数据 */
export interface DeliverableBlockData {
  files: {
    path: string;
    change: 'added' | 'modified' | 'deleted';
    status: 'pending' | 'verified' | 'failed';
  }[];
  summary: string;
}

/** diff 块数据 */
export interface DiffBlockData {
  file: string;
  diff: string;
  language?: string;
}

/** 工具调用描述 */
export interface ToolCallSpec {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status?: 'running' | 'completed' | 'failed';
  /** P0-2（2026-08-14）：工具执行结果（普通工具经 tool_end 下发，前端渲染结果内容） */
  result?: unknown;
  /** 工具执行失败原因（仅 status='failed' 时存在，前端日志面板据此展示失败原因） */
  error?: string;
}

/** 工具执行结果 */
export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error: string | null;
  executionTime: number;
}

/** 工具元信息 */
export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

/** 会话信息 */
export interface SessionInfo {
  id: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  roundCount: number;
  /** 渠道来源标识，如 'web'、'qq'、'discord' 等 */
  source?: string;
  metadata?: Record<string, unknown>;
}

/** 会话创建参数 */
export interface SessionCreateParams {
  title?: string;
  tags?: string[];
  mode?: string;
  /** 会话元数据（如 workspaceId、workMode 等） */
  metadata?: Record<string, unknown>;
}

/** Agent 任务参数 */
export interface AgentTaskParams {
  description: string;
  prompt: string;
  subagentType?: string;
  model?: string;
  runInBackground?: boolean;
}

/** Agent 执行进度 */
export interface AgentProgress {
  agentId: string;
  state: string;
  progress: number;
  message: string;
}

/** Agent 执行结果 */
export interface AgentResult {
  agentId: string;
  content: string;
  state: string;
  summary: {
    durationMs: number;
    tokensUsed: number;
  };
}

/** 文件转换参数 */
export interface ConvertFileParams {
  filePath: string;
  outputFormat?: string;
  options?: Record<string, unknown>;
}

/**
 * CoreAPI 核心接口
 * 应用唯一对外门面，所有模块之间也通过此接口交互
 */
export interface CoreAPI {
  // ========== 聊天 ==========

  /** 发送消息（同步模式） */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** 发送消息（流式模式） */
  chatStream(
    request: ChatRequest
  ): AsyncGenerator<ChatStreamChunk, ChatResponse, unknown>;

  /** 解析待处理的用户交互（question 回答），sessionId 可选（多会话精确定位） */
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean>;

  // ========== 工具 ==========

  /** 执行工具 */
  executeTool(sessionId: string, toolCall: ToolCallSpec): Promise<ToolResult>;

  /** 获取所有已注册工具 */
  listTools(): Promise<ToolInfo[]>;

  /** 获取指定工具详情 */
  getTool(name: string): Promise<ToolInfo | undefined>;

  // ========== 领域只读快照（HTTP 等 service 侧消费；2026-09-30 D-85）==========

  /**
   * Git 上下文快照（**只读**）。
   *
   * 2026-09-30（台账 D-85，C1「口径 C」）：此前 HTTP handler 直接动态导入 app 层
   * `context/GitContextService` ⇒ `service → app` 跨层引用（只在 `R00-003` 里可见）。
   * 改为经本门面暴露 ⇒ **handler 只依赖 service 层**；app 侧动态导入收敛到
   * `CoreAPIImpl`（本仓既有的 sanctioned `service → app` 缝，如 `chatManager` / `chat()`）。
   *
   * ⚠️ **DTO 内联自持**：不引用 app 层类型（`R00-001` 连类型导入也计），字段按结构对齐
   * app 层 `GitContextService.GitStatusInfo`。
   */
  getGitContextSnapshot(): Promise<{
    /** 是否为 Git 仓库 */
    isGitRepo: boolean;
    /** 仓库状态详情（非仓库时为 null） */
    status: {
      branch: string;
      mainBranch: string;
      status: string;
      recentCommits: string;
      userName: string | null;
    } | null;
  }>;

  /**
   * PathGuard 指标快照（只读，HTTP 路由用）。
   *
   * 2026-09-30（台账 D-85，C1「口径 C」）：原 `monitoring-handlers.ts` 直接动态导入
   * `@modules/chat/services/PathGuardService`（`service → app`，仅 `R00-003` 可见）⇒ 收敛到本门面。
   * **DTO 不透明**（`Record<string, unknown>`）：service 侧**仅透传序列化**、不读字段 ⇒ 避免镜像字段漂移。
   */
  getPathGuardMetrics(): Promise<Record<string, unknown>>;

  /** 重置 PathGuard 指标（上一条的写侧对应操作） */
  resetPathGuardMetrics(): Promise<void>;

  // ========== 工作空间（HTTP 路由用；2026-09-30 D-85）==========

  /** 列出工作空间条目（字段与 app 层 `WorkspaceStorage.buildEntries()` 对齐并摊平 meta） */
  listWorkspaceEntries(): Promise<
    Array<{
      id: string;
      name: string;
      path: string;
      description: string | undefined;
      createdAt: string;
      updatedAt: string;
    }>
  >;

  /** 按 id 取工作空间物理路径（不存在时 null） */
  getWorkspacePath(workspaceId: string): Promise<string | null>;

  /** 删除工作空间（按物理路径；与 app 层 `deleteWorkspace(path)` 同义） */
  deleteWorkspace(path: string): Promise<void>;

  // ========== 梦境（HTTP 路由用；2026-09-30 D-87）==========
  // ⚠️ 全部为**不透明 DTO**：service 侧仅透传序列化（原 handler 即如此）⇒ 不镜像 app 字段，免漂移。

  /** 梦境周期列表（分页 / 来源 / 状态 / 时间窗 / 排序；返回值调用方**展开**使用 ⇒ `object`） */
  listDreamCycles(params: {
    page: number;
    pageSize: number;
    triggerSource?: string;
    status?: string;
    startTime?: number;
    endTime?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<object>;

  /** 梦境周期查询 + 聚合（app 层 `queryCycles` + `aggregateCycles`） */
  queryDreamCycles(filter: {
    from?: number;
    to?: number;
    triggerSource?: string;
    status?: string;
    limit?: number;
  }): Promise<{ cycles: unknown; stats: unknown }>;

  /** 读取单个梦境周期（不存在时 null） */
  getDreamCycle(cycleId: string): Promise<unknown | null>;

  /** 读取梦境指标（文件缺失/读取失败时 null —— 原 handler 以 `catch {}` 吞掉） */
  readDreamMetrics(): Promise<unknown | null>;

  // ========== 知识库文档（HTTP 路由用；2026-09-30 D-88）==========
  // `buildIndex()` 的返回值调用方**会 `.map`/`.length` 并读字段** ⇒ 不能用 `unknown`/`object`，
  // 故按消费方**实际读取面**给最小投影 DTO（字段一律 `?: T | undefined`，兼容 app 侧"可选"与"必填含 undefined"两种写法）。

  /** 知识库文档索引（app 层 `FileDocsProvider.buildIndex()`；单例透传） */
  buildKnowledgeDocsIndex(): Promise<
    Array<{
      /** app 侧为**必填** `string`（原调用方直接传入 `path.join` 无回退 ⇒ 据此定必填） */
      relativePath: string;
      content?: string | undefined;
      title?: string | undefined;
      source?: string | undefined;
      category?: string | undefined;
      tags?: string[] | undefined;
    }>
  >;

  /** 清空知识库文档索引缓存（app 层同一单例的 `clearCache()`） */
  clearKnowledgeDocsCache(): Promise<void>;

  // ========== 第三方技能适配器（HTTP 路由用；2026-09-30 D-90）==========

  /**
   * 取得 ClawHub 第三方技能适配器（**服务层端口**，见 `./thirdPartySkillPorts`）。
   *
   * **为什么是"端口 + 单入口"而非平铺方法**：该适配器有 **12+ 方法 / 19 处调用点**，
   * 平铺会撑爆本接口（详见 spec `layer-inversion-a-class-inventory.md` §3.8）。
   * 编排（registry 查找 → `instanceof` 收窄 → `initialize()` → 单例 fallback）内聚在 `CoreAPIImpl`。
   */
  getClawHubSkillAdapter(): Promise<ThirdPartySkillAdapterPort>;

  // ---- 技能 ID 安全 / 权限解析（同批：消除 handler 内剩余 `@modules/skills/**` 动态导入，D-91）----

  /** 技能 ID 校验（app 层 `safeSkillId.validateSkillId`；返回**错误信息**，`null` = 通过） */
  validateSkillId(id: string): Promise<string | null>;

  /** 技能 ID 清洗（app 层 `safeSkillId.sanitizeSkillId`；返回安全目录名，可能为空串） */
  sanitizeSkillId(name: string): Promise<string>;

  /**
   * SKILL.md 是否**声明了敏感权限**（需用户审批）。
   * 合并门面：内部等价于 app 层 `hasSensitivePermission(parseSkillPermissions(text))` ——
   * 合并为**单布尔输出**可避免把 app 的权限类型泄漏到服务层（端口禁止引用 app 类型）。
   */
  skillMdRequiresApproval(skillMdText: string): Promise<boolean>;

  /**
   * 解析 SKILL.md frontmatter（app 层 `skillParser.parseSkillFrontmatter` 的**最小投影**）。
   * 调用方只读 `frontmatter.description`（其余键自行 `as Record<string, unknown>` 收窄），
   * 故此处仅声明 `frontmatter` 存在性与 `description`；`frontmatter` 可为 `undefined`
   * （调用方原用 `?.` 访问 ⇒ 据此定可选）。
   */
  parseSkillFrontmatter(content: string): Promise<{
    frontmatter?: { description?: string | undefined } | undefined;
  }>;

  // ========== 插件管理（HTTP 路由用；2026-09-30 D-92）==========

  /**
   * 取得插件管理端口（**服务层端口**，见 `./pluginAdminPorts`）。
   * 同 `getClawHubSkillAdapter()`：13 方法 / 13 处调用点 ⇒ 走**端口 + 单入口**而非平铺，
   * 避免 `CoreAPI` 膨胀；app 对象引用与 `new NpmDistributor()` 内聚在 `CoreAPIImpl`。
   */
  getPluginAdminPort(): Promise<PluginAdminPort>;

  // ========== 工具运行时（HTTP 路由用；2026-09-30 D-93）==========

  /**
   * 取得工具运行时端口（**服务层端口**，见 `./toolsPorts`）。
   * 8 方法 / 4 文件（`video`/`image`/`knowledge`/`video-task` handler）⇒ 走**端口 + 单入口**。
   */
  getToolsPort(): Promise<ToolsPort>;

  // ========== 知识库运维（HTTP 路由用；2026-09-30 D-95，`knowledge` 域 P1）==========

  /**
   * 取得知识库运维端口（**服务层端口**，见 `./knowledgeOpsPorts`）。
   * P1 = 4 文件 / 13 处 / 4 对（`datasource` · `graph` · 编译调度 · `faq`）；
   * P2/P3（`semantic-index-handlers` · `knowledge-handlers` 43 处）见 spec §3.11。
   */
  getKnowledgeOpsPort(): Promise<KnowledgeOpsPort>;

  // ========== 任务运维（HTTP 路由用；2026-09-30 D-98，`tasks` 域 P1）==========

  /**
   * 取得任务运维端口（**服务层端口**，见 `./taskOpsPorts`）。
   * P1 = 4 文件 / 12 处（`agent1` · `agent2` · `kanban` · `task-handlers`）；
   * P2 = `cron-handlers` 11 处（cron 四件套）；
   * P3 = `plan-flow-handlers` 8 处（任务编排 / 计划 + 任务流注册表）+ `pdca-handlers` 11 处（PDCA）；
   * P4 = `inbox-handlers` + `research-handlers` + `sessionWaitFields` + `goal-routes` 8 处
   * ⇒ **`infrastructure → tasks` 整域清零**（spec §3.12）。
   */
  getTaskOpsPort(): Promise<TaskOpsPort>;

  // ========== AI 运维（HTTP 路由用；2026-09-30 D-106，`ai` 域 P1）==========

  /**
   * 取得 AI 运维端口（**服务层端口**，见 `./aiOpsPorts`）。
   * P1 = 4 文件 / 4 处（`LocalHTTPServiceHelpers` · `knowledge-handlers` · `semantic-index-handlers`
   * · `research-handlers`）；
   * P3（`agent-role` + `auth-access` + `translation`，**静态引用**）·
   * P4 = `llama-handlers` 16 处（本地模型管理五件套）⇒ **`infrastructure → ai` 整域清零**（spec §3.13）。
   */
  getAiOpsPort(): Promise<AiOpsPort>;

  // ========== 查询日志 / Buddy / 命令（零散单点收尾；2026-09-30 D-111）==========

  /** 取得查询日志运维端口（**服务层端口**，见 `./queryOpsPorts`）—— 本批仅覆盖 `analytics-handlers` 所需面 */
  getQueryOpsPort(): Promise<QueryOpsPort>;

  /** 取得 Buddy 运维端口（**服务层端口**，见 `./buddyOpsPorts`）—— 本批 = `buddy-handlers` 所需面 */
  getBuddyOpsPort(): Promise<BuddyOpsPort>;

  /** 取得命令运维端口（**服务层端口**，见 `./commandsOpsPorts`）—— 本批 = `commands-handlers` 所需面 */
  getCommandsOpsPort(): Promise<CommandsOpsPort>;

  /** 取得工作空间运维端口（**服务层端口**，见 `./workspaceOpsPorts`）—— 本批仅覆盖**动态**取用面 */
  getWorkspaceOpsPort(): Promise<WorkspaceOpsPort>;

  /** 取得项目运维端口（**服务层端口**，见 `./projectOpsPorts`）—— 本批仅覆盖**动态**取用面 */
  getProjectOpsPort(): Promise<ProjectOpsPort>;

  // ========== 会话 ==========

  /** 创建新会话 */
  createSession(params?: SessionCreateParams): Promise<SessionInfo>;

  /**
   * D3（2026-08-24）：事件级 fork——从源会话任意历史 seq（boundary）fork 出子会话
   * 复制 [1..boundary] 前缀事件 + 血缘（parentSessionId/seedLength），保留原 seq。
   * boundary 落在 open turn 内或无效时 success=false 并返回 error。
   */
  forkSession(
    sourceId: string,
    options?: { boundary?: number; childTitle?: string }
  ): Promise<{
    success: boolean;
    session?: SessionInfo;
    boundary?: number;
    copied?: number;
    error?: string;
  }>;

  /** 获取会话信息 */
  getSession(sessionId: string): Promise<SessionInfo | undefined>;

  /**
   * P2-7 / G4（2026-09-25）：**派生一致性校验**（比对纯事件派生基线 vs 落盘投影）。
   *
   * **只报告事实、不改写**（自动修复会掩盖根因）。`available=false` 表示该会话
   * 无事件日志或无 v1（`messageId`）事件 ⇒ **无法校验**（**不是**"一致"）。
   */
  verifySessionDerivation(sessionId: string): Promise<{
    available: boolean;
    diff?: DerivationDiff;
    reason?: string;
  }>;

  /** 获取会话消息列表
   * @param query.limit 分页大小（传 >0 时启用分页，取末尾 limit 条；不传返回全量，行为不变）
   * @param query.before lastEventSeq 游标（可选，返回该游标之前的消息）
   */
  getSessionMessages(
    sessionId: string,
    query?: { limit?: number; before?: number }
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
  }>;

  /**
   * M1 事件溯源：获取会话事件流
   *
   * 首次访问时若 events.jsonl 不存在但 messages.jsonl 存在，自动触发迁移。
   * 返回结果含 tailSeq 与 hasMore，支持增量拉取。
   */
  getSessionEvents(
    sessionId: string,
    query?: {
      fromSeq?: number;
      toSeq?: number;
      types?: Array<string>;
      limit?: number;
      /**
       * 尾优先窗口（N-45，2026-09-20）：未传 `fromSeq` 时取**最后 limit 条**，
       * 供"只关心末轮标记"的读时派生使用（如 `turn/end` 的 finishReason）。
       */
      recent?: boolean;
    }
  ): Promise<{
    events: Array<LiriEvent>;
    tailSeq: number;
    hasMore: boolean;
  }>;

  /** 更新消息的 blocks 结构 */
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void>;

  /** 删除单条消息（软删除） */
  deleteMessage(
    sessionId: string,
    messageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
  }>;

  /** 截断消息（回退到指定消息之前） */
  truncateMessages(
    sessionId: string,
    beforeMessageId: string
  ): Promise<{
    success: boolean;
    messages: Array<Record<string, unknown>>;
    remainingRollbacks: number;
    deletedMessageIds: string[];
    undoResults: Array<{ roundId: number; success: boolean; error?: string }>;
  }>;

  /** 列出所有会话 */
  listSessions(): Promise<SessionInfo[]>;

  /** 删除会话 */
  deleteSession(sessionId: string): Promise<void>;

  /** 清除所有会话 */
  clearAllSessions(): Promise<void>;

  /** 切换当前会话 */
  switchSession(sessionId: string): Promise<void>;

  /**
   * 重命名会话标题
   * @param source E-3（2026-08-23）：'user'（手动改名，titleStage=manual）| 'ai'（AI 精化，titleStage=final），默认 'user'
   */
  renameSession(
    sessionId: string,
    title: string,
    source?: 'user' | 'ai'
  ): Promise<void>;

  /** 更新会话元数据（模型绑定、工作空间、任务分工、置顶等） */
  updateSessionMeta(
    sessionId: string,
    meta: {
      model?: string;
      /** plan/do 工作模式（见 `.trae/specs/plan-do-mode.md`；输入区开关写入，缺省由前端按 plan 派生） */
      workMode?: 'plan' | 'do';
      workspaceId?: string;
      providerId?: string;
      tasksOverride?: Record<string, string>;
      pinned?: boolean;
    }
  ): Promise<void>;

  /** 生成会话标题 */
  generateSessionTitle(
    sessionId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<string | null>;

  /** 获取当前会话 */
  getCurrentSession(): Promise<SessionInfo | undefined>;

  // ========== Agent ==========

  /** 执行 Agent 任务 */
  executeAgentTask(params: AgentTaskParams): Promise<AgentResult>;

  /** 获取 Agent 进度 */
  getAgentProgress(agentId: string): Promise<AgentProgress | undefined>;

  // ========== 文件转换 ==========

  /** 转换文件为 Markdown */
  convertFile(params: ConvertFileParams): Promise<ConversionResult>;

  /** 检测文件类型 */
  detectFileType(filePath: string): Promise<FileInfo>;
}
