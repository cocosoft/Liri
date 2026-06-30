// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Session Memory Extractor
 *
 * 对标 BA_REF 的 MemoryForkAgent，使用 LLM 从对话中智能提炼关键信息。
 * 提炼为 fire-and-forget 模式，不阻塞主对话。
 *
 * 提炼内容：discussions、decisions、file changes、code references、open questions
 */

import { MEMORY_TEMPLATE } from './memoryTemplate';

/** 提炼提示词 */
const EXTRACTION_PROMPT = `You are a session memory extractor. Your job is to read recent conversation and update the session memory file.

Rules:
1. Only edit the memory.md file - you cannot use any other tools
2. Focus on extracting KEY information, not summarizing every line
3. categories: Discussions, Decisions, File Changes, Code References, Open Questions
4. Each item should be ONE concise line starting with "- "
5. Only add NEW information - don't duplicate existing items
6. If nothing new to add, return the memory file unchanged

Return ONLY the updated memory.md content, no explanations.`;

/**
 * 构建提炼请求的 messages
 */
function buildExtractionMessages(
  recentMessages: string,
  existingMemory: string
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: EXTRACTION_PROMPT },
    {
      role: 'user',
      content: `Existing memory:\n\n${existingMemory}\n\n---\n\nRecent conversation:\n\n${recentMessages}\n\n---\n\nUpdate the memory file with any new information. Return the complete updated file.`,
    },
  ];
}

/** LLM 调用接口（最小依赖：只要求 sendMessage 方法） */
export interface MemoryExtractionLLM {
  sendMessage(
    messages: Array<{ role: string; content: string }>
  ): Promise<string>;
}

/**
 * SessionMemoryExtractor — 用 LLM 提炼对话中的关键信息
 */
export class SessionMemoryExtractor {
  private llm: MemoryExtractionLLM;

  constructor(llm: MemoryExtractionLLM) {
    this.llm = llm;
  }

  /**
   * 从对话中提炼记忆
   * @param recentMessages 最近对话文本（截取最近 2000 字符）
   * @param existingMemory 已有记忆内容（首次为空字符串）
   * @returns 更新后的记忆文件内容
   */
  async extract(
    recentMessages: string,
    existingMemory: string = MEMORY_TEMPLATE.replace(
      '{{lastExtraction}}',
      new Date().toISOString()
    )
  ): Promise<string> {
    const truncated = recentMessages.slice(-2000);
    const effectiveMemory =
      existingMemory ||
      MEMORY_TEMPLATE.replace('{{lastExtraction}}', new Date().toISOString());

    try {
      const msgs = buildExtractionMessages(truncated, effectiveMemory);
      const result = await this.llm.sendMessage(
        msgs as Array<{ role: string; content: string }>
      );
      return result || effectiveMemory;
    } catch {
      // LLM 调用失败，返回原记忆（不更新）
      return effectiveMemory;
    }
  }
}
