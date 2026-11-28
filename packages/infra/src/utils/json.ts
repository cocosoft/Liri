import { getLogger } from '@openliri/kernel/loggerFacade';
import { handleError } from '@openliri/kernel/errorHandler';

const logger = getLogger('utils:json');

export function jsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space);
}

export function jsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    void handleError(new Error('JSON parse failed'), {
      module: 'utils:json',
      action: 'jsonParse',
    });
    return null;
  }
}

/**
 * 修复 AI 模型输出的 JSON 字符串中的 Windows 路径反斜杠问题
 *
 * 模型在生成工具调用参数时，有时会将 Windows 路径写成单反斜杠格式
 *（如 "E:\PY\CODES\file.txt" 而非 "E:\\PY\\CODES\\file.txt"），
 * 导致 JSON.parse 因 \P、\C 等无效转义序列而失败。
 *
 * 修复策略（三遍）：
 * 1. 先尝试直接 JSON.parse
 * 2. 若失败，修复非标准 JSON 转义的 \ 序列
 * 3. 若仍失败，扫描 Windows 盘符路径（如 C:\...）并将路径中的 \ 双写
 *
 * @param raw AI 模型输出的原始 JSON 字符串
 * @returns 修复后的 JSON 字符串（若无法修复则返回原字符串）
 */
/** 单个反斜杠后允许出现的 JSON 转义字符（`u` 另按四段十六进制判定） */
const VALID_SINGLE_ESCAPE = new Set(['"', '/', 'b', 'f', 'n', 'r', 't']);

/** 字符串内裸控制字符 → 短转义（其余仍用 `\u00XX`） */
const RAW_CONTROL_ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

/**
 * 把**字符串内部**的裸控制字符（U+0000–U+001F）转成合法转义。
 *
 * 只处理字符串内部 —— 结构区的换行/缩进是合法 JSON，动了反而破坏格式。
 * 幂等：转义后的 `\n` 是两字符（`\` + `n`），不再命中 `< 0x20`。
 */
function escapeRawControlCharsInStrings(raw: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    // 字符串内：已成对的转义序列整体透传，避免把 `\` + 换行 误判成两个字符
    if (ch === '\\') {
      out += ch;
      if (i + 1 < raw.length) {
        out += raw[i + 1];
        i++;
      }
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }
    const code = ch.charCodeAt(0);
    out +=
      code < 0x20
        ? (RAW_CONTROL_ESCAPES[ch] ??
          `\\u${code.toString(16).padStart(4, '0')}`)
        : ch;
  }
  return out;
}

/**
 * 判断模型输出的参数串是否**被截断**（字符串或括号未闭合）。
 *
 * 用途（2026-11-28）：区分两类"修不好"——
 * - **截断**：输出没写完（max tokens / 连接中断）⇒ 必须让模型**分段重发**；
 * - **转义损坏**：串是完整的，只是写法不合法 ⇒ 提示模型注意引号/反斜杠转义。
 *
 * 严禁据它做补全：补齐截断串会让 `file_write` 落盘半截内容，比失败更糟。
 */
export function looksTruncated(raw: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return inString || depth > 0;
}

/** `\uXXXX` 的四段十六进制（`u` 之后的 4 位） */
const UNICODE_ESCAPE_BODY = /^[0-9a-fA-F]{4}$/;

/**
 * 把「非法的单个反斜杠」双写成 `\\`，**成对 `\\` 整体跳过**。
 *
 * 2026-11-28 真机（`session_mwz477wj251057474e`，10760 字符 SVG 写入）：
 * 旧实现用 `raw.replace(/\\(?![\\"\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')` 逐字符判断
 * 「`\` 后是否合法」，对**已正确双写**的 `\\P`（`"E:\\PY\\…"`）会把第二个 `\` 判成
 * 非法并再双写 ⇒ `\\\P` ⇒ 解析报 `Invalid escape character P`。
 * 结果：本可修好的输出被修复器自己改坏，`file_write` 参数整份丢弃。
 *
 * 单遍扫描语义（与 JSON 转义文法一致）：
 * - `\\\\`（成对）⇒ 原样保留，两个字符一起消费；
 * - `\` + 合法单字符（`" / b f n r t`）⇒ 原样保留；
 * - `\u` + 4 位十六进制 ⇒ 原样保留；
 * - 其余（含**串尾孤立** `\`）⇒ 双写。
 */
function escapeInvalidBackslashes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === '\\') {
      out += '\\\\';
      i++;
      continue;
    }
    if (next !== undefined && VALID_SINGLE_ESCAPE.has(next)) {
      out += ch;
      continue;
    }
    if (
      next === 'u' &&
      UNICODE_ESCAPE_BODY.test(raw.slice(i + 2, i + 6))
    ) {
      out += ch;
      continue;
    }
    out += '\\\\';
  }
  return out;
}

