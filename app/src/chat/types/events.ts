/**
 * 事件溯源 — 事件类型定义
 *
 * 设计参考：deepseek-harness packages/core/session/src/types.ts
 * 父方案：dev_docs/20260821/M1-事件溯源迁移-详细技术方案.md §1
 *
 * 核心原则：
 *   1. seq 全局单调递增（会话内）—— 追加时 seq <= tailSeq 直接拒绝
 *   2. type 细粒度 —— thinking 和 text 是不同 type，不可能串话
 *   3. ignorable 安全 —— 未知 type 可跳过，向前兼容
 *   4. sourceEventSeqs 溯源 —— 聚合事件可引用合成它的更早事件
 *
 * 与现有 Message 类型的关系：并行存在，不替换（M1 兼容期双写）。
 * 事件流是真相源，messages.jsonl 仅为兼容期保留。
 */

import type { DataAttachment } from '@modules/core';

// ─── 事件类型枚举 ─────────────────────────────────────────────────────────────

/**
 * 事件类型（细粒度）
 *
 * 命名约定：`<分类>/<动作>`
 *   - conversation 分类：user/message, assistant/*
 *   - tool 分类：assistant/tool_call, tool/result
 *   - context 分类：context/*
 *   - system 分类：system/*, metric/*
 *   - channel 分类：channel/*
 *   - lifecycle 分类：turn/*, session/*
 */
export type LiriEventType =
  // ─── 对话核心 ───
  | 'turn/start'
  | 'turn/end'
  | 'user/message'
  | 'assistant/thinking'
  | 'assistant/text'
  // F-2（2026-09-02）：text 流式 chunk 聚合批事件（服务端 64KB/2s 合并落盘）
  | 'assistant/text-batch'
  | 'assistant/tool_call'
  | 'tool/result'
  | 'tool/canceled'
  // ─── 富块（M4-1-a 扩展，覆盖 question/todo/progress/doc_workflow/status） ───
  | 'assistant/status'
  | 'assistant/progress'
  | 'assistant/question'
  | 'assistant/todo'
  | 'assistant/doc_workflow'
  // P2-A（2026-09-17）：PDCA 自动启动快照富块（聊天正文内嵌卡片）
  | 'assistant/pdca_workflow'
  | 'assistant/truncation'
  // ─── 交付物/diff（E-1，2026-08-23：deliverable/diff 事件化，T-H.2） ───
  | 'assistant/deliverable'
  | 'assistant/diff'
  // ─── 上下文管理 ───
  | 'context/compaction'
  | 'context/summary'
  // TR-12-B（2026-09-22）：模型输入快照（工具清单 + 系统提示词分段，引用式去重）
  | 'context/model-input'
  // D-1（2026-09-02）：会话远期摘要事件化落盘（摘要也是轨迹，见 §8 设计）
  | 'session/summary'
  // ─── 系统与日志 ───
  | 'system/error'
  | 'system/warning'
  | 'system/info'
  | 'metric/timing'
  // ─── 通道 ───
  | 'channel/connect'
  | 'channel/disconnect'
  | 'channel/message'
  // P2-2（2026-09-23）：请求边界事件 —— turn × request 双边界
  // （见 `.trae/specs/request-boundary-events.md` v0.2；requestId = 本事件的 seq）
  | 'request/start'
  // ─── 生命周期 ───
  | 'session/start'
  | 'session/end'
  // ─── 标题（D5，2026-08-24：标题事件化，log-only 不入消息 surface） ───
  | 'session/title'
  // ─── Code Mode（CM-5，2026-08-25：code_run 执行事件） ───
  | 'assistant/code_run';

// ─── 事件载荷映射 ───────────────────────────────────────────────────────────

/**
 * 事件载荷类型映射
 *
 * 每个事件 type 对应一个 data 类型，确保类型安全。
 * 字段命名与现有 Message 类型保持一致，便于迁移器复用。
 */
export interface LiriEventMap {
  /** 新一轮对话开始 */
  'turn/start': {
    /** Turn 编号（从 1 开始） */
    turn: number;
    /** 触发本轮的用户消息 seq（若有） */
    userMessageSeq?: number;
  };

  /** 本轮结束（含错误信息） */
  'turn/end': {
    turn: number;
    /**
     * 结束原因。
     * 阶段 A（A1-d）增 `'yielded'`：本轮以 `sessions_yield` 让出 turn，
     * 会话对外状态保持 running，待子代理结算后由恢复通路开启新 turn。
     */
    finishReason?:
      | 'stop'
      | 'length'
      | 'tool_use'
      | 'error'
      | 'canceled'
      | 'yielded';
    /** 阶段 A：本轮是否为 yield 让出（与 finishReason='yielded' 同时写入） */
    yielded?: boolean;
    /** 错误信息（finishReason=error 时） */
    error?: string;
  };

