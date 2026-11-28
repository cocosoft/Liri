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
  /**
   * 原始串是否**被截断**（字符串/括号未闭合）。
   *
   * 2026-11-28：`rawLength` 只能提示"很大"，区分不出「输出没写完」与「转义写坏」——
   * 前者要模型分段重发，后者只需重发一次并注意转义。缺省（旧落盘记录）按"可能截断"
   * 处理，保持原文案不变。
   */
  truncated?: boolean;
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
  return typeof info.truncated === 'boolean'
    ? { rawLength: info.rawLength, truncated: info.truncated }
    : { rawLength: info.rawLength };
}

/**
 * 参数解析失败的可操作建议（按「截断」与「转义损坏」分档）。
 *
 * 两者的正确动作**不同**：截断要分段重发；转义损坏只需修正写法后重发。
 * 混用文案会让模型做无谓的分段写入，或对已完整的串反复重试（真机 2026-11-28：
 * 10760 字符参数解析失败后，模型原样重试同一调用）。
 * `truncated` 缺省（旧落盘记录）按"可能截断"给出保守建议，保持原文案不变。
 */
function buildParseAdvice(parseErr: ArgParseErrorInfo): string {
  if (parseErr.truncated === false) {
    return (
      `本次调用的参数 JSON 无法解析（原始长度 ${parseErr.rawLength} 字符，串是完整的，` +
      `属**转义写法**问题：content 内的双引号需写成 \\"、反斜杠需写成 \\\\、换行写成 \\n）。` +
      `请修正转义后重发同一调用；若内容过长，改用 source_file 传路径（0 输出 token）。`
    );
  }
  return (
    `本次调用的参数 JSON 不完整（原始长度 ${parseErr.rawLength} 字符，通常因单次输出` +
    `达到上限被截断）。请把大内容**分段**写入：首次写骨架（不带 append），后续每次 ` +
    `content ≤4000 字符并用 append:true 追加；若内容已在磁盘上（其它工具已产出），` +
    `改用 source_file 传路径而不是复述全文（0 输出 token）；编辑类工具请减小 ` +
    `old_string/new_string。不要原样重复同一调用。`
  );
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
    ? buildParseAdvice(parseErr)
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
