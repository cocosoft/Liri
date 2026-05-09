/**
 * 应用状态类型定义
 * 参考CC源码 cc_code/backend/state/AppStateStore.ts 实现
 */

import { create } from 'zustand';
import type { Tool, ToolPermissionContext } from '@modules/types/tool.js';
import type { Command } from '@modules/types/command.js';
import type {
  MCPServerConnectionInfo,
  ServerResource,
} from '@modules/mcp/types/index.js';
import type { LoadedPlugin, PluginError } from '@modules/types/plugin.js';
import type { TaskState } from '@modules/types/task.js';
import type { AgentId } from '@modules/types/ids.js';
import type { SettingsJson } from '@modules/types/settings.js';
import type { ModelSetting } from '@modules/types/model.js';

/**
 * 完成边界
 */
export type CompletionBoundary =
  | { type: 'complete'; completedAt: number; outputTokens: number }
  | { type: 'bash'; command: string; completedAt: number }
  | { type: 'edit'; toolName: string; filePath: string; completedAt: number }
  | {
      type: 'denied_tool';
      toolName: string;
      detail: string;
      completedAt: number;
    };

/**
 * 推测结果
 */
export type SpeculationResult = {
  messages: Record<string, unknown>[];
  boundary: CompletionBoundary | null;
  timeSavedMs: number;
};

/**
 * 推测状态
 */
export type SpeculationState =
  | { status: 'idle' }
  | {
      status: 'active';
      id: string;
      abort: () => void;
      startTime: number;
      messagesRef: { current: Record<string, unknown>[] };
      writtenPathsRef: { current: Set<string> };
      boundary: CompletionBoundary | null;
      suggestionLength: number;
      toolUseCount: number;
      isPipelined: boolean;
      contextRef: { current: Record<string, unknown> };
      pipelinedSuggestion?: {
        text: string;
        promptId: 'user_intent' | 'stated_intent';
        generationRequestId: string | null;
      } | null;
    };

/**
 * 底部项目
 */
export type FooterItem =
  | 'tasks'
  | 'tmux'
  | 'bagel'
  | 'teams'
  | 'bridge'
  | 'companion';

/**
 * 远程连接状态
 */
export type RemoteConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

/**
 * 应用状态
 */
export interface AppState {
  /** 应用设置 */
  settings: SettingsJson;
  /** 详细模式 */
  verbose: boolean;
  /** 主循环模型 */
  mainLoopModel: ModelSetting;
  /** 会话主循环模型 */
  mainLoopModelForSession: ModelSetting;
  /** 当前模型 */
  model: string;
  /** 当前模型别名 */
  modelAlias: string | null;
  /** 状态栏文本 */
  statusLineText: string | undefined;
  /** 展开视图 */
  expandedView: 'none' | 'tasks' | 'teammates';
  /** 是否仅简短模式 */
  isBriefOnly: boolean;
  /** 显示队友消息预览 */
  showTeammateMessagePreview?: boolean;
  /** 选中的IP代理索引 */
  selectedIPAgentIndex: number;
  /** 协调任务索引 */
  coordinatorTaskIndex: number;
  /** 视图选择模式 */
  viewSelectionMode: 'none' | 'selecting-agent' | 'viewing-agent';
  /** 底部选择 */
  footerSelection: FooterItem | null;
  /** 工具权限上下文 */
  toolPermissionContext: ToolPermissionContext;
  /** 加载提示 */
  spinnerTip?: string;
  /** 代理名称 */
  agent: string | undefined;
  /** Kairos启用状态 */
  kairosEnabled: boolean;
  /** 远程会话URL */
  remoteSessionUrl: string | undefined;
  /** 远程连接状态 */
  remoteConnectionStatus: RemoteConnectionStatus;
  /** 远程后台任务计数 */
  remoteBackgroundTaskCount: number;
  /** REPL桥接启用 */
  replBridgeEnabled: boolean;
  /** REPL桥接显式 */
  replBridgeExplicit: boolean;
  /** REPL桥接仅出站 */
  replBridgeOutboundOnly: boolean;
  /** REPL桥接已连接 */
  replBridgeConnected: boolean;
  /** REPL桥接会话活动 */
  replBridgeSessionActive: boolean;
  /** REPL桥接重连 */
  replBridgeReconnecting: boolean;
  /** REPL桥接连接URL */
  replBridgeConnectUrl: string | undefined;
  /** REPL桥接会话URL */
  replBridgeSessionUrl: string | undefined;
  /** REPL桥接环境ID */
  replBridgeEnvironmentId: string | undefined;
  /** REPL桥接会话ID */
  replBridgeSessionId: string | undefined;
  /** REPL桥接错误 */
  replBridgeError: string | undefined;
  /** REPL桥接初始名称 */
  replBridgeInitialName: string | undefined;
  /** 显示远程标注 */
  showRemoteCallout: boolean;
  /** 任务状态 */
  tasks: { [taskId: string]: TaskState };
  /** 代理名称注册表 */
  agentNameRegistry: Map<string, AgentId>;
  /** 前台任务ID */
  foregroundedTaskId?: string;
  /** 查看代理任务ID */
  viewingAgentTaskId?: string;
  /** 伴侣反应 */
  companionReaction?: string;
  /** 伴侣宠物时间 */
  companionPetAt?: number;
  /** MCP状态 */
  mcp: {
    /** MCP客户端 */
    clients: MCPServerConnectionInfo[];
    /** MCP工具 */
    tools: Tool[];
    /** MCP命令 */
    commands: Command[];
    /** MCP资源 */
    resources: Record<string, ServerResource[]>;
    /** 插件重连键 */
    pluginReconnectKey: number;
  };
  /** 插件状态 */
  plugins: {
    /** 启用的插件 */
    enabled: LoadedPlugin[];
    /** 禁用的插件 */
    disabled: LoadedPlugin[];
    /** 插件命令 */
    commands: Command[];
    /** 插件错误 */
    errors: PluginError[];
    /** 安装状态 */
    installationStatus: {
      marketplaces: Array<{
        name: string;
        status: 'pending' | 'installing' | 'installed' | 'failed';
        error?: string;
      }>;
      plugins: Array<{
        id: string;
        version?: string;
        status: 'pending' | 'installing' | 'installed' | 'failed';
        error?: string;
      }>;
    };
  };
}