  /** 用户输入 */
  'user/message': {
    content: string;
    /** 附件列表（图片、文件等） */
    attachments?: DataAttachment[];
    /** 所属用户消息 id（v1 起，v0 事件无此字段） */
    messageId?: string;
    /** F4（2026-08-25）：被回复消息 id（回复引用，刷新后透传到派生消息） */
    replyToId?: string;
  };

  /** AI 思考（纯文本，无 RichMediaReference 标签） */
  'assistant/thinking': {
    content: string;
    /** 所属 assistant 消息 id（v1 起） */
    messageId?: string;
  };

  /** AI 正文（纯 markdown，不含 thinking 段） */
  'assistant/text': {
    content: string;
    /** 所属 assistant 消息 id（v1 起） */
    messageId?: string;
  };

  /**
   * AI 正文聚合批（F-2，2026-09-02，阶段 A 写放大治理）
   * text 流式 chunk 按 64KB/2s 聚合后落盘，content = 聚合片段。
   * 回放侧（EventMessageDeriver）按 seq 顺序展开，语义与逐条 assistant/text 一致。
   */
  'assistant/text-batch': {
    content: string;
    /** 所属 assistant 消息 id（v1 起） */
    messageId?: string;
  };

  /** 工具调用开始 */
  'assistant/tool_call': {
    /** 工具调用 ID（与 tool/result 配对） */
    toolCallId: string;
    /** 工具名 */
    name: string;
    /** 工具参数（已解析的对象，非 JSON 字符串） */
    args: unknown;
    /** 所属 assistant 消息 id（v1 起） */
    messageId?: string;
    /** callSeq 持久化（= 本事件将获得的 seq，tailSeq+1 预分配；A1） */
    callSeq?: number;
  };

  /** 工具结果（引用 assistant/tool_call 的 seq） */
  'tool/result': {
    /** 对应的 assistant/tool_call 事件的 seq */
    callSeq: number;
    /** 工具调用 ID（与 assistant/tool_call 配对） */
    toolCallId: string;
    /** 工具返回结果 */
    result: string;
    /** 是否为错误结果 */
    isError?: boolean;
    /** 归属的 assistant 消息 id（v1 起，= metadata.parentMessageId 回退 parentUuid；A2） */
    messageId?: string;
  };

  /** 工具调用未完成终态（B-2，2026-08-23：被放弃/循环中止的工具无 result，补发取消终态） */
  'tool/canceled': {
    /** 对应的 assistant/tool_call 事件的 seq */
    callSeq: number;
    /** 工具调用 ID（与 assistant/tool_call 配对） */
    toolCallId: string;
    /** 取消原因（工具循环结束/中止/交互中断等） */
    reason?: string;
    /** 归属的 assistant 消息 id */
    messageId?: string;
  };

  /** 上下文压缩状态（独立 seq，不混进 blocks） */
  'context/compaction': {
    /** 压缩阶段 */
    phase: 'start' | 'compacting' | 'done' | 'failed';
    /** 压缩前 token 数 */
    beforeTokens?: number;
    /** 压缩后 token 数 */
    afterTokens?: number;
    /** 阶段说明 */
    message?: string;
    /** T-A（2026-08-23）：被压缩消息的事件 seq 区间（startSeq → endSeq，含端点）。
     *  压缩语义 = 区间内全部消息替换为 summary；summary 消息不写 events（本事件即其事件表示）。 */
    compactedRange?: { startSeq: number; endSeq: number };
    /** 压缩后 summary 文本（与投影写入的 summary 同一份，供派生器合成 summary 消息） */
    summary?: string;
    /** 投影 summary 消息的真实 id（派生器合成 summary 消息时复用，T-D 对账跳过其 lastEventSeq 比对） */
    summaryMessageId?: string;
    /** P1-2（2026-08-27）：摘要调用信封（model/usage/structured，使本次摘要请求可从事件重建） */
    summaryEnvelope?: {
      model: string;
      maxTokens?: number;
      usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      structured: boolean;
    };
  };

  /** 压缩后的摘要 */
  'context/summary': {
    /** 摘要内容 */
    summary: string;
    /** 被压缩掉的原始事件 seq 列表 */
    compactedSeqs: number[];
  };

