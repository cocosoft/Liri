/**
 * Beta功能标志头常量
 * 用于API请求协议，标识启用的Beta功能
 * 注意：Liri不使用bun:bundle的feature()编译时宏，改用运行时feature()函数
 */

import { feature } from '../core/featureFlags.js';

/**
 * Liri协议版本头
 */
export const Liri_20250219_BETA_HEADER = 'py-app-20250219';

/**
 * 交错思考Beta头
 * 启用思考块与内容块的交错输出
 */
export const INTERLEAVED_THINKING_BETA_HEADER =
  'interleaved-thinking-2025-05-14';

/**
 * 1M上下文Beta头
 * 启用1M token上下文窗口
 */
export const CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07';

/**
 * 上下文管理Beta头
 * 启用上下文压缩和管理功能
 */
export const CONTEXT_MANAGEMENT_BETA_HEADER = 'context-management-2025-06-27';

/**
 * 结构化输出Beta头
 * 启用结构化JSON输出功能
 */
export const STRUCTURED_OUTPUTS_BETA_HEADER = 'structured-outputs-2025-12-15';

/**
 * Web搜索Beta头
 */
export const WEB_SEARCH_BETA_HEADER = 'web-search-2025-03-05';

/**
 * 工具搜索Beta头（按提供商区分）
 * - 一方API: advanced-tool-use
 * - 三方API: tool-search-tool
 */
export const TOOL_SEARCH_BETA_HEADER_1P = 'advanced-tool-use-2025-11-20';
export const TOOL_SEARCH_BETA_HEADER_3P = 'tool-search-tool-2025-10-19';

/**
 * 努力级别Beta头
 * 启用推理努力级别控制
 */
export const EFFORT_BETA_HEADER = 'effort-2025-11-24';

/**
 * 任务预算Beta头
 * 启用任务级别的token预算控制
 */
export const TASK_BUDGETS_BETA_HEADER = 'task-budgets-2026-03-13';

/**
 * 提示缓存作用域Beta头
 */
export const PROMPT_CACHING_SCOPE_BETA_HEADER =
  'prompt-caching-scope-2026-01-05';

/**
 * 快速模式Beta头
 */
export const FAST_MODE_BETA_HEADER = 'fast-mode-2026-02-01';

/**
 * 编辑思考Beta头
 * 启用思考内容的编辑功能
 */
export const REDACT_THINKING_BETA_HEADER = 'redact-thinking-2026-02-12';

/**
 * Token高效工具Beta头
 * 启用工具调用的token优化
 */
export const TOKEN_EFFICIENT_TOOLS_BETA_HEADER =
  'token-efficient-tools-2026-03-28';

/**
 * 摘要连接器文本Beta头
 * 仅在CONNECTOR_TEXT功能标志启用时生效
 */
export const SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER = feature('TEMPLATES')
  ? 'summarize-connector-text-2026-03-13'
  : '';

/**
 * AFK模式Beta头
 * 仅在TRANSCRIPT_CLASSIFIER功能标志启用时生效
 */
export const AFK_MODE_BETA_HEADER = feature('TRANSCRIPT_CLASSIFIER')
  ? 'afk-mode-2026-01-31'
  : '';

/**
 * 顾问工具Beta头
 */
export const ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01';

/**
 * Bedrock额外参数头集合
 * Bedrock仅支持有限数量的Beta头，且只能通过extraBodyParams传递
 */
export const BEDROCK_EXTRA_PARAMS_HEADERS = new Set([
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_3P,
]);

/**
 * Vertex countTokens API允许的Beta头集合
 * 其他Beta头会导致400错误
 */
export const VERTEX_COUNT_TOKENS_ALLOWED_BETAS = new Set([
  Liri_20250219_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
]);
