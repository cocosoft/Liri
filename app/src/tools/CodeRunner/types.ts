/**
 * CodeRunner 共享类型（Code Mode 设计方案 CM-1~CM-4）
 *
 * 父方案：dev_docs/20260825/CodeMode设计方案-20260825.md
 * 设计要点（六轮评审合并）：
 *   - 零 import + 全局净化 + 全局注入（wrapper 先捕获 stdio → 净化 → 注入 → 加载）
 *   - stdio JSON-RPC（换行分隔 JSON 帧），stdout 仅协议，用户日志走 stderr
 *   - done() 完成协议 + 顶层异常结构化 error 帧 + 退出码语义
 */

// ─── 能力 API（注入到子进程全局，脚本内通过 globalThis.__liriRuntime 访问）───────

/** 子进程侧可见的受限能力 API（首版最小集） */
export interface CodeModeRuntime {
  /** 调用 Liri 注册工具（走工具系统，工具级权限链路 + 显式白名单） */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** 读取会话上下文（主进程侧复用 EventLogStorage 查询） */
  readContext(opts?: { limit?: number }): Promise<unknown>;
  /** 输出产物（结构化结果回传模型；大结果走产物文件 + 引用） */
  writeOutput(data: unknown): void;
  /** 写结构化事件（事件类型必须走 knownEventTypes 白名单） */
  emitEvent(type: string, data: unknown): void;
  /** 声明编排完成（携带结构化结果），wrapper flush 后退出 */
  done(result?: unknown): void;
}

// ─── stdio JSON-RPC 报文（换行分隔 JSON 帧）──────────────────────────────────

/** RPC 请求（request-响应配对，id 关联） */
export interface CodeRpcRequest {
  id: number;
  method: 'callTool' | 'readContext' | 'writeOutput' | 'emitEvent';
  params: Record<string, unknown>;
}

/** RPC 响应 */
export interface CodeRpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { type: string; message: string; stack?: string };
}

/** 完成通知（done 协议） */
export interface CodeRpcDone {
  method: 'done';
  result?: unknown;
}

/** 顶层异常结构化帧（走 stdout，error 响应） */
export interface CodeRpcErrorFrame {
  method: 'error';
  error: { type: string; message: string; stack?: string };
}

/** 子进程 → 主进程的全部报文形态 */
export type CodeOutboundMessage =
  | CodeRpcResponse
  | CodeRpcDone
  | CodeRpcErrorFrame;

// ─── 静态校验结果（CM-4，供 CM-1 降级判定）────────────────────────────────────

/** 校验失败分类——决定降级行为（编译错误立即降级 vs 安全拒绝不进迭代） */
export type CodeValidationIssueKind =
  | 'syntax-error' // 语法/解析错误 → 编译错误，立即降级不重试
  | 'forbidden-import' // import/require/动态 import → 安全拒绝，不进迭代
  | 'forbidden-global'; // 敏感全局标识符 → 安全拒绝，不进迭代

export interface CodeValidationIssue {
  kind: CodeValidationIssueKind;
  message: string;
  /** 来源行号（若可定位） */
  line?: number;
}

export interface CodeValidationResult {
  ok: boolean;
  issues: CodeValidationIssue[];
}

// ─── code_run 工具参数与结果（CM-1）──────────────────────────────────────────

/** code_run 工具输入参数 */
export interface CodeRunInput {
  /** 编排代码（TypeScript，零 import） */
  code: string;
  /** 语言（首版仅 ts） */
  language?: 'ts';
  /** 轮次标记（仅日志，不做状态） */
  round?: number;
}

/** code_run 执行结果分类 */
export type CodeRunStatus =
  | 'completed' // done() 正常完成
  | 'failed' // 运行时/业务失败（可迭代修正）
  | 'compiled-error' // 语法错误 → 立即降级
  | 'security-rejected' // 静态校验失败/运行时拦截 → 不进迭代
  | 'timeout' // 超时强制终止
  | 'canceled'; // 主动中止

export interface CodeRunResult {
  status: CodeRunStatus;
  /** 结构化结果（done(result) 携带） */
  output?: unknown;
  /** 错误信息 */
  error?: string;
  /** 结构化错误（顶层异常帧） */
  structuredError?: { type: string; message: string; stack?: string };
  /** 用户脚本日志（stderr 收集） */
  logs: string[];
  /** 内部工具调用摘要（并入 code_run 事件载荷，CM-5） */
  toolCalls: Array<{
    name: string;
    argsHash: string;
    truncatedResult?: string;
    ok: boolean;
  }>;
  /** 执行耗时（ms） */
  durationMs: number;
}
