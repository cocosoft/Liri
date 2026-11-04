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

  // 第一遍：修复非 JSON 标准转义的 \ 序列
  // 有效 JSON 转义: \" \\ \/ \b \f \n \r \t \uXXXX
  let repaired = raw.replace(/\\(?![\\"\/bfnrtu]|u[0-9a-fA-F]{4})/g, '\\\\');

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
