/**
 * B 类（可调运行参数）默认值与环境变量覆盖 —— **单一事实源**。
 *
 * 四分类口径（清单 §5 D-1，`dev_docs/20261018/待修复任务清单-20261018.md`）：
 * - **A 类**：协议 / 结构 / 键名 / 目录名 / 版本 / UA —— 不可调，直接定义在常量文件；
 * - **B 类**：超时 / 并发 / 上限 / 阈值 / 大小 —— **本文件**给默认值，`LIRI_*` 环境变量覆盖；
 * - **C 类**：模型 window / 价格 / 能力 —— **禁止**出现在 `constants/`（只允许 DB / 注册表）；
 * - **D 类**：提示词 / 文案 —— 走工作流 C 的资源体系，不合并进常量文件。
 *
 * **零依赖 leaf**：刻意**不 import `@modules/config`** —— `config`（infra）已依赖 `constants`，
 * 反向引用会成环（同一裁定见 `tasks/limits.ts` 头注）。因此直接用 `process.env`，
 * 语义与正例一致：**模块加载时读取 ⇒ 启动前设置生效**。
 *
 * ⚠️ 本文件只放**默认值**，不承载具体常量导出（避免新增「大常量文件」，尊重 20261013 裁定）。
 */

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw >= 0 ? raw : fallback;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

/** B 类运行参数（每次调用重新读取 env） */
export interface RuntimeDefaults {
  // ── common.ts ──────────────────────────────────────────────────────────
  sessionTimeoutMs: number;
  maxConcurrentTasks: number;
  maxRetryCount: number;
  retryDelayMs: number;
  heartbeatIntervalMs: number;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  maxLogFileSizeBytes: number;
  maxCacheSizeBytes: number;
  cacheExpiryMs: number;
  defaultPort: number;
  defaultHost: string;
  maxFileSizeBytes: number;
  maxPathLength: number;
  maxFilenameLength: number;
  defaultMaxTokens: number;
  // ── apiLimits.ts ───────────────────────────────────────────────────────
  apiImageMaxBase64Size: number;
  /** 派生：Base64 上限 × 3/4（编码膨胀 ~4/3 的反推） */
  imageTargetRawSize: number;
  imageMaxWidth: number;
  imageMaxHeight: number;
  pdfTargetRawSize: number;
  apiPdfMaxPages: number;
  pdfExtractSizeThreshold: number;
  pdfMaxExtractSize: number;
  pdfMaxPagesPerRead: number;
  pdfAtMentionInlineThreshold: number;
  apiMaxMediaPerRequest: number;
  // ── toolLimits.ts ──────────────────────────────────────────────────────
  defaultMaxResultSizeChars: number;
  maxToolResultTokens: number;
  /** 派生：token 上限 × 每 token 字节数 */
  contextMaxToolResultBytes: number;
  toolSummaryMaxLength: number;
  toolResultPreviewMaxLength: number;
  defaultToolTimeoutMs: number;
  maxConcurrentTools: number;
  maxToolRetries: number;
  // ── insights（命令展示阈值） ────────────────────────────────────────────
  /** 「慢操作」展示阈值（毫秒）：洞察报告把超过该值的调用计入 `slowCalls` */
  insightsSlowOperationThresholdMs: number;
  // ── agentsList（`agents_list` 运行态清单分页） ─────────────────────────
  /** 单页默认条数 */
  agentsListDefaultLimit: number;
  /** 单页上限（防止代理清单挤占上下文） */
  agentsListMaxLimit: number;
}

/** 每 token 估算字节数（A 类换算常数；派生字段的唯一来源） */
const TOKEN_BYTES_ESTIMATE = 4;

/**
 * 读取当前 B 类运行参数（env 覆盖 + 默认回退）。
 *
 * 环境变量（未设置 / 非法 ⇒ 回退默认值）：
 * `LIRI_SESSION_TIMEOUT_MS` · `LIRI_MAX_CONCURRENT_TASKS` · `LIRI_MAX_RETRY_COUNT` ·
 * `LIRI_RETRY_DELAY_MS` · `LIRI_HEARTBEAT_INTERVAL_MS` · `LIRI_CONNECTION_TIMEOUT_MS` ·
 * `LIRI_REQUEST_TIMEOUT_MS` · `LIRI_MAX_LOG_FILE_SIZE` · `LIRI_MAX_CACHE_SIZE_BYTES` ·
 * `LIRI_CACHE_EXPIRY_MS` · `LIRI_DEFAULT_PORT` · `LIRI_DEFAULT_HOST` ·
 * `LIRI_MAX_FILE_SIZE` · `LIRI_MAX_PATH_LENGTH` · `LIRI_MAX_FILENAME_LENGTH` ·
 * `LIRI_DEFAULT_MAX_TOKENS` · `LIRI_API_IMAGE_MAX_BASE64_SIZE` · `LIRI_IMAGE_MAX_WIDTH` ·
 * `LIRI_IMAGE_MAX_HEIGHT` · `LIRI_PDF_TARGET_RAW_SIZE` · `LIRI_API_PDF_MAX_PAGES` ·
 * `LIRI_PDF_EXTRACT_SIZE_THRESHOLD` · `LIRI_PDF_MAX_EXTRACT_SIZE` ·
 * `LIRI_PDF_MAX_PAGES_PER_READ` · `LIRI_PDF_AT_MENTION_INLINE_THRESHOLD` ·
 * `LIRI_API_MAX_MEDIA_PER_REQUEST` · `LIRI_TOOL_MAX_RESULT_CHARS` ·
 * `LIRI_TOOL_RESULT_MAX_TOKENS` · `LIRI_TOOL_SUMMARY_MAX_LENGTH` ·
 * `LIRI_TOOL_RESULT_PREVIEW_MAX_LENGTH` · `LIRI_TOOL_TIMEOUT_MS` ·
 * `LIRI_MAX_CONCURRENT_TOOLS` · `LIRI_MAX_TOOL_RETRIES` · `LIRI_INSIGHTS_SLOW_MS` ·
 * `LIRI_AGENTS_LIST_DEFAULT_LIMIT` · `LIRI_AGENTS_LIST_MAX_LIMIT`
 */
