// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 工具系统模块主入口
 * 导出所有工具系统组件和类型定义
 */

// 导出类型定义
export type { ToolDefinition, ToolExecutionContext } from './types/ToolTypes';

import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('tools:index');
import { ToolManager, globalToolManager } from './core/ToolManager';
import { ToolRegistry, setToolRegistry, getToolRegistry } from './ToolRegistry';
import { ToolExecutor, globalToolExecutor } from './executor/ToolExecutor';
import {
  ToolPermissionManager,
  getGlobalToolPermissionManager,
} from './security/ToolPermissionManager';
import { ToolMonitor, globalToolMonitor } from './monitoring/ToolMonitor';

// 导出核心组件
export { ToolManager, globalToolManager };
export { ToolRegistry, setToolRegistry, getToolRegistry };
export { ToolExecutor, globalToolExecutor };

// 导出安全组件
export { ToolPermissionManager, getGlobalToolPermissionManager };

// 导出监控组件
export { ToolMonitor, globalToolMonitor };

// 导入版本信息用于导出
import { TOOL_SYSTEM_VERSION } from './types/ToolTypes';

// 导出工具系统版本信息
export { TOOL_SYSTEM_VERSION };

// 导出阶段 A 新增组件
export { FunctionTool } from './FunctionTool';
export type { ToolFunction, FunctionToolConfig } from './FunctionTool';
export { ToolGroup } from './ToolGroup';
export { Toolkit } from './Toolkit';

// 导出 E-08 沙箱路由组件
export { ToolSandboxRouter, SandboxLevel } from './sandbox/ToolSandboxRouter';

/**
 * 工具系统初始化函数
 */
export async function initializeToolSystem(config?: any): Promise<void> {
  try {
    // 初始化工具管理器
    await globalToolManager.initialize();

    // 启动工具监控
    globalToolMonitor.startMonitoring();

    logger.info('✅ 工具系统初始化完成');
  } catch (error) {
    await handleError(error as Error, {
      module: 'tools:index',
      action: '工具系统初始化失败',
    });
    throw error;
  }
}

/**
 * 工具系统关闭函数
 */
export async function shutdownToolSystem(): Promise<void> {
  try {
    // 停止工具监控
    globalToolMonitor.stopMonitoring();

    logger.info('✅ 工具系统已关闭');
  } catch (error) {
    await handleError(error as Error, {
      module: 'tools:index',
      action: '工具系统关闭失败',
    });
    throw error;
  }
}

/**
 * 获取工具系统状态
 */
export function getToolSystemStatus(): {
  version: string;
  manager: any;
  executor: any;
  permissionManager: any;
  monitor: any;
} {
  return {
    version: TOOL_SYSTEM_VERSION,
    manager: globalToolManager.getStatus(),
    executor: {
      concurrentExecutions: globalToolExecutor.getConcurrentExecutionCount(),
      activeExecutions: globalToolExecutor.getActiveExecutionIds(),
    },
    permissionManager: getGlobalToolPermissionManager().getConfig(),
    monitor: globalToolMonitor.getStatus(),
  };
}

// 导出新文件操作工具
export {
  readFile,
  addLineNumbers,
  type FileReadInput,
  type FileReadResult,
} from './FileReadTool/FileReadTool';
export {
  writeFile,
  type FileWriteInput,
  type FileWriteResult,
} from './FileWriteTool/FileWriteTool';
export {
  editFile,
  type FileEditInput,
  type FileEditResult,
} from './FileEditTool/FileEditTool';
export { glob, type GlobResult } from './GlobTool/GlobTool';
export {
  grep,
  type GrepOptions,
  type GrepResult,
  type GrepOutputMode,
} from './GrepTool/grep';
export {
  GREP_TOOL_NAME,
  getDescription as grepDescription,
} from './GrepTool/prompt';
export {
  FILE_WRITE_TOOL_NAME,
  getWriteToolDescription,
} from './FileWriteTool/prompt';
export {
  FILE_EDIT_TOOL_NAME,
  getEditToolDescription,
} from './FileEditTool/prompt';

