// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * preferencesCore —— 用户偏好的**人读真源**读写（G5，2026-11-14）
 *
 * 语义统一（不新增第二套存储，R02）：
 * - **人读真源** = `~/.pyapp/USER.md` 的 `## 偏好` 小节（本模块只读写这一段）；
 * - **机器记忆** = 既有 `USER_PREFERENCE` 记忆条目（由 `AutoMemoryService` 从对话沉淀），
 *   本模块**只读聚合**，删除走 `MemoryManager.deleteMemory`（不另建存储）。
 *
 * 为什么放在 USER.md：它已在提示词装配链路里（`preflight` / `PersonalityReflector` 同源），
 * 用户可直接编辑、也可由 `/preferences add` 追加 —— 一份内容、两个入口，不会漂移。
 */

/** 偏好小节标题（固定前缀；允许用户追加括号说明，如 `## 偏好（个人）`） */
export const PREFERENCES_SECTION_PREFIX = '## 偏好';

export interface AddPreferenceResult {
  markdown: string;
  added: boolean;
  /** `added=false` 的原因：空文本 / 已存在 */
  reason?: 'empty' | 'duplicate';
}

/** 判断是否为目标小节（`## 偏好` 或 `## 偏好（…）`；不匹配 `### 偏好`） */
function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === PREFERENCES_SECTION_PREFIX ||
    trimmed.startsWith(`${PREFERENCES_SECTION_PREFIX}（`) ||
    trimmed.startsWith(`${PREFERENCES_SECTION_PREFIX}(`)
  );
}

/** 是否为二级标题（小节边界） */
function isLevel2Heading(line: string): boolean {
  return /^##\s+/.test(line.trim());
}

/** 解析小节内区间 `[start, end)`；无该小节 ⇒ `null` */
function findSectionRange(
  lines: string[]
): { start: number; end: number } | null {
  const start = lines.findIndex(isSectionHeading);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isLevel2Heading(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 提取一条项目符号的正文（非项目符号行 ⇒ `null`） */
function bulletText(line: string): string | null {
  const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
  return m ? m[1] : null;
}

/** 列出当前偏好条目（保持文件顺序；无小节 ⇒ 空数组） */
export function parsePreferenceLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const range = findSectionRange(lines);
  if (!range) return [];
  const out: string[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const text = bulletText(lines[i]);
    if (text) out.push(text);
  }
  return out;
}

/**
 * 追加一条偏好（幂等：完全相同的内容不重复写）。
 *
 * 小节不存在 ⇒ 在文件末尾新建；存在但无项目符号 ⇒ 紧跟在标题后插入。
 */
export function addPreferenceLine(
  markdown: string,
  text: string
): AddPreferenceResult {
  const value = text.trim();
  if (!value) return { markdown, added: false, reason: 'empty' };

  const lines = markdown.length > 0 ? markdown.split(/\r?\n/) : [];
  const range = findSectionRange(lines);
  if (!range) {
    const base =
      markdown.length > 0 && !markdown.endsWith('\n')
        ? `${markdown}\n`
        : markdown;
    const prefix = base.length > 0 ? `${base}\n` : '';
    return {
      markdown: `${prefix}${PREFERENCES_SECTION_PREFIX}\n- ${value}\n`,
      added: true,
    };
  }

  const existing = parsePreferenceLines(markdown);
  if (existing.some((t) => t.trim().toLowerCase() === value.toLowerCase())) {
    return { markdown, added: false, reason: 'duplicate' };
  }

  // 插到小节内最后一个项目符号之后；没有项目符号 ⇒ 紧跟标题
  let insertAt = range.start + 1;
  for (let i = range.start + 1; i < range.end; i++) {
    if (bulletText(lines[i])) insertAt = i + 1;
  }
  const next = [...lines];
  next.splice(insertAt, 0, `- ${value}`);
  return { markdown: next.join('\n'), added: true };
}

/**
 * 删除匹配的偏好条目（**包含**匹配、大小写不敏感）。
 *
 * @returns 删除后的 markdown 与被删条目的正文（供回执）
 */
export function removePreferenceLines(
  markdown: string,
  matcher: string
): { markdown: string; removed: string[] } {
  const needle = matcher.trim().toLowerCase();
  if (!needle) return { markdown, removed: [] };

  const lines = markdown.split(/\r?\n/);
  const range = findSectionRange(lines);
  if (!range) return { markdown, removed: [] };

  const removed: string[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > range.start && i < range.end) {
      const text = bulletText(lines[i]);
      if (text && text.toLowerCase().includes(needle)) {
        removed.push(text);
        continue;
      }
    }
    kept.push(lines[i]);
  }
  return { markdown: kept.join('\n'), removed };
}
