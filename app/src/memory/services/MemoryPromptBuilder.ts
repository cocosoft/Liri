/**
 * 记忆提示构建器
 * 构建AI系统提示，指导模型如何使用持久化文件记忆系统
 * 参考CC源码的memdir/memdir.ts实现
 */

import { join } from 'path';
import { resolveProjectRoot } from '@modules/core';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import {
  MEMORY_FRONTMATTER_EXAMPLE,
  TRUSTING_RECALL_SECTION,
  TYPES_SECTION_INDIVIDUAL,
  WHAT_NOT_TO_SAVE_SECTION,
  WHEN_TO_ACCESS_SECTION,
} from './memoryTypes.js';

import { handleError } from '@modules/error';

export const ENTRYPOINT_NAME = 'MEMORY.md';
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25000;
export const DIR_EXISTS_GUIDANCE =
  '该目录已存在 —— 直接用 Write 工具写入即可（不要执行 mkdir，也不要检查其是否存在）。';

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
      ? `${byteCount} 字节（上限 ${MAX_ENTRYPOINT_BYTES}）—— 索引条目过长`
      : wasLineTruncated && !wasByteTruncated
        ? `${lineCount} 行（上限 ${MAX_ENTRYPOINT_LINES}）`
        : `${lineCount} 行、${byteCount} 字节`;

  return {
    content: `${truncated}\n\n> 警告：${ENTRYPOINT_NAME} 为 ${reason}，仅加载了其中一部分。请把索引条目控制在一行、约 200 字符以内；详细内容请移到主题文件中。`,
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
    } catch (err) {
      // 目录创建失败，不影响后续操作
      handleError(err, { module: 'memory:prompt', action: 'ensureMemoryDir' });
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
        '## 如何保存记忆',
        '',
        '每条记忆写入独立文件（例如 `user_role.md`、`feedback_testing.md`），使用如下 frontmatter 格式：',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        '- 保持记忆文件中的 name、description、type 字段与内容同步更新',
        '- 按主题（语义）而非时间顺序组织记忆',
        '- 对发现错误或已过时的记忆进行更新或删除',
        '- 不要写入重复记忆。写入新记忆前，先检查是否已有可更新的记忆。',
      ]
    : [
        '## 如何保存记忆',
        '',
        '保存一条记忆分两步：',
        '',
        '**第 1 步** —— 把记忆写入独立文件（例如 `user_role.md`、`feedback_testing.md`），使用如下 frontmatter 格式：',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        `**第 2 步** —— 在 \`${ENTRYPOINT_NAME}\` 中为该文件添加一条指针。\`${ENTRYPOINT_NAME}\` 是索引而非记忆 —— 每项一行、约 150 字符以内：\`- [Title](file.md) — one-line hook\`。它没有 frontmatter。切勿把记忆内容直接写入 \`${ENTRYPOINT_NAME}\`。`,
        '',
        `- \`${ENTRYPOINT_NAME}\` 始终会被载入你的对话上下文 —— 第 ${MAX_ENTRYPOINT_LINES} 行之后会被截断，因此请保持索引精简`,
        '- 保持记忆文件中的 name、description、type 字段与内容同步更新',
        '- 按主题（语义）而非时间顺序组织记忆',
        '- 对发现错误或已过时的记忆进行更新或删除',
        '- 不要写入重复记忆。写入新记忆前，先检查是否已有可更新的记忆。',
      ];

  return [
    `# ${displayName}`,
    '',
    `你有一套持久化的、基于文件的记忆系统，位于 \`${memoryDir}\`。${DIR_EXISTS_GUIDANCE}`,
    '',
    '你应当逐步建立这套记忆系统，使未来的对话能够完整掌握：用户是谁、希望如何与你协作、哪些行为应当避免或重复，以及用户交给你的工作背后的上下文。',
    '',
    '如果用户明确要求你记住某事，请立即按最合适的类型保存；如果用户要求你遗忘某事，请找到并删除相应条目。',
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
  } catch (err) {
    // 文件读取失败，使用空内容
    handleError(err, { module: 'memory:prompt', action: 'readEntrypoint' });
  }

  const lines = buildMemoryLines(displayName, memoryDir, extraGuidelines);

  if (entrypointContent.trim()) {
    const t = truncateEntrypointContent(entrypointContent);
    lines.push(`## ${ENTRYPOINT_NAME}`, '', t.content);
  } else {
    lines.push(
      `## ${ENTRYPOINT_NAME}`,
      '',
      `你的 ${ENTRYPOINT_NAME} 当前为空。当你保存新的记忆后，它们会出现在这里。`
    );
  }

  return lines.join('\n');
}

/**
 * 构建自动记忆提示
 */
export function buildAutoMemoryPrompt(): string {
  const memoryDir = join(resolveProjectRoot(), 'memory');
  return buildMemoryPrompt({ displayName: '自动记忆', memoryDir });
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
      displayName: '持久记忆',
      memoryDir: dir,
    });
  }

  /**
   * 构建记忆使用指导
   * @returns 使用指导文本
   */
  buildUsageGuidance(): string[] {
    return buildMemoryLines('记忆使用指导', '');
  }
}