export function getRuntimeDefaults(): RuntimeDefaults {
  const apiImageMaxBase64Size = envInt(
    'LIRI_API_IMAGE_MAX_BASE64_SIZE',
    5 * 1024 * 1024
  );
  const maxToolResultTokens = envInt('LIRI_TOOL_RESULT_MAX_TOKENS', 100_000);

  return {
    // common
    sessionTimeoutMs: envInt('LIRI_SESSION_TIMEOUT_MS', 30 * 60 * 1000),
    maxConcurrentTasks: envInt('LIRI_MAX_CONCURRENT_TASKS', 10),
    maxRetryCount: envInt('LIRI_MAX_RETRY_COUNT', 3),
    retryDelayMs: envInt('LIRI_RETRY_DELAY_MS', 1000),
    heartbeatIntervalMs: envInt('LIRI_HEARTBEAT_INTERVAL_MS', 30 * 1000),
    connectionTimeoutMs: envInt('LIRI_CONNECTION_TIMEOUT_MS', 10 * 1000),
    requestTimeoutMs: envInt('LIRI_REQUEST_TIMEOUT_MS', 60 * 1000),
    maxLogFileSizeBytes: envInt('LIRI_MAX_LOG_FILE_SIZE', 10 * 1024 * 1024),
    maxCacheSizeBytes: envInt('LIRI_MAX_CACHE_SIZE_BYTES', 100 * 1024 * 1024),
    cacheExpiryMs: envInt('LIRI_CACHE_EXPIRY_MS', 24 * 60 * 60 * 1000),
    defaultPort: envInt('LIRI_DEFAULT_PORT', 3000),
    defaultHost: envStr('LIRI_DEFAULT_HOST', 'localhost'),
    maxFileSizeBytes: envInt('LIRI_MAX_FILE_SIZE', 10 * 1024 * 1024),
    maxPathLength: envInt('LIRI_MAX_PATH_LENGTH', 4096),
    maxFilenameLength: envInt('LIRI_MAX_FILENAME_LENGTH', 255),
    defaultMaxTokens: envInt('LIRI_DEFAULT_MAX_TOKENS', 4096),

    // apiLimits
    apiImageMaxBase64Size,
    imageTargetRawSize: (apiImageMaxBase64Size * 3) / 4,
    imageMaxWidth: envInt('LIRI_IMAGE_MAX_WIDTH', 2000),
    imageMaxHeight: envInt('LIRI_IMAGE_MAX_HEIGHT', 2000),
    pdfTargetRawSize: envInt('LIRI_PDF_TARGET_RAW_SIZE', 20 * 1024 * 1024),
    apiPdfMaxPages: envInt('LIRI_API_PDF_MAX_PAGES', 100),
    pdfExtractSizeThreshold: envInt(
      'LIRI_PDF_EXTRACT_SIZE_THRESHOLD',
      3 * 1024 * 1024
    ),
    pdfMaxExtractSize: envInt('LIRI_PDF_MAX_EXTRACT_SIZE', 100 * 1024 * 1024),
    pdfMaxPagesPerRead: envInt('LIRI_PDF_MAX_PAGES_PER_READ', 20),
    pdfAtMentionInlineThreshold: envInt(
      'LIRI_PDF_AT_MENTION_INLINE_THRESHOLD',
      10
    ),
    apiMaxMediaPerRequest: envInt('LIRI_API_MAX_MEDIA_PER_REQUEST', 100),

    // toolLimits
    defaultMaxResultSizeChars: envInt('LIRI_TOOL_MAX_RESULT_CHARS', 50_000),
    maxToolResultTokens,
    contextMaxToolResultBytes: maxToolResultTokens * TOKEN_BYTES_ESTIMATE,
    toolSummaryMaxLength: envInt('LIRI_TOOL_SUMMARY_MAX_LENGTH', 50),
    toolResultPreviewMaxLength: envInt(
      'LIRI_TOOL_RESULT_PREVIEW_MAX_LENGTH',
      500
    ),
    defaultToolTimeoutMs: envInt('LIRI_TOOL_TIMEOUT_MS', 30_000),
    maxConcurrentTools: envInt('LIRI_MAX_CONCURRENT_TOOLS', 10),
    maxToolRetries: envInt('LIRI_MAX_TOOL_RETRIES', 3),

    // insights
    insightsSlowOperationThresholdMs: envInt('LIRI_INSIGHTS_SLOW_MS', 1000),

    // agentsList（`agents_list` 分页）
    agentsListDefaultLimit: envInt('LIRI_AGENTS_LIST_DEFAULT_LIMIT', 50),
    agentsListMaxLimit: envInt('LIRI_AGENTS_LIST_MAX_LIMIT', 200),
  };
}
