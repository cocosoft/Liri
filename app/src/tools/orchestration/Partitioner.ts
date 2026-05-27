/**
 * 工具调用分区器
 * 基于CC源码 cc_code/backend/services/tools/toolOrchestration.ts 实现
 * 根据工具类型将工具调用分区为并发安全组和串行执行组
 */

import type { ToolUseBlock } from '@modules/chat/types/ToolUseBlock';
import type { ToolCallPartition } from './types';
import { isReadOnlyTool, isWriteTool, isConcurrencySafe } from './types';

/**
 * 工具调用分区器
 */
export class ToolCallPartitioner {
  /**
   * 将工具调用分区为并发安全组和串行执行组
   * @param toolUseMessages 工具调用消息列表
   * @param context 工具使用上下文
   * @returns 分区列表
   */
  partition(
    toolUseMessages: ToolUseBlock[],
    context?: any
  ): ToolCallPartition[] {
    const partitions: ToolCallPartition[] = [];

    if (toolUseMessages.length === 0) {
      return partitions;
    }

    const readTools: ToolUseBlock[] = [];
    const writeTools: ToolUseBlock[] = [];
    const otherTools: ToolUseBlock[] = [];

    for (const block of toolUseMessages) {
      if (isReadOnlyTool(block.name)) {
        readTools.push(block);
      } else if (isWriteTool(block.name)) {
        writeTools.push(block);
      } else {
        otherTools.push(block);
      }
    }

    if (readTools.length > 0) {
      partitions.push({
        isConcurrencySafe: true,
        blocks: readTools,
      });
    }

    if (writeTools.length > 0) {
      partitions.push({
        isConcurrencySafe: false,
        blocks: writeTools,
      });
    }

    if (otherTools.length > 0) {
      partitions.push({
        isConcurrencySafe: false,
        blocks: otherTools,
      });
    }

    return partitions;
  }

  /**
   * 获取可以并发执行的工具调用
   * @param toolUseMessages 工具调用消息列表
   * @returns 可并发执行的工具调用
   */
  getConcurrentBlocks(toolUseMessages: ToolUseBlock[]): ToolUseBlock[] {
    return toolUseMessages.filter((block) => isConcurrencySafe(block.name));
  }

  /**
   * 获取需要串行执行的工具调用
   * @param toolUseMessages 工具调用消息列表
   * @returns 需要串行执行的工具调用
   */
  getSerialBlocks(toolUseMessages: ToolUseBlock[]): ToolUseBlock[] {
    return toolUseMessages.filter((block) => !isConcurrencySafe(block.name));
  }

  /**
   * 判断是否所有工具调用都可以并发执行
   * @param toolUseMessages 工具调用消息列表
   * @returns 是否全部可并发
   */
  canAllConcurrent(toolUseMessages: ToolUseBlock[]): boolean {
    return toolUseMessages.every((block) => isConcurrencySafe(block.name));
  }

  /**
   * 判断是否所有工具调用都需要串行执行
   * @param toolUseMessages 工具调用消息列表
   * @returns 是否全部需串行
   */
  mustAllSerial(toolUseMessages: ToolUseBlock[]): boolean {
    return toolUseMessages.every((block) => !isConcurrencySafe(block.name));
  }
}

/**
 * 创建工具调用分区器实例
 * @returns 工具调用分区器实例
 */
export function createToolCallPartitioner(): ToolCallPartitioner {
  return new ToolCallPartitioner();
}

/**
 * 分区工具调用的便捷函数
 * @param toolUseMessages 工具调用消息列表
 * @param context 工具使用上下文
 * @returns 分区列表
 */
export function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  context?: any
): ToolCallPartition[] {
  const partitioner = new ToolCallPartitioner();
  return partitioner.partition(toolUseMessages, context);
}