  /**
   * 会话远期摘要（D-1，2026-09-02，v4 §8）：projection 压缩产物事件化落盘。
   * 摘要也是轨迹的一部分——与 M1 事件溯源闭环（seq 单调/损坏恢复/快照一致性
   * 均沿用）；后续摘要索引/检索以本事件为读取视图，无第二真相源。
   */
  'session/summary': {
    /** 摘要正文 */
    content: string;
    /** 检索关键词（轻量词频提取，供索引读取视图筛选） */
    keywords?: string[];
    /** 投影 summary 消息的真实 id（与 context/compaction done 对齐） */
    summaryMessageId?: string;
    /** 被折叠事件区间（对齐 context/compaction done.compactedRange） */
    compactedRange?: { startSeq: number; endSeq: number };
    /** 被折叠的源消息事件 seq（对齐 context/compaction done.sourceEventSeqs） */
    sourceEventSeqs?: number[];
  };

  /**
   * TR-12-B（2026-09-22）：模型输入快照 —— 记录**本轮请求实际携带**的工具清单与
   * 系统提示词分段，使"模型当时看到了什么"可从事件重建（§1.6 红线，v7.12.0）。
   *
   * 引用式去重：内容未变的单元只写 `refSeq`/`toolsRefSeq` 指向同会话内更早的
   * 全量事件 —— 避免每轮重复落 ~53KB 工具清单 + ~7KB 提示词
   * （见 `.trae/specs/model-input-snapshot-events.md`）。
   *
   * 注：引用语义与信封级 `sourceEventSeqs`（"由哪些事件**合成**"）不同，
   * 故用**载荷内独立字段**表达"内容**相同**"，避免既有派生器误判（Spec D2）。
   */
  'context/model-input': {
    /** 工具清单快照（内容未变时省略，用 toolsRefSeq 引用） */
    tools?: {
      /** 规范化 JSON 的 hashContent() */
      hash: string;
      /** 工具数量（读端校验/展示用） */
      count: number;
      /** 全量 schema（首次或内容变更时） */
      schemas?: unknown[];
    };
    /** 指向同会话内 hash 相同的更早事件 seq（内容未变时） */
    toolsRefSeq?: number;
    /** 系统提示词逐段快照（粒度 = 既有 SystemPromptSection.name） */
    sections?: Array<{
      name: string;
      hash: string;
      /** 全量正文（首次或该段内容变更时） */
      content?: string;
      /** 指向同会话内该段内容相同的更早事件 seq */
      refSeq?: number;
    }>;
    /** 组装模式（对齐 PromptMode） */
    mode?: string;
    /** 既有 SystemPromptReport 的聚合值（复用，不重算） */
    tokens?: { stable: number; dynamic: number };
  };

  /** 错误（含 module/action/errorCode） */
  'system/error': {
    /** 模块名（命名约定：<大模块>:<子模块>） */
    module: string;
    /** 动作名 */
    action: string;
    /** 错误信息 */
    error: string;
    /** 错误码（AppError 的 errorCode） */
    errorCode?: string;
    /** 堆栈信息 */
    stack?: string;
  };

  /** 警告 */
  'system/warning': {
    module: string;
    message: string;
  };

  /** 信息 */
  'system/info': {
    module: string;
    message: string;
  };

  /** 性能指标（TTFT/throughput/tokens） */
  'metric/timing': {
    /**
     * **首块（字节）延迟** ms（端到端：本轮请求发起 → 收到第一个流块，**含准备阶段**）。
     *
     * 口径如实：这是 **TTFB**（Time To First Byte），**不等于**纯模型生成延迟。
     * 生产者：`streamMessageFlow`（`if (!streamHadError)` 分支 ⇒ 每次**成功**的 API 调用一条）。
     */
    ttfb?: number;
    /**
     * **首个内容 token 延迟** ms（端到端：本轮请求发起 → 首个产出可见内容的 chunk，
     * **含准备阶段与解析/擦洗开销**）。
     *
     * 判据：正文 chunk 经 `thinkScrubber` 擦洗后**非空**，或 thinking chunk **有内容**；
     * **纯 tool_call 响应无内容 chunk ⇒ 该字段缺省不写**（不拿 `ttfb` 冒充）。
     * 口径如实：**仍不等于** provider 侧的纯模型首 token 延迟（见 TR-20）。
     */
    ttft?: number;
    /** token 数（总） */
    tokens?: number;
    /** 持续时间 ms */
    duration?: number;
    /** 阶段标识（`request` = 请求级用量；`assistant` = 回合级耗时） */
    stage?: string;
    // ── TR-12-A（2026-09-22）：请求级用量分桶 ──
    // 数据来源：provider 返回的原始 usage（`ChatManager.recordChatResponseUsage` 的入参）
    /** 输入 tokens（服务端报告值） */
    inputTokens?: number;
    /** 输出 tokens（服务端报告值） */
    outputTokens?: number;
    /** 缓存读命中的 tokens（三级回退提取，见 `UsageExtractor.extractCacheTokens`） */
    cacheReadTokens?: number;
    /** 缓存写入 tokens */
    cacheCreationTokens?: number;
    // ── P2-2（2026-09-23）：请求边界配对键 ──
    /**
     * 所属请求标识 = 同请求 `request/start` 事件的 `seq`（见 `chat/services/requestBoundary.ts`）。
     *
     * **可选**（向后兼容）：旧事件 / 拿不到 requestId 的写入路径**不写**该字段 ⇒
     * 读端如实视为"无可配对区间"，**不造值**（见 `client/src/stores/chat/deriveRequestSpans.ts`）。
     */
    requestId?: number;
  };