// 导出条件加载工具
export {
  sendNotification,
  getNotifications,
} from './PushNotificationTool/PushNotificationTool';
export {
  askUserQuestion,
  validateOptions,
} from './AskUserQuestionTool/AskUserQuestionTool';

// 导出工具特性开关
export {
  TOOL_FEATURE_FLAGS,
  isToolEnabled,
  setToolEnabled,
  getAllToolFlags,
  getEnabledTools,
  getDisabledTools,
  resetToolFlags,
} from './utils/ToolFeatureFlags';

// 导出工具编排服务
export {
  ToolOrchestration,
  defaultToolOrchestration,
} from './services/ToolOrchestration';
export {
  toolResultBudgetManager,
  ToolResultBudgetManager,
} from './services/ToolResultBudget';
export { InterruptibleToolExecutor } from './services/InterruptibleToolExecutor';
export {
  prepareToolResultsForContext,
  persistToolResult,
  SINGLE_RESULT_LIMIT_CHARS,
  TURN_BUDGET_CHARS,
} from './services/ToolResultPersister';

export * from './guardrails';
export * from './web';
export * from './version';

// P2-1: 智能审批 — 低风险命令自动批准
export { SmartApprovalObserver } from './SmartApprovalObserver';
export type { ApprovalResult, ApprovalDecision } from './SmartApprovalObserver';

// P2-3: Schema 净化 — Ollama/llama.cpp GBNF 兼容
export { sanitizeSchema } from './SchemaSanitizer';
export type { SanitizeOptions, SanitizeResult } from './SchemaSanitizer';

// P3-3: Bash 命令 allowlist 前缀匹配防注入
export {
  checkBashAllowlist,
  isReadOnlyBashCommand,
} from './BashAllowlistMatcher';
export type { AllowlistResult } from './BashAllowlistMatcher';

/**
 * 使用 feature() 控制可选工具的条件加载
 */
export function getTools(): any[] {
  const tools: any[] = [];

  if (feature('AGENT_TRIGGERS')) {
    tools.push('CronCreateTool');
    tools.push('CronDeleteTool');
    tools.push('CronListTool');
    tools.push('CronStopTool');
  }

  if (feature('AGENT_TRIGGERS_REMOTE')) {
    tools.push('RemoteTriggerTool');
  }

  if (feature('MONITOR_TOOL')) {
    tools.push('MonitorTool');
  }

  if (feature('VOICE_MODE')) {
    tools.push('VoiceTool');
  }

  if (feature('KAIROS') || feature('KAIROS_GITHUB_WEBHOOKS')) {
    tools.push('SubscribePRTool');
  }

  if (feature('KAIROS') || feature('PROACTIVE')) {
    tools.push('PushNotificationTool');
  }

  return tools;
}

/**
 * 默认导出工具系统
 */
export default {
  initializeToolSystem,
  shutdownToolSystem,
  getToolSystemStatus,
  // 惰性 getter：global* 单例所在模块可能在循环导入中尚未完成求值，延迟到访问时读取（TDZ 修复）
  get ToolManager() {
    return globalToolManager;
  },
  get ToolExecutor() {
    return globalToolExecutor;
  },
  get ToolPermissionManager() {
    return getGlobalToolPermissionManager();
  },
  get ToolMonitor() {
    return globalToolMonitor;
  },
  version: TOOL_SYSTEM_VERSION,
};

// P3-4: MCP 工具分类白名单导出
export {
  classifyMcpTool,
  isCollapsibleMcpTool,
  groupMcpToolsByService,
} from './MCPToolClassifier';

// P2-11: JSON 自纠正导出
export {
  ToolInputSelfCorrector,
  getToolInputSelfCorrector,
  classifyJsonError,
} from './ToolInputSelfCorrector';
export type {
  CorrectionConfig,
  CorrectionResult,
  CorrectionAttempt,
} from './ToolInputSelfCorrector';

