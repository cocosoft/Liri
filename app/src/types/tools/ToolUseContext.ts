/**
 * 工具使用上下文类型
 * 参考CC_CODE的ToolUseContext设计，适应backend现有架构
 * 实际类型定义已迁移至 Tool.ts 以避免循环依赖
 */
import type { ToolUseContext, CompactProgressEvent } from './Tool';

export { ToolUseContext, CompactProgressEvent };

/**
 * 获取空工具使用上下文
 */
export function getEmptyToolUseContext(): Partial<ToolUseContext> {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: '',
      tools: [],
      verbose: false,
      thinkingConfig: {},
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: {},
    },
    abortController: new AbortController(),
    readFileState: {},
    getAppState: () => ({}),
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  };
}