  /** 通道连接 */
  'channel/connect': {
    channelType: string;
    channelId: string;
  };

  /** 通道断开 */
  'channel/disconnect': {
    channelType: string;
    channelId: string;
    reason?: string;
  };

  /** 通道入站消息 */
  'channel/message': {
    channelType: string;
    /** 原始消息（不同通道格式不同） */
    raw: unknown;
  };

  /**
   * 请求开始（P2-2，2026-09-23）
   *
   * **配对键就在本事件上**：`requestId` = 本事件被分配的 `seq`（写入端 append 后回填，
   * 见 `chat/services/requestBoundary.ts`）⇒ 载荷内**不带** requestId，避免自引用与两份真值。
   *
   * D2'（v0.2 裁决）：**不复用 `data.callSeq`** —— `callSeq` 归 `tool/result ↔ tool_call`
   * 的配对使用（`EventLogStorage.append` 在调用方未指定时把它填成**事件自身的 seq**，
   * 见 `session/storage/EventLogStorage.ts` 的 A1 闭环），语义不同、不可挪用。
   */
  'request/start': {
    /** 所属回合（turn 编号）。请求发出时 turn 尚未分配（如首轮）⇒ 缺省，不猜。 */
    turn?: number;
    /** 模型标识（便于按模型分组读数） */
    model?: string;
    /** 请求来源：普通对话请求 / compaction 摘要请求（两者**共用同一编号序列**） */
    reason?: 'chat' | 'compaction';
  };

  /** 会话开始 */
  'session/start': {
    startedAt: number;
    modelId?: string;
  };

  /** 会话结束 */
  'session/end': {
    endedAt: number;
    reason?: string;
  };

  /**
   * 会话标题快照（D5，2026-08-24，log-only 不入消息 surface）
   *
   * 对齐 deepseek-harness `session/title`：latest-wins 标题事件，
   * 供回放/审计读取历史标题变更轨迹。运行时读取仍走 metadata.titleStage
   * 快照（性能），本事件为事件溯源完整性的补充。
   */
  'session/title': {
    /** 标准化后的标题文本 */
    title: string;
    /** 标题来源：占位（preliminary）/ AI 精化（final）/ 用户手动（manual） */
    source: 'preliminary' | 'final' | 'manual';
  };

  // ─── 富块事件载荷（M4-1-a 扩展） ───

  /**
   * 富状态块（上下文压缩、重连提示、异常水位、错误提示等一次性提示块）
   * 不参与 meaningful 判断，仅作为 UI 装饰层。
   */
  'assistant/status': {
    /** 提示内容 */
    content: string;
    /** 状态子类型（compaction/watermark/reconnect/error 等，缺省为普通提示） */
    statusType?: 'compaction' | 'watermark' | 'reconnect' | 'error' | string;
    /** 阶段（compaction 使用：compacting/done/error） */
    phase?: 'compacting' | 'done' | 'error';
    /** 工具状态块关联的 toolCallId（C-1 schema 对齐前端 P1-6：按 toolCallId 去重） */
    toolCallId?: string;
    /** 结构化水位数据（statusType='watermark' 时存在，C-1 schema 对齐前端 P1-3） */
    watermark?: { pct: number; severity: 'warn' | 'compact' };
  };

