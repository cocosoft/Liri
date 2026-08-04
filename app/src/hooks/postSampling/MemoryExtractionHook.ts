/**
 * 记忆提取Hook
 * 在LLM采样后提取有价值的记忆
 */

import type {
  PostSamplingHook,
  PostSamplingHookContext,
} from '../types/PostSampling';
import {
  extractMemories,
  type MemoryType,
} from '@modules/services/extractMemories';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('MemoryExtractionHook');

/**
 * 记忆提取选项
 */
export interface MemoryExtractionOptions {
  /** 是否启用 */
  enabled?: boolean;
  /** 最大记忆数量 */
  maxMemories?: number;
  /** 记忆类型过滤 */
  memoryTypes?: string[];
  /** 自定义提取器 */
  customExtractor?: (
    block: any,
    context: PostSamplingHookContext
  ) => Promise<boolean>;
}

/**
 * 值得记忆的工具类型
 */
const MEMORABLE_TOOLS = new Set([
  'Write',
  'Edit',
  'Bash',
  'PowerShell',
  'Agent',
]);

/**
 * 创建记忆提取Hook
 * @param memoryManager 记忆管理器
 * @param options 提取选项
 * @returns Hook函数
 */
export function createMemoryExtractionHook(
  memoryManager?: any,
  options: MemoryExtractionOptions = {}
): PostSamplingHook {
  const {
    enabled = true,
    maxMemories = 10,
    memoryTypes,
    customExtractor,
  } = options;

  return async (context: PostSamplingHookContext): Promise<void> => {
    if (!enabled) {
      return;
    }

    const { messages, toolUseContext } = context;

    if (!(toolUseContext as any)?.sessionId) {
      return;
    }

    const sessionId = (toolUseContext as any).sessionId;
    let extractedCount = 0;

    // Phase 1: Deep AI-driven memory extraction
    if (extractMemories.isEnabled()) {
      try {
        const messages = context.messages.map((m: unknown) => {
          const msg = m as Record<string, unknown>;
          return {
            role: (msg.role as string)?.toString() || 'unknown',
            content: (msg.content as string)?.toString() || '',
          };
        });

        const result = await extractMemories.extract(messages, sessionId);

        if (result.stats.newCount > 0 && memoryManager) {
          for (const memory of result.memories) {
            if (extractedCount >= maxMemories) break;
            await saveToMemory(
              {
                name: 'ExtractMemories',
                input: {
                  type: memory.type,
                  title: memory.title,
                  content: memory.content,
                  confidence: memory.confidence,
                },
              },
              sessionId,
              memoryManager
            );
            extractedCount++;
          }
        }
      } catch (err) {
        // Deep extraction failure is non-fatal
        void handleError(new Error('深度记忆提取失败'), { module: 'hooks:memory', action: 'extractMemories' });
      }
    }

    // Phase 2: Tool-based memory extraction (existing logic)
    for (const message of messages) {
      if (extractedCount >= maxMemories) {
        break;
      }

      const msg = message as any;
      if (msg.role === 'assistant' && msg.content) {
        const content = Array.isArray(msg.content) ? msg.content : [];

        for (const block of content) {
          if (block.type === 'tool_use') {
            const shouldRemember = await evaluateForMemory(
              block,
              context,
              customExtractor
            );

            if (shouldRemember) {
              await saveToMemory(block, sessionId, memoryManager);
              extractedCount++;
            }
          }
        }
      }
    }
  };
}

/**
 * 评估是否值得记忆
 * @param block 工具调用块
 * @param context Hook上下文
 * @param customExtractor 自定义提取器
 * @returns 是否值得记忆
 */
async function evaluateForMemory(
  block: unknown,
  context: PostSamplingHookContext,
  customExtractor?: (
    block: unknown,
    context: PostSamplingHookContext
  ) => Promise<boolean>
): Promise<boolean> {
  if (customExtractor) {
    return customExtractor(block, context);
  }

  const b = block as Record<string, unknown>;
  if (!MEMORABLE_TOOLS.has(b.name as string)) {
    return false;
  }

  const input = b.input as Record<string, unknown> | undefined;
  if (!input) {
    return false;
  }

  if (b.name === 'Write' || b.name === 'Edit') {
    const filePath = input.file_path || input.path;
    if (filePath && isImportantFile(filePath as string)) {
      return true;
    }
  }

  if (b.name === 'Bash' || b.name === 'PowerShell') {
    const command = input.command as string | undefined;
    if (command && isImportantCommand(command)) {
      return true;
    }
  }

  return false;
}

/**
 * 判断是否为重要文件
 * @param filePath 文件路径
 * @returns 是否重要
 */
function isImportantFile(filePath: string): boolean {
  const importantPatterns = [
    /README/i,
    /package\.json$/i,
    /tsconfig\.json$/i,
    /\.env\.example$/i,
    /config\./i,
    /settings\./i,
  ];

  return importantPatterns.some((pattern) => pattern.test(filePath));
}

/**
 * 判断是否为重要命令
 * @param command 命令
 * @returns 是否重要
 */
function isImportantCommand(command: string): boolean {
  const importantPatterns = [
    /^npm install/i,
    /^npm run/i,
    /^git clone/i,
    /^git push/i,
    /^git pull/i,
    /^docker/i,
    /^pip install/i,
  ];

  return importantPatterns.some((pattern) => pattern.test(command));
}

/**
 * 保存到记忆系统
 * @param block 工具调用块
 * @param sessionId 会话ID
 * @param memoryManager 记忆管理器
 */
async function saveToMemory(
  block: any,
  sessionId: string,
  memoryManager?: any
): Promise<void> {
  if (!memoryManager) {
    return;
  }

  try {
    const memory = {
      type: 'tool_use',
      toolName: block.name,
      input: block.input,
      sessionId,
      timestamp: Date.now(),
    };

    await memoryManager.createMemory(memory);
  } catch (error) {
    logger.error('Failed to save memory:', { error });
    void handleError(error, { module: 'hooks:memory', action: 'saveToMemory' });
  }
}
