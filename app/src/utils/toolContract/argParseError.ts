/**
 * 工具参数 JSON 解析失败的**保留键**契约（2026-10-27）。
 *
 * ## 为什么需要它
 *
 * `TransportProviderAdapter.toParsedToolCall` 在 `JSON.parse` 失败时**只能**给出空参数
 * （`{}`）——模型于是收到「Missing required parameter: file_path」，它无从知道**自己的参数
 * 被截断了**，只能重复同一调用。真机实证（`session_mvqr6vtfe9b47d73c9`，2026-10-27
 * 14:01:13Z）：`rawLength=12068` 的 `file_write` 参数解析失败 ⇒ 降级 `{}` ⇒ 连续两次
 * `Missing required parameter`，随后 `diminishing_returns` 收尾。
 *
 * 本契约把「解析失败」这一**结构化事实**随入参带到工具执行层（`ToolRegistry`），由缺参
 * 文案给出可操作建议（分段写入 / 缩短单次内容），并在**真正执行工具前**剥除该保留键
 * （不污染工具入参、不影响 schema 校验）。
 *
 * 约定：保留键只由适配器写入，只有工具执行层读取；**不得**出现在工具 schema 或工具实现里。
 */
export const ARG_PARSE_ERROR_KEY = '__liri_args_parse_error__';

export interface ArgParseErrorInfo {
  /**
   * 原始参数串长度（字符数）—— 与「是否被输出上限截断」直接相关。
   *
   * 只带长度、**不带原始串前缀**：该保留键会随 assistant `tool_calls` 落盘并在后续轮
   * 回放给模型（2026-10-27 真机 `session_mvqstue8ecef7606df` 实测），前缀属用户内容，
   * 没有留在入参里的理由 —— 原始前缀另由适配器写进日志（`rawPreview`）。
   */
  rawLength: number;
}

/** 构造带诊断的入参（替代裸 `{}`） */
export function withArgParseError(
  info: ArgParseErrorInfo
): Record<string, unknown> {
  return { [ARG_PARSE_ERROR_KEY]: info };
}

/** 读取诊断（非该形态 ⇒ undefined） */
export function getArgParseError(
  input: Record<string, unknown> | undefined
): ArgParseErrorInfo | undefined {
  const raw = input?.[ARG_PARSE_ERROR_KEY];
  if (!raw || typeof raw !== 'object') return undefined;
  const info = raw as Partial<ArgParseErrorInfo>;
  if (typeof info.rawLength !== 'number') return undefined;
  return { rawLength: info.rawLength };
}

/**
 * 缺参失败的**统一文案**（`ToolRegistry` 与 `ToolManager` 两个执行入口共用 —— CS01）。
 *
 * 三档依据（**禁止**解析 error 文本反推 —— CS02）：
 *   1. `input` 带解析失败诊断 ⇒ 明确"参数 JSON 不完整/可能被截断" + 分段写入建议；
 *   2. `input` 真·空对象 ⇒ 提示"未携带任何参数"；
 *   3. 有键但漏必填 ⇒ 仅回显收到的键（不臆测原因）。
 *
 * 诊断载荷只含原始长度 ⇒ 文案仅回显长度，不携带用户参数内容。
 */
export function describeMissingRequiredParams(
  input: Record<string, unknown> | undefined,
  missingParams: string[],
  toolParamNames: string[]
): {
  receivedKeys: string[];
  parseErr?: ArgParseErrorInfo;
  /** 工具结果的 error 文本（与既有前缀保持一致） */
  error: string;
  /** 回给模型的 system 消息（含可操作建议） */
  systemContent: string;
} {
  const parseErr = getArgParseError(input);
  const receivedKeys = Object.keys(input ?? {}).filter(
    (k) => k !== ARG_PARSE_ERROR_KEY
  );
  const advice = parseErr
    ? `本次调用的参数 JSON 不完整（原始长度 ${parseErr.rawLength} 字符，通常因单次输出` +
      `达到上限被截断）。请把大文件拆成多次写入（先写骨架，再用同一路径追加/覆盖分段），` +
      `或缩短单次内容后重试；不要原样重复同一调用。`
    : receivedKeys.length === 0
      ? `本次调用未携带任何参数。请按工具定义补全参数后重试（大内容请分段写入）。`
      : '';
  const head = `Missing required parameter: ${missingParams.join(', ')}`;
  return {
    receivedKeys,
    ...(parseErr ? { parseErr } : {}),
    error: head + (advice ? `（${advice}）` : ''),
    systemContent:
      `Error: ${head}. ` +
      `请按工具定义的参数名重新调用（本次收到的参数键: ${
        receivedKeys.join(', ') || '（空）'
      }；本工具参数: ${toolParamNames.join(', ')}）。` +
      (advice ? `\n${advice}` : ''),
  };
}

/** 执行前剥离保留键（无键时原样返回引用，避免无谓拷贝） */
export function stripArgParseErrorKey(
  input: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!input || !(ARG_PARSE_ERROR_KEY in input)) return input ?? {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k !== ARG_PARSE_ERROR_KEY) rest[k] = v;
  }
  return rest;
}