  /**
   * 执行进度卡片（ExecutionPhaseTracker 推送）
   * 与前端 ProgressData 结构保持一致，便于直接映射到 block.progressData
   */
  'assistant/progress': {
    phase:
      | 'analyzing'
      | 'designing'
      | 'implementing'
      | 'verifying'
      | 'presenting';
    /** 0-100 */
    progress: number;
    description: string;
    steps: Array<{
      name: string;
      status: 'pending' | 'in_progress' | 'done' | 'failed';
    }>;
    /** 完整步骤数（后端截断前），用于真实计数展示 */
    totalSteps?: number;
    /** 是否截断了旧步骤 */
    truncated?: boolean;
    /** 当前进行中的步骤名 */
    currentStep: string;
  };

  /**
   * 用户提问卡片（ask_user_question 工具触发）
   * 与前端 QuestionData 结构一致。
   */
  'assistant/question': {
    questionId: string;
    question: string;
    header: string;
    options: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  };

  /**
   * TODO 任务卡（todo_write 工具触发，统一全量 write 快照）
   * 生产者仅产 action='write'（携带完整 taskCard）。增量 update 事件已废弃：
   * 后端 streamMessageFlow 恒产 write，前端 derive 与回放 deriver 均按 write 整卡替换。
   */
  'assistant/todo': {
    action: 'write';
    /** 完整任务卡 */
    taskCard?: {
      title: string;
      status: 'planning' | 'executing' | 'done';
      tasks: Array<{
        id: string;
        name: string;
        status:
          | 'pending'
          | 'in_progress'
          | 'completed'
          | 'failed'
          | 'blocked'
          | 'skipped';
        dependsOn: string[];
        result?: string;
        durationMs?: number;
      }>;
      planId?: string;
    };
  };

  /**
   * 文档工作流进度
   * 与前端 DocWorkflowProgressData 结构保持一致。
   */
  'assistant/doc_workflow': {
    title: string;
    format: 'docx' | 'pptx' | 'html' | 'pdf';
    currentStage: 'outline' | 'filling' | 'compose';
    stages: Record<
      'outline' | 'filling' | 'compose',
      {
        status:
          | 'pending'
          | 'in_progress'
          | 'awaiting_confirm'
          | 'completed'
          | 'failed';
        progress?: number;
        description?: string;
        nodes?: Array<{
          id: string;
          title: string;
          status: 'pending' | 'in_progress' | 'completed' | 'failed';
          hasImage?: boolean;
        }>;
      }
    >;
    outputFilePath?: string;
    error?: string;
  };

  /**
   * P2-A（2026-09-17）：PDCA 自动启动快照（聊天正文内嵌卡片承载的启动态）
   * 只落启动快照；实时阶段进度走 /v1/events 的 pdca:* 通道不经此事件。
   */
  'assistant/pdca_workflow': {
    decision: 'pdl' | 'stage-chain' | 'research';
    stage?: 'plan' | 'execute' | 'review' | 'decide';
    status?: 'started' | 'running' | 'completed' | 'failed';
    message: string;
    projectId?: string;
    reasons?: string[];
  };

  /**
   * 输出截断提示（finishReason='length' 时追加，与 assistant/text 同级渲染为 text block）
   */
  'assistant/truncation': {
    /** 截断原因（当前仅 length） */
    reason: 'length';
    /** 提示文本（追加到正文中） */
    suffix: string;
  };

  /**
   * 交付物卡片（E-1，2026-08-23；对齐前端 DeliverableData）
   * AI 完成工作后推送的文件变更列表。
   */
  'assistant/deliverable': {
    files: Array<{
      path: string;
      change: 'added' | 'modified' | 'deleted';
      status: 'pending' | 'verified' | 'failed';
    }>;
    summary: string;
    checks?: Array<{ name: string; passed: boolean; detail?: string }>;
    actions?: Array<{
      label: string;
      action: 'accept' | 'reject' | 'retry';
      file?: string;
    }>;
  };

  /**
   * diff 卡片（E-1，2026-08-23；对齐前端 DiffData）
   * AI 代码变更的 unified diff 格式预览。
   */
  'assistant/diff': {
    file: string;
    diff: string;
    language?: string;
    stats?: { additions: number; deletions: number };
  };

