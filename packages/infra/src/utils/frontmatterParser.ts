/**
 * Frontmatter解析工具
 */

/**
 * 解析Markdown文件的frontmatter
 * @param content Markdown文件内容
 * @returns 解析后的frontmatter对象和正文内容
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  content: string;
} {
  const frontmatter: Record<string, unknown> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter, content };
  }

  const frontmatterContent = match[1];
  const body = match[2];

  const lines = frontmatterContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 解析键值对 key: value
    const kvMatch = trimmed.match(/^([^:]+):\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value: unknown = kvMatch[2].trim();
      const strValue = String(value);

      // 尝试解析数组 [item1, item2]
      if (strValue.startsWith('[') && strValue.endsWith(']')) {
        try {
          value = JSON.parse(strValue.replace(/'/g, '"'));
        } catch {
          value = strValue
            .slice(1, -1)
            .split(',')
            .map((s: string) => s.trim().replace(/['"]/g, ''));
        }
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: body };
}

/**
 * 从frontmatter解析正整数
 */
export function parsePositiveIntFromFrontmatter(
  value: unknown
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}
