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
const EXTRACTION_PROMPT = `你是「会话记忆提炼器」。你的任务是阅读最近的对话，并更新会话记忆文件。

规则：
1. 只能编辑 memory.md 文件 —— 不得使用任何其它工具
2. 聚焦提炼**关键**信息，不要逐行概括
3. 分类（**小节名保持英文不变**，须与记忆文件既有小节一致）：Discussions、Decisions、File Changes、Code References、Open Questions
4. 每条为一行简明文本，以 "- " 开头
5. 只补充**新**信息 —— 不要重复已有条目
6. 若没有新内容可加，原样返回记忆文件

只返回更新后的 memory.md 内容，不要任何解释。`;

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
      content: `已有记忆：\n\n${existingMemory}\n\n---\n\n最近的对话：\n\n${recentMessages}\n\n---\n\n请把其中的新信息更新进记忆文件，并返回完整的更新后文件。`,
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