// P2-2: 工具参数类型强制
export { coerceToolArgs, tryCoerceToolArgs } from './ToolArgCoercer';
export type {
  ToolSchema as ArgCoercerToolSchema,
  ToolProperty,
  CoerceResult,
  CoerceChange,
} from './ToolArgCoercer';

// P1-11: Few-shot 示例管理
export {
  BUILTIN_EXAMPLES,
  renderFewShotPrompt,
  findFewShotEntry,
  getFewShotToolNames,
} from './FewShotRegistry';
export type { ToolExample, FewShotEntry } from './FewShotRegistry';

// 2026-08-29 R03-002 收敛：跨模块导入统一出口（原从子路径导入的符号）
export { getToolManager, createToolManager } from './ToolManager';
export type { ToolSchema } from './ToolRegistry';
export { createToolRegistry } from './ToolRegistry';
export { ToolFilterManager } from './ToolFilterManager';
export { filterToolsByTask } from './toolCategories';
export { checkSsrf } from './WebFetchTool/ssrf';
export { ImageUrlHelper } from './ImageUrlHelper';
export { ParallelExecutor } from './executor/ParallelExecutor';
export { ToolCallPartitioner } from './orchestration/Partitioner';
export { SubAgentEngine, getSubAgentEngine } from './AgentTool/SubAgentEngine';
export type { SkillDefinition } from './SkillTool/types';

// 2026-08-29 R03-002 收敛二期：工具子目录统一出口
export { FileReadTool } from './FileReadTool/FileReadTool';
export { FileWriteTool } from './FileWriteTool/FileWriteTool';
export { FileEditTool } from './FileEditTool/FileEditTool';
export { BashTool } from './bash/BashTool';
export { createPowerShellTool } from './PowerShellTool/PowerShellTool';
export { GlobTool } from './search/GlobTool';
export { GrepTool } from './GrepTool/GrepTool';
export { createWebSearchTool } from './WebSearchTool/WebSearchTool';
export { createWebFetchTool } from './WebFetchTool/WebFetchTool';
export { TimeTool } from './TimeTool/TimeTool';
export { AgentTool } from './AgentTool/AgentTool';
export { CuratorScheduler } from './AgentTool/CuratorScheduler';
export { SkillLifecycleManager } from './AgentTool/SkillLifecycleManager';
export { notebookManager } from './notebook/NotebookManager';
export { toolCacheManager } from './cache/ToolCacheManager';
export { createToolScheduler } from './scheduler/ToolScheduler';
export { getVideoTaskPersistence } from './VideoGenerateTool/VideoTaskPersistence';
export { getMediaTemplates } from './VideoGenerateTool/MediaTemplates';
export { configureCodeRunner } from './CodeRunner/CodeRunnerTool';
export { getConverterEngine } from './converter/engine/ConverterEngine';
export { FileTypeDetector } from './converter/engine/FileTypeDetector';
export { VERIFICATION_AGENT_DEFINITION } from './AgentTool/strategies/VerificationStrategy';
export { STATUSLINE_SETUP_AGENT_DEFINITION } from './AgentTool/strategies/StatuslineStrategy';
export type {
  ConversionResult,
  FileInfo,
  ConversionOptions,
} from './converter/engine/types';

// 2026-08-30 R03-002 收敛：工具子路径统一出口
export { CanvasTool } from './CanvasTool/CanvasTool';
export { ImageGenerateTool } from './ImageGenerateTool/ImageGenerateTool';
export { ImageAnalysisTool } from './ImageAnalysisTool/ImageAnalysisTool';
export {
  CuratorReviewScope,
  curatorReviewScope,
} from './AgentTool/CuratorReviewScope';
export type {
  ExtendedReviewResult,
  FileReviewTarget,
  MemoryReviewTarget,
  ConfigReviewTarget,
  CuratorScopeConfig,
} from './AgentTool/CuratorReviewScope';
export type {
  ToolCall as RepairToolCall,
  ChatMessage as RepairChatMessage,
} from './repair/types';