/**
 * 应用状态存储接口
 */
export interface AppStateStore {
  /** 获取状态 */
  getState(): AppState;
  /** 设置状态 */
  setState(updater: (state: AppState) => AppState): void;
  /** 订阅状态变更 */
  subscribe(listener: (state: AppState) => void): () => void;
  /** 替换整个状态 */
  replaceState(state: AppState): void;
  /** 批量更新 */
  batchUpdate(updater: (state: AppState) => AppState): void;
}

/**
 * 获取默认应用状态
 */
export function getDefaultAppState(): AppState {
  return {
    settings: {} as SettingsJson,
    verbose: false,
    model: 'claude-3-5-sonnet-20241022',
    modelAlias: null,
    mainLoopModel: {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
    } as ModelSetting,
    mainLoopModelForSession: {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.1,
    } as ModelSetting,
    statusLineText: undefined,
    expandedView: 'none',
    isBriefOnly: false,
    selectedIPAgentIndex: 0,
    coordinatorTaskIndex: -1,
    viewSelectionMode: 'none',
    footerSelection: null,
    toolPermissionContext: {
      isBypassPermissionsModeAvailable: true,
      isBypassPermissionsModeEnabled: false,
      circuitBroken: false,
      circuitBrokenAt: undefined,
    } as ToolPermissionContext,
    agent: undefined,
    kairosEnabled: false,
    remoteSessionUrl: undefined,
    remoteConnectionStatus: 'disconnected',
    remoteBackgroundTaskCount: 0,
    replBridgeEnabled: false,
    replBridgeExplicit: false,
    replBridgeOutboundOnly: false,
    replBridgeConnected: false,
    replBridgeSessionActive: false,
    replBridgeReconnecting: false,
    replBridgeConnectUrl: undefined,
    replBridgeSessionUrl: undefined,
    replBridgeEnvironmentId: undefined,
    replBridgeSessionId: undefined,
    replBridgeError: undefined,
    replBridgeInitialName: undefined,
    showRemoteCallout: false,
    tasks: {},
    agentNameRegistry: new Map(),
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
    },
  };
}

/**
 * 状态变更监听器
 */
export type StateChangeListener = (state: AppState) => void;

/**
 * 状态更新函数
 */
export type StateUpdater = (state: AppState) => AppState;

/**
 * Zustand 状态钩子（用于 buddy/companion 终端 UI 渲染）
 */
const useAppStore = create<{
  state: AppState;
  setState: (
    partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)
  ) => void;
}>((set) => ({
  state: getDefaultAppState(),
  setState: (partial) =>
    set((prev) => ({
      state:
        typeof partial === 'function'
          ? { ...prev.state, ...partial(prev.state) }
          : { ...prev.state, ...partial },
    })),
}));

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useAppStore((store) => selector(store.state));
}

export function useSetAppState() {
  return useAppStore((store) => store.setState);
}
