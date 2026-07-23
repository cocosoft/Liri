/**
 * SummaryGenerator — 统一摘要生成器（Phase 4）
 * 替代分散在 DefaultContextEngine / HybridEngine / SummarizerEngine / ContextCompressor 中的重复逻辑
 */
import type { ChatMessage } from '../../ai/models/types';

export interface SummaryOptions {
  format?: 'structured' | 'plain' | 'fallback';
  maxTokens?: number;
}

/**
 * 生成结构化摘要
 * 对标 DefaultContextEngine.generateSummaryText()
 */
export function generateStructuredSummary(
  messages: ChatMessage[],
  options?: SummaryOptions
): string {
  if (!messages || messages.length === 0) return '';

  const userMsgs = messages.filter((m) => m.role === 'user');
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  const toolMsgs = messages.filter((m) => m.role === 'tool');

  let summary = '## Conversation Summary\n\n';

  if (userMsgs.length > 0) {
    summary += `**User queries (${userMsgs.length}):**\n`;
    for (const m of userMsgs.slice(-5)) {
      const preview =
        typeof m.content === 'string' ? m.content.slice(0, 200) : '(non-text)';
      summary += `- ${preview}\n`;
    }
  }

  if (assistantMsgs.length > 0) {
    summary += `\n**Assistant responses (${assistantMsgs.length}):**\n`;
    for (const m of assistantMsgs.slice(-3)) {
      const preview =
        typeof m.content === 'string'
          ? m.content.slice(0, 200)
          : '(tool calls)';
      summary += `- ${preview}\n`;
    }
  }

  if (toolMsgs.length > 0) {
    summary += `\n**Tools used (${toolMsgs.length})**\n`;
  }

  return summary;
}

/**
 * 生成纯文本摘要
 */
export function generatePlainSummary(messages: ChatMessage[]): string {
  return messages
    .filter((m) => typeof m.content === 'string')
    .map((m) => `[${m.role}]: ${(m.content as string).slice(0, 100)}`)
    .join('\n');
}

/**
 * AI 压缩降级摘要（当 LLM 调用不可用时）
 * 对标 ContextCompressor.fallbackSummary()
 */
export function generateFallbackSummary(messages: ChatMessage[]): string {
  if (messages.length <= 2) return '';

  const first = messages[0];
  const last = messages[messages.length - 1];

  const firstPreview =
    typeof first.content === 'string' ? first.content.slice(0, 150) : '';
  const lastPreview =
    typeof last.content === 'string' ? last.content.slice(0, 150) : '';

  return `[${messages.length} messages] ${first.role}: ${firstPreview} ... ${last.role}: ${lastPreview}`;
}
