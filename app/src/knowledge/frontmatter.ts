// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * frontmatter 解析公共实现
 *
 * KB-P1-8（2026-08-27）：收敛知识库链路中多处重复的手写 frontmatter 解析
 * （handleListKnowledge / FileDocsProvider.parseFrontmatterTags），统一格式支持：
 * - 值去引号（"a" / 'a' / a）
 * - tags 支持 `["a","b"]` / `[a, b]` / `a, b`
 * - 值内含冒号（如 title: "a: b"）不被错误拆分
 */

export interface ParsedFrontmatter {
  title?: string;
  source?: string;
  category?: string;
  tags: string[];
  [key: string]: string | string[] | undefined;
}

/** 解析 tags 值（支持 JSON 数组 / [a, b] / a, b 三种格式） */
export function parseTags(val: string): string[] {
  if (val.startsWith('[') && val.endsWith(']')) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // fallthrough to manual split
    }
    return val
      .slice(1, -1)
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return val
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * 解析 markdown frontmatter 块
 * @param content 文件全文（以 --- 开头）
 * @returns 解析后的字段（tags 恒为数组），无 frontmatter 时返回 null
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fields: ParsedFrontmatter = { tags: [] };
  for (const line of fmMatch[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let val = line.slice(idx + 1).trim();
    if (!val) continue;
    val = val.replace(/^["']|["']$/g, '');
    if (key === 'tags') {
      fields.tags = parseTags(val);
    } else {
      fields[key] = val;
    }
  }
  return fields;
}