  /**
   * Code Mode 执行事件（CM-5，2026-08-25）
   * 记录 code_run 工具执行：每轮代码版本 + 结果 + 内部工具调用摘要（不逐条落 tool_call）。
   * round 序号同时供轮次计数事件流重建（CM-1 持久化）。
   */
  'assistant/code_run': {
    /** 本轮编排代码（完整版本） */
    code: string;
    /** 轮次序号（供轮次计数事件流重建） */
    round: number;
    /** 执行结果分类 */
    status:
      | 'completed'
      | 'failed'
      | 'compiled-error'
      | 'security-rejected'
      | 'timeout'
      | 'canceled';
    /** 结构化结果（done(result) 携带） */
    output?: unknown;
    /** 错误信息 */
    error?: string;
    /** 结构化错误（顶层异常帧） */
    structuredError?: { type: string; message: string; stack?: string };
    /** 内部工具调用摘要（CM-5：不逐条落独立 tool_call 事件） */
    toolCalls?: Array<{
      name: string;
      argsHash: string;
      truncatedResult?: string;
      ok: boolean;
    }>;
    /** 用户脚本日志（截断） */
    logs?: string[];
    /** 执行耗时（ms） */
    durationMs?: number;
  };
}

// ─── 事件结构 ───────────────────────────────────────────────────────────────

/**
 * 事件结构
 *
 * @typeParam T - 事件类型，用于推断 data 字段类型
 */
export interface LiriEvent<T extends LiriEventType = LiriEventType> {
  /** 事件类型 */
  type: T;
  /** 事件 schema 版本：无字段 = v0；v1 起消息级事件带 messageId */
  schemaVersion?: 1;
  /** 会话内全局单调递增序号，从 1 开始 */
  seq: number;
  /** epoch ms 时间戳 */
  time: number;
  /** 会话 ID */
  sessionId: string;
  /** 类型安全的载荷 */
  data: LiriEventMap[T];
  /**
   * 溯源引用：本事件由哪些更早事件合成（seq 列表）
   * 例：聚合后的 turn/end 可引用其包含的 user/message + assistant/text 的 seq
   */
  sourceEventSeqs?: number[];
  /** 未知 type 安全跳过标记（向前兼容） */
  ignorable?: true;
}

// ─── 类型守卫 ───────────────────────────────────────────────────────────────

/**
 * 类型守卫：判断未知值是否为 LiriEvent
 *
 * 用于 EventLogStorage.read 的反序列化校验。
 * 注意：只校验结构，不校验 type 是否在枚举中（向前兼容）。
 */
export function isLiriEvent(x: unknown): x is LiriEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.type === 'string' &&
    typeof e.seq === 'number' &&
    Number.isFinite(e.seq) &&
    e.seq > 0 &&
    typeof e.time === 'number' &&
    Number.isFinite(e.time) &&
    typeof e.sessionId === 'string' &&
    typeof e.data === 'object' &&
    e.data !== null
  );
}

// ─── 事件分类（用于面板过滤） ──────────────────────────────────────────────

/**
 * 事件分类（用于轨迹面板按分类过滤）
 *
 * 比 LiriEventType 更粗粒度，便于 UI 分组。
 */
export type LiriEventCategory =
  | 'conversation'
  | 'tool'
  | 'context'
  | 'system'
  | 'channel'
  | 'lifecycle';

/**
 * 按事件 type 推断分类
 *
 * 规则：
 *   - user/message → conversation
 *   - assistant/thinking, assistant/text → conversation
 *   - assistant/tool_call, tool/result → tool
 *   - context/* → context
 *   - system/*, metric/* → system
 *   - channel/* → channel
 *   - turn/*, session/* → lifecycle
 */
export function categorizeEvent(type: LiriEventType): LiriEventCategory {
  if (
    type === 'assistant/tool_call' ||
    type === 'tool/result' ||
    type === 'tool/canceled'
  ) {
    return 'tool';
  }
  if (type.startsWith('user/') || type.startsWith('assistant/')) {
    return 'conversation';
  }
  if (type.startsWith('context/')) {
    return 'context';
  }
  if (type.startsWith('system/') || type.startsWith('metric/')) {
    return 'system';
  }
  if (type.startsWith('channel/')) {
    return 'channel';
  }
  return 'lifecycle';
}

// ─── 工具类型 ───────────────────────────────────────────────────────────────

/**
 * 提取特定 type 事件的 data 类型
 *
 * 用法：`type TextData = LiriEventData<'assistant/text'>` → `{ content: string }`
 */
export type LiriEventData<T extends LiriEventType> = LiriEventMap[T];

/**
 * 提取特定 type 事件的完整类型
 *
 * 用法：`type TextEvent = LiriEventOf<'assistant/text'>`
 */
export type LiriEventOf<T extends LiriEventType> = LiriEvent<T>;
