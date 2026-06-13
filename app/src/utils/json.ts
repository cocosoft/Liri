export function jsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space);
}

export function jsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
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
 * 修复策略：
 * 1. 先尝试直接 JSON.parse
 * 2. 若失败，将字符串值中非法的反斜杠转义序列修复后重试
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
    // 解析失败：将 \ 后跟非 JSON 有效转义字符的替换为 \\
    // 有效 JSON 转义: \" \\ \/ \b \f \n \r \t \uXXXX
    const repaired = raw.replace(
      /\\(?![\\"\/bfnrtu]|u[0-9a-fA-F]{4})/g,
      '\\\\'
    );
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // 修复后仍失败，返回原字符串（由调用方处理）
      return raw;
    }
  }
}
