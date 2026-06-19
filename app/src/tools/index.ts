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
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });
import { ToolManager, globalToolManager } from './core/ToolManager';
import { ToolRegistry, setToolRegistry, getToolRegistry } from './ToolRegistry';
import { ToolExecutor, globalToolExecutor } from './executor/ToolExecutor';
import {
  ToolPermissionManager,
  globalToolPermissionManager,
} from './security/ToolPermissionManager';
import { ToolMonitor, globalToolMonitor } from './monitoring/ToolMonitor';

// 导出核心组件
export { ToolManager, globalToolManager };
export { ToolRegistry, setToolRegistry, getToolRegistry };
export { ToolExecutor, globalToolExecutor };

// 导出安全组件
export { ToolPermissionManager, globalToolPermissionManager };

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
    logger.error('❌ 工具系统初始化失败:', { error });
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
    logger.error('❌ 工具系统关闭失败:', { error });
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
    permissionManager: globalToolPermissionManager.getConfig(),
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
  GLOB_TOOL_NAME,
  DESCRIPTION as globDescription,
} from './GlobTool/prompt';
export {
  FILE_READ_TOOL_NAME,
  DESCRIPTION as readDescription,
} from './FileReadTool/prompt';
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
  sendMessage,
  getMessageHistory,
} from './SendMessageTool/SendMessageTool';
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

export * from './guardrails';
export * from './web';
export * from './version';

/**
 * 使用 feature() 控制可选工具的条件加载
 */
export function getTools(): any[] {
  const tools: any[] = [];

  if (feature('AGENT_TRIGGERS')) {
    tools.push('CronCreateTool');
    tools.push('CronDeleteTool');
    tools.push('CronListTool');
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
  ToolManager: globalToolManager,
  ToolExecutor: globalToolExecutor,
  ToolPermissionManager: globalToolPermissionManager,
  ToolMonitor: globalToolMonitor,
  version: TOOL_SYSTEM_VERSION,
};