export function repairModelJson(raw: string): string {
  let lastError = '';
  // 先尝试直接解析，成功则无需修复
  try {
    JSON.parse(raw);
    return raw;
  } catch (error) {
    // 2026-11-05：修复路径的**中间步骤**不是故障（后续通常能修好）——
    // 原先三遍都走 `handleError` ⇒ 一次失败刷 3 条 error，把真实的不可修复失败埋掉
    // （真机 15Z：first/second/all-failed 各 20 条/小时）。中间步骤降 debug，只留终态 error。
    lastError = messageOf(error);
    logger.debug('repairModelJson: 首轮解析失败，进入修复', {
      rawLength: raw.length,
      error: lastError,
    });
  }

  // 第零遍：字符串内**裸控制字符**（真实换行 / 制表符 / 回车）转义。
  // JSON 规范（RFC 8259 §7）禁止 U+0000–U+001F 的裸字符出现在字符串内。模型写多行
  // SVG / HTML 内容时最常见的形态就是"直接把换行写进 content" —— 一旦出现即
  // `Bad control character in string literal`，且**大参数（万级字符）几乎必中**。
  // 该转换只动字符串内部的 < 0x20 字符，结构区的美化换行不受影响（无歧义、不猜语义）。
  let repaired = escapeRawControlCharsInStrings(raw);

  // 第一遍：修复非 JSON 标准转义的 \ 序列
  // 有效 JSON 转义: \" \\ \/ \b \f \n \r \t \uXXXX
  // 2026-11-20：`\u` 必须后跟 4 位十六进制才算合法 —— 旧正则把裸 `u` 也算进合法起点，
  // 导致 `\u12`（截断/模型写错）永远不被双写，三次修复全失败（真机 `Invalid unicode escape`）。
  repaired = escapeInvalidBackslashes(repaired);

  try {
    JSON.parse(repaired);
    return repaired;
  } catch (error) {
    lastError = messageOf(error);
    logger.debug('repairModelJson: 转义修复后仍不可解析，进入路径修复', {
      rawLength: raw.length,
      error: lastError,
    });
    // pass to second repair
  }

  // 第二遍：扫描 Windows 盘符路径模式 [A-Z]:\ 并将路径中的 \ 双写
  // 匹配 "盘符:\路径" 模式，将路径分隔符 \ 替换为 \\
  repaired = repaired.replace(
    /([A-Za-z]):\\([^"\\]*\\)/g,
    (_match, drive, rest) => `${drive}:\\\\${rest.replace(/\\/g, '\\\\')}`
  );

  try {
    JSON.parse(repaired);
    return repaired;
  } catch (error) {
    // 终态：**真的修不好**。带上"多长 + 开头一段 + 最后一次解析错误" ——
    // 旧日志只有 `{originalType:"object"}`，事后完全无法定位是哪段输出（真机 20 次/小时）。
    void handleError(new Error('JSON repair all passes failed'), {
      module: 'utils:json',
      action: 'repairModelJson:pathFix',
      context: {
        rawLength: raw.length,
        rawPreview: raw.slice(0, JSON_REPAIR_PREVIEW_CHARS),
        lastParseError: messageOf(error),
        // 2026-11-28：区分「可修的转义错」与「输出被截断」。截断不得补全（会让
        // file_write 落盘半截内容），但必须让排查一眼看出是 max tokens / 连接中断。
        truncated: looksTruncated(raw),
      },
    });
    // 修复后仍失败，返回原字符串（由调用方处理）
    return raw;
  }
}

/** 终态日志里保留的原文前缀长度（够定位形态，又不至于把整段输出灌进日志） */
const JSON_REPAIR_PREVIEW_CHARS = 200;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 解析模型输出的 JSON **对象**（工具调用参数）：先 `repairModelJson` 再做 `JSON.parse`。
 *
 * **背景（2026-10-22 真机日志）**：模型写 `"file_path": "C:\Users\..."`（单反斜杠，`\U` 非法转义）
 * 时，各传输/格式化层的裸 `JSON.parse` 直接失败；其中 `TransportProviderAdapter` 与
 * Anthropic/Gemini formatter 都把失败**静默**兜底成 `{}` ⇒ 参数在到达工具前就已是空对象，
 * 工具侧只报「缺 file_path」，模型反复重试同一调用（PDCA 步骤内实测连败 3 次）。
 * 复用以 `repairModelJson` 为中心的既有修复链，使"能修好的"不再降级。
 *
 * @returns 解析成功且为普通对象时返回对象；无法解析时返回 `undefined`（由调用方决定兜底与告警）
 */
export function parseModelJsonObject(
  raw: string
): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(repairModelJson(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
