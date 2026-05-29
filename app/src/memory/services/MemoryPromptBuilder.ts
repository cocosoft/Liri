/**
 * 记忆提示构建器
 * 构建AI系统提示，指导模型如何使用持久化文件记忆系统
 * 参考CC源码的memdir/memdir.ts实现
 */

import { join } from 'path';
import { resolveProjectRoot } from '@modules/config/paths';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import {
  MEMORY_FRONTMATTER_EXAMPLE,
  TRUSTING_RECALL_SECTION,
  TYPES_SECTION_INDIVIDUAL,
  WHAT_NOT_TO_SAVE_SECTION,
  WHEN_TO_ACCESS_SECTION,
} from './memoryTypes.js';

export const ENTRYPOINT_NAME = 'MEMORY.md';
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25000;
export const DIR_EXISTS_GUIDANCE =
  'This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).';

export interface EntrypointTruncation {
  content: string;
  lineCount: number;
  byteCount: number;
  wasLineTruncated: boolean;
  wasByteTruncated: boolean;
}

/**
 * 截断MEMORY.md内容到行和字节限制
 */
export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim();
  const contentLines = trimmed.split('\n');
  const lineCount = contentLines.length;
  const byteCount = Buffer.byteLength(trimmed, 'utf-8');

  const wasLineTruncated = lineCount > MAX_ENTRYPOINT_LINES;
  const wasByteTruncated = byteCount > MAX_ENTRYPOINT_BYTES;

  if (!wasLineTruncated && !wasByteTruncated) {
    return {
      content: trimmed,
      lineCount,
      byteCount,
      wasLineTruncated,
      wasByteTruncated,
    };
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MAX_ENTRYPOINT_LINES).join('\n')
    : trimmed;

  if (Buffer.byteLength(truncated, 'utf-8') > MAX_ENTRYPOINT_BYTES) {
    const cutAt = truncated.lastIndexOf('\n', MAX_ENTRYPOINT_BYTES);
    truncated = truncated.slice(0, cutAt > 0 ? cutAt : MAX_ENTRYPOINT_BYTES);
  }

  const reason =
    wasByteTruncated && !wasLineTruncated
      ? `${byteCount} bytes (limit: ${MAX_ENTRYPOINT_BYTES}) — index entries are too long`
      : wasLineTruncated && !wasByteTruncated
        ? `${lineCount} lines (limit: ${MAX_ENTRYPOINT_LINES})`
        : `${lineCount} lines and ${byteCount} bytes`;

  return {
    content: `${truncated}\n\n> WARNING: ${ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
    lineCount,
    byteCount,
    wasLineTruncated,
    wasByteTruncated,
  };
}

/**
 * 确保记忆目录存在
 */
export function ensureMemoryDirExists(memoryDir: string): void {
  if (!existsSync(memoryDir)) {
    try {
      mkdirSync(memoryDir, { recursive: true });
    } catch {
      // 目录创建失败，不影响后续操作
    }
  }
}

/**
 * 构建记忆使用行
 * @param displayName 显示名称
 * @param memoryDir 记忆目录路径
 * @param extraGuidelines 额外指导
 * @param skipIndex 是否跳过索引说明
 * @returns 提示行列表
 */
export function buildMemoryLines(
  displayName: string,
  memoryDir: string,
  extraGuidelines?: string[],
  skipIndex = false
): string[] {
  const howToSave = skipIndex
    ? [
        '## How to save memories',
        '',
        'Write each memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        '- Keep the name, description, and type fields in memory files up-to-date with the content',
        '- Organize memory semantically by topic, not chronologically',
        '- Update or remove memories that turn out to be wrong or outdated',
        '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
      ]
    : [
        '## How to save memories',
        '',
        'Saving a memory is a two-step process:',
        '',
        '**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
        '',
        `- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
        '- Keep the name, description, and type fields in memory files up-to-date with the content',
        '- Organize memory semantically by topic, not chronologically',
        '- Update or remove memories that turn out to be wrong or outdated',
        '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
      ];

  return [
    `# ${displayName}`,
    '',
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    '',
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...TYPES_SECTION_INDIVIDUAL,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    ...howToSave,
    '',
    ...WHEN_TO_ACCESS_SECTION,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    ...(extraGuidelines ?? []),
    '',
  ];
}

/**
 * 构建完整记忆提示（含MEMORY.md内容）
 * @param params 参数
 * @returns 完整提示文本
 */
export function buildMemoryPrompt(params: {
  displayName: string;
  memoryDir: string;
  extraGuidelines?: string[];
}): string {
  const { displayName, memoryDir, extraGuidelines } = params;
  const entrypointPath = join(memoryDir, ENTRYPOINT_NAME);

  ensureMemoryDirExists(memoryDir);

  let entrypointContent = '';
  try {
    if (existsSync(entrypointPath)) {
      entrypointContent = readFileSync(entrypointPath, 'utf-8');
    }
  } catch {
    // 文件读取失败，使用空内容
  }

  const lines = buildMemoryLines(displayName, memoryDir, extraGuidelines);

  if (entrypointContent.trim()) {
    const t = truncateEntrypointContent(entrypointContent);
    lines.push(`## ${ENTRYPOINT_NAME}`, '', t.content);
  } else {
    lines.push(
      `## ${ENTRYPOINT_NAME}`,
      '',
      `Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`
    );
  }

  return lines.join('\n');
}

/**
 * 构建自动记忆提示
 */
export function buildAutoMemoryPrompt(): string {
  const memoryDir = join(resolveProjectRoot(), 'memory');
  return buildMemoryPrompt({ displayName: 'auto memory', memoryDir });
}

/**
 * 记忆提示构建器服务
 */
export class MemoryPromptBuilder {
  /**
   * 构建记忆系统提示
   * @param memoryDir 记忆目录
   * @returns 系统提示文本
   */
  buildSystemPrompt(memoryDir?: string): string {
    const dir = memoryDir || join(resolveProjectRoot(), 'memory');
    return buildMemoryPrompt({
      displayName: 'persistent memory',
      memoryDir: dir,
    });
  }

  /**
   * 构建记忆使用指导
   * @returns 使用指导文本
   */
  buildUsageGuidance(): string[] {
    return buildMemoryLines('memory usage guidance', '');
  }
}
