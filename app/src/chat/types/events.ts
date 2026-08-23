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

import type { DataAttachment } from '@modules/core/data-models';

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
  | 'assistant/tool_call'
  | 'tool/result'
  | 'tool/canceled'
  // ─── 富块（M4-1-a 扩展，覆盖 question/todo/progress/doc_workflow/status） ───
  | 'assistant/status'
  | 'assistant/progress'
  | 'assistant/question'
  | 'assistant/todo'
  | 'assistant/doc_workflow'
  | 'assistant/truncation'
  // ─── 交付物/diff（E-1，2026-08-23：deliverable/diff 事件化，T-H.2） ───
  | 'assistant/deliverable'
  | 'assistant/diff'
  // ─── 上下文管理 ───
  | 'context/compaction'
  | 'context/summary'
  // ─── 系统与日志 ───
  | 'system/error'
  | 'system/warning'
  | 'system/info'
  | 'metric/timing'
  // ─── 通道 ───
  | 'channel/connect'
  | 'channel/disconnect'
  | 'channel/message'
  // ─── 生命周期 ───
  | 'session/start'
  | 'session/end';

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
    /** 结束原因 */
    finishReason?: 'stop' | 'length' | 'tool_use' | 'error' | 'canceled';
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
  };

  /** 压缩后的摘要 */
  'context/summary': {
    /** 摘要内容 */
    summary: string;
    /** 被压缩掉的原始事件 seq 列表 */
    compactedSeqs: number[];
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
    /** 首 token 时延 ms */
    ttft?: number;
    /** token 数 */
    tokens?: number;
    /** 持续时间 ms */
    duration?: number;
    /** 阶段标识 */
    stage?: string;
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
    /** 阶段（compaction 使用：compacting/done） */
    phase?: 'compacting' | 'done';
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
   * TODO 任务卡（todo_write 工具触发，支持 write 新建与 update 增量更新）
   * action='write' 时 taskCard 完整；action='update' 时携带 taskId + 增量字段。
   */
  'assistant/todo': {
    action: 'write' | 'update';
    /** action='write'：完整任务卡 */
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
    /** action='update'：目标 task id */
    taskId?: string;
    /** action='update'：增量更新字段 */
    updates?: {
      status?:
        | 'pending'
        | 'in_progress'
        | 'completed'
        | 'failed'
        | 'blocked'
        | 'skipped';
      result?: string;
      durationMs?: number;
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
