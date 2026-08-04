import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({ level: LogLevel.INFO, module: 'utils:json' });

export function jsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space);
}

export function jsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    void handleError(new Error('JSON parse failed'), { module: 'utils:json', action: 'jsonParse' });
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
  // 先尝试直接解析，成功则无需修复
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    void handleError(new Error('JSON repair: first pass needed'), { module: 'utils:json', action: 'repairModelJson:check' });
    // pass to first repair
  }

  // 第一遍：修复非 JSON 标准转义的 \ 序列
  // 有效 JSON 转义: \" \\ \/ \b \f \n \r \t \uXXXX
  let repaired = raw.replace(/\\(?![\\"\/bfnrtu]|u[0-9a-fA-F]{4})/g, '\\\\');

  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    void handleError(new Error('JSON repair: second pass needed'), { module: 'utils:json', action: 'repairModelJson:escapeFix' });
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
  } catch {
    void handleError(new Error('JSON repair all passes failed'), { module: 'utils:json', action: 'repairModelJson:pathFix' });
    // 修复后仍失败，返回原字符串（由调用方处理）
    return raw;
  }
}
