/**
 * 工具工厂
 * 负责创建各种工具实例，支持基于功能标志的条件加载
 */
import { Tool, ToolTag } from './types/Tool';
import type { ToolProgressData } from './types/ToolProgress';
import { createToolResult } from './types/ToolResult';
import { BashTool } from './bash/BashTool';
import { FileReadTool } from './FileReadTool/FileReadTool';
import { FileWriteTool } from './FileWriteTool/FileWriteTool';
import { FileEditTool } from './FileEditTool/FileEditTool';
import { FileConvertTool } from './FileConvertTool/FileConvertTool';
import { GrepTool } from './GrepTool/GrepTool';
import { GlobTool } from './search/GlobTool';
import { FileSearchTool } from './FileSearchTool/FileSearchTool'; //文件搜索工具（内部其实调用GlobTool）
import { CronCreateTool } from './ChronosTool/CronCreateTool';
import { CronDeleteTool } from './ChronosTool/CronDeleteTool';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { CronListTool } from './ChronosTool/CronListTool';
import { knowledgeRouter } from '../knowledge/KnowledgeRouter';
import { resolveMemoryDir } from '@modules/core';
import { createKnowledgeSearchTool } from '../knowledge/tools/KnowledgeSearchTool';
import { createKnowledgeWriteTool } from '../knowledge/tools/KnowledgeWriteTool';
import { createKnowledgeDeleteTool } from '../knowledge/tools/KnowledgeDeleteTool';
import { createKnowledgeImportTool } from '../knowledge/tools/KnowledgeImportTool';
import { createKnowledgeExportTool } from '../knowledge/tools/KnowledgeExportTool';
import { createKnowledgeSnapshotsTool } from '../knowledge/tools/KnowledgeSnapshotsTool';
import { createKnowledgeRestoreTool } from '../knowledge/tools/KnowledgeRestoreTool';
import { createUnifiedSearchTool } from '../memory/tools/UnifiedSearchTool';
import { createMemoryTool } from '../memory/tools/MemoryTool';
import { createMemoryGetTool } from '../memory/tools/MemoryGetTool';
import { SearchToolImpl } from '../memory/tools/SearchTool';
import { createUnifiedSearchService } from '../memory/services/UnifiedSearchService';
import { MemoryManagerImpl } from '../memory/MemoryManager';

const logger = new Logger({ module: 'tools:factory', level: LogLevel.INFO });
import { PowerShellTool } from './PowerShellTool/PowerShellTool';
import { WebFetchTool } from './WebFetchTool/WebFetchTool';
import { WebSearchTool } from './WebSearchTool/WebSearchTool';
import { AgentTool } from './AgentTool/AgentTool';
import { SkillTool } from './SkillTool/SkillTool';
import { TaskStopTool } from './TaskTool/TaskStopTool';
import {
  TaskCreateListTool,
  TaskUpdateStatusTool,
  TaskGetListTool,
  ViewTasksTool,
  AbortTaskTool,
  ViewPlanTool,
} from './TaskOrchestratorTools/TaskOrchestratorTools';
import { TodoWriteTool } from './TodoWriteTool/TodoWriteTool';
import { TungstenTool } from './TungstenTool/TungstenTool';
import { LSPToolAdapter } from './adapters/LSPToolAdapter';
import { REPLToolAdapter } from './adapters/REPLToolAdapter';
import { NotebookToolAdapter } from './adapters/NotebookToolAdapter';
import { AskUserQuestionTool } from './AskUserQuestionTool/AskUserQuestionTool';
import { ConfigTool } from './ConfigTool/ConfigTool';
import { MCPResourceTool } from './MCPResourceTool/MCPResourceTool';
import { BriefTool } from './BriefTool/BriefTool';
import { SaveConversationTool } from './SaveConversationTool/SaveConversationTool';
import { BrowserTool } from './BrowserTool/BrowserTool';
import { PlanTool } from './PlanTool/PlanTool';
import { ToolSearchTool } from './ToolSearchTool/ToolSearchTool';
import { SendMessageTool } from './SendMessageTool/SendMessageTool';
import { TeamCreateTool } from './TeamCreateTool/TeamCreateTool';
import { TeamDeleteTool } from './TeamDeleteTool/TeamDeleteTool';
import { EnterWorktreeTool } from './EnterWorktreeTool/EnterWorktreeTool';
import { ExitWorktreeTool } from './ExitWorktreeTool/ExitWorktreeTool';
import { ListPeersTool } from './ListPeersTool/ListPeersTool';
import { SessionsTool } from './SessionsTool/SessionsTool';
import { ClipboardTool } from './ClipboardTool/ClipboardTool';
import { createComputerUseTool } from './ComputerUseTool';
import { ImageTool } from './ImageTool/ImageTool';
import { ImageAnalysisTool } from './ImageAnalysisTool/ImageAnalysisTool';
import { VideoTool } from './VideoTool/VideoTool';
import { MusicTool } from './MusicTool/MusicTool';
import { CanvasTool } from './CanvasTool/CanvasTool';
import { ListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.js';
import { ReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.js';
import { MCPTool } from '../mcp/MCPTool';
import { isAntUser, isSimpleMode } from '../utils/features.js';
import { isToolEnabled } from './utils/ToolFeatureFlags';
import { isFeatureEnabled } from '@modules/core';
import { NodesTool } from './NodesTool/NodesTool';
import { SleepTool } from './SleepTool/SleepTool.js';
import { MonitorTool } from './MonitorTool/MonitorTool.js';
import { CodeAnalysisTool } from './CodeAnalysisTool/CodeAnalysisTool';
import { VoiceInputTool } from './VoiceInputTool/VoiceInputTool';
import { VoiceOutputTool } from './VoiceOutputTool/VoiceOutputTool';
import { TTSTool } from './TTSTool/TTSTool';
import { ThinkingTool } from './ThinkingTool/ThinkingTool';
import { PDFTool } from './PDFTool/PDFTool';
import { KanbanTool } from './KanbanTool/KanbanTool';
import { SessionsSendTool } from './SessionsSendTool/SessionsSendTool';
import { SessionsSpawnTool } from './SessionsSpawnTool/SessionsSpawnTool';
import { SessionStatusTool } from './SessionStatusTool/SessionStatusTool';
import { SessionsYieldTool } from './SessionsYieldTool/SessionsYieldTool';
import { SessionsHistoryTool } from './SessionsHistoryTool/SessionsHistoryTool';
import { ChannelTool } from './ChannelTool/ChannelTool';
import { ImageGenerateTool } from './ImageGenerateTool/ImageGenerateTool';
import { ImageSvgTool } from './ImageSvgTool/ImageSvgTool';
import { ImageDisplayTool } from './ImageDisplayTool/ImageDisplayTool';
import { VideoDisplayTool } from './VideoDisplayTool/VideoDisplayTool';
import { AudioPlayTool } from './AudioPlayTool/AudioPlayTool';
import { VideoAnalysisTool } from './VideoAnalysisTool/VideoAnalysisTool';
import { BrowserVisionTool } from './BrowserVisionTool/BrowserVisionTool';
import { MusicGenerateTool } from './MusicGenerateTool/MusicGenerateTool';
import { VideoGenerateTool } from './VideoGenerateTool/VideoGenerateTool';
import { McpAuthTool } from './McpAuthTool/McpAuthTool';
import { AgentsListTool } from './AgentsListTool/AgentsListTool';
import { UpdatePlanTool } from './UpdatePlanTool/UpdatePlanTool';
import { TaskOutputTool } from './TaskOutputTool/TaskOutputTool';
import { TimeTool } from './TimeTool/TimeTool';
import { RecallMemoryTool } from './RecallMemoryTool/RecallMemoryTool';
import { createUtilityTools } from './UtilityTools';
import {
  createDecisionLoggerTool,
  createConfidenceScorerTool,
  createPerformanceProfilerTool,
  createMemoryDumpTool,
  createSystemInfoTool,
  createProcessManagerTool,
  createGitBranchTool,
  createGitMergeTool,
  createGitStashTool,
  createCodeFormatTool,
  createReviewAssignTool,
  createCodeReviewTool,
} from './ExpansionTools';
import {
  BroadcastTool,
  createBroadcastTool,
} from './BroadcastTool/BroadcastTool';
import { TraceRecordingTool } from './TraceRecordingTool/TraceRecordingTool.js';
import {
  sendNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  clearNotifications,
  isPushNotificationEnabled,
} from './PushNotificationTool/PushNotificationTool.js';
import {
  subscribeToPR,
  getSubscriptions,
  unsubscribe,
  isPRSubscriptionEnabled,
} from './SubscribePRTool/SubscribePRTool.js';

interface ToolDefinitionInput {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        default?: unknown;
      }
    >;
    required?: string[];
  };
  aliases?: string[];
  searchTips?: string[];
  tags?: ToolTag[];
}

/**
 * 工具工厂类
 */
export class ToolFactory {
  /**
   * 创建工具
   * @param def 工具定义
   * @returns 工具实例
   */
  createTool(def: ToolDefinitionInput): Tool {
    // 构建基础工具对象，包含名称、描述及参数解析
    const tool = {
      name: def.name || '',
      description: def.description || '',
      // 将输入 schema 的属性转换为标准化的参数列表
      params: def.inputSchema?.properties
        ? Object.entries(def.inputSchema.properties).map(
            ([name, prop]: [string, Record<string, unknown>]) => ({
              name,
              type: (prop.type as string) || 'string',
              description: (prop.description as string) || '',
              required: def.inputSchema?.required?.includes(name) || false,
              default: prop.default,
            })
          )
        : [],
      aliases: def.aliases,
      searchHint: def.searchTips?.[0],
      maxResultSizeChars: 10000,
      isEnabled: () => true,
      isReadOnly: () => false,
      isConcurrencySafe: () => true,
      // 默认执行逻辑，返回空结果
      execute: async (
        input: unknown,
        context: unknown,
        onProgress?: unknown
      ) => {
        return createToolResult(null, {
          newMessages: [],
        });
      },
      // 获取工具完整信息的方法
      getInfo: function () {
        return {
          name: tool.name,
          description: tool.description,
          params: tool.params,
          aliases: tool.aliases,
          searchTips: tool.searchHint ? [tool.searchHint] : [],
          enabled: true,
          readOnly: false,
          destructive: false,
          concurrencySafe: true,
          deferred: false,
          alwaysLoad: false,
          interruptBehavior: 'block' as const,
          maxResultSizeChars: tool.maxResultSizeChars,
          tags: def.tags,
        };
      },
    };
    return tool;
  }

  /**
   * 创建Bash工具
   * @returns Bash工具实例
   */
  createBashTool(): Tool {
    return new BashTool();
  }

  /**
   * 创建PowerShell工具
   * @returns PowerShell工具实例
   */
  createPowerShellTool(): Tool {
    return new PowerShellTool();
  }

  /**
   * 创建文件读取工具
   * @returns 文件读取工具实例
   */
  createFileReadTool(): Tool {
    return new FileReadTool();
  }

  /**
   * 创建文件写入工具
   * @returns 文件写入工具实例
   */
  createFileWriteTool(): Tool {
    return new FileWriteTool();
  }

  /**
   * 创建文件编辑工具
   * @returns 文件编辑工具实例
   */
  createFileEditTool(): Tool {
    return new FileEditTool();
  }

  createFileConvertTool(): Tool {
    return new FileConvertTool();
  }

  /**
   * 创建搜索工具
   * @returns 搜索工具实例
   */
  createGrepTool(): Tool {
    return new GrepTool();
  }

  /**
   * 创建文件匹配工具
   * @returns 文件匹配工具实例
   */
  createGlobTool(): Tool {
    return new GlobTool();
  }

  /**
   * 创建文件搜索工具
   * 基于 Glob 的文件搜索，返回含 canonicalPath 的搜索结果
   * @returns 文件搜索工具实例
   */
  createFileSearchTool(): Tool {
    return new FileSearchTool();
  }

  /**
   * 创建Web搜索工具
   * @returns Web搜索工具实例
   */
  createWebSearchTool(): Tool {
    return new WebSearchTool();
  }

  /**
   * 创建LSP工具
   * @returns LSP工具实例
   */
  createLSPTool(): Tool {
    return new LSPToolAdapter();
  }

  /**
   * 创建REPL工具
   * @returns REPL工具实例
   */
  createREPLTool(): Tool {
    return new REPLToolAdapter();
  }

  /**
   * 创建Notebook工具
   * @returns Notebook工具实例
   */
  createNotebookTool(): Tool {
    return new NotebookToolAdapter();
  }

  /**
   * 创建网络内容获取工具
   * @returns 网络内容获取工具实例
   */
  createWebFetchTool(): Tool {
    return new WebFetchTool();
  }

  /**
   * 创建配置工具
   * @returns 配置工具实例
   */
  createConfigTool(): Tool {
    return new ConfigTool();
  }

  /**
   * 创建TodoWrite工具
   * @returns TodoWrite工具实例
   */
  createTodoWriteTool(): Tool {
    return new TodoWriteTool();
  }

  /**
   * 创建Tungsten工具
   * @returns Tungsten工具实例
   */
  createTungstenTool(): Tool {
    return new TungstenTool();
  }

  /**
   * 创建MCP工具
   * @returns MCP工具实例
   */
  createMCPTool(): Tool {
    return MCPTool;
  }

  /**
   * 创建Cron创建工具
   * @returns Cron创建工具实例
   */
  createCronCreateTool(): Tool {
    return CronCreateTool.create();
  }

  /**
   * 创建Cron删除工具
   * @returns Cron删除工具实例
   */
  createCronDeleteTool(): Tool {
    return CronDeleteTool.create();
  }

  /**
   * 创建Cron列表工具
   * @returns Cron列表工具实例
   */
  createCronListTool(): Tool {
    return CronListTool.create();
  }

  /**
   * 创建Agent工具
   * @returns Agent工具实例
   */
  createAgentTool(): Tool {
    return new AgentTool();
  }

  /**
   * 创建Skill工具
   * @returns Skill工具实例
   */
  createSkillTool(): Tool {
    return new SkillTool();
  }

  /**
   * 创建NotebookEdit工具（兼容旧接口，实际返回 NotebookToolAdapter）
   * @returns NotebookEdit工具实例
   */
  createNotebookEditTool(): Tool {
    return new NotebookToolAdapter();
  }

  /**
   * 创建TaskStop工具
   * @returns TaskStop工具实例
   */
  createTaskStopTool(): Tool {
    return new TaskStopTool();
  }

  /**
   * 创建 TaskCreateList 工具
   */
  createTaskCreateListTool(): Tool {
    return new TaskCreateListTool();
  }

  /**
   * 创建 TaskUpdateStatus 工具
   */
  createTaskUpdateStatusTool(): Tool {
    return new TaskUpdateStatusTool();
  }

  /**
   * 创建 TaskGetList 工具
   */
  createTaskGetListTool(): Tool {
    return new TaskGetListTool();
  }

  /**
   * 创建 ViewTasks 工具
   */
  createViewTasksTool(): Tool {
    return new ViewTasksTool();
  }

  /**
   * 创建 AbortTask 工具
   */
  createAbortTaskTool(): Tool {
    return new AbortTaskTool();
  }

  /**
   * 创建 ViewPlan 工具
   */
  createViewPlanTool(): Tool {
    return new ViewPlanTool();
  }

  /**
   * 创建AskUserQuestion工具
   * @returns AskUserQuestion工具实例
   */
  createAskUserQuestionTool(): Tool {
    return new AskUserQuestionTool();
  }

  /**
   * 创建MCPResource工具
   * @returns MCPResource工具实例
   */
  createMCPResourceTool(): Tool {
    return new MCPResourceTool();
  }

  /**
   * 创建ListMcpResources工具
   * @returns ListMcpResources工具实例
   */
  createListMcpResourcesTool(): Tool {
    return ListMcpResourcesTool;
  }

  /**
   * 创建ReadMcpResource工具
   * @returns ReadMcpResource工具实例
   */
  createReadMcpResourceTool(): Tool {
    return ReadMcpResourceTool;
  }

  /**
   * 创建Brief工具
   * @returns Brief工具实例
   */
  createBriefTool(): Tool {
    return new BriefTool();
  }

  /**
   * 创建对话记录保存工具
   * @returns SaveConversationTool实例
   */
  createSaveConversationTool(): Tool {
    return new SaveConversationTool();
  }

  /**
   * 创建浏览器自动化工具
   * @returns 浏览器自动化工具实例
   */
  createBrowserTool(): Tool {
    return new BrowserTool();
  }

  /**
   * 创建计划模式工具
   * @returns 计划模式工具实例
   */
  createPlanTool(): Tool {
    return new PlanTool() as unknown as Tool<
      unknown,
      unknown,
      ToolProgressData
    >;
  }

  /**
   * 创建Sleep工具
   * @returns Sleep工具实例
   */
  createSleepTool(): Tool | null {
    try {
      return new SleepTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_sleep_tool',
      });
      return null;
    }
  }

  /**
   * 创建RemoteTrigger工具
   * @returns RemoteTrigger工具实例
   */
  createRemoteTriggerTool(): Tool | null {
    return null;
  }

  /**
   * 创建Monitor工具
   * @returns Monitor工具实例
   */
  createMonitorTool(): Tool | null {
    try {
      return new MonitorTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_monitor_tool',
      });
      return null;
    }
  }

  /**
   * 创建TraceRecording工具
   * @returns TraceRecording工具实例
   */
  createTraceRecordingTool(): Tool | null {
    try {
      return new TraceRecordingTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_trace_recording_tool',
      });
      return null;
    }
  }

  /**
   * 创建SendMessage工具
   * @returns SendMessage工具实例
   */
  createSendMessageTool(): Tool | null {
    if (!isToolEnabled('ENABLE_SEND_MESSAGE')) return null;
    try {
      return new SendMessageTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_send_message_tool',
      });
      return null;
    }
  }

  /**
   * 创建TeamCreate工具
   * @returns TeamCreate工具实例
   */
  createTeamCreateTool(): Tool | null {
    if (!isToolEnabled('ENABLE_TEAM_CREATE')) return null;
    try {
      return new TeamCreateTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_team_create_tool',
      });
      return null;
    }
  }

  /**
   * 创建TeamDelete工具
   * @returns TeamDelete工具实例
   */
  createTeamDeleteTool(): Tool | null {
    if (!isToolEnabled('ENABLE_TEAM_DELETE')) return null;
    try {
      return new TeamDeleteTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_team_delete_tool',
      });
      return null;
    }
  }

  /**
   * 创建SendUserFile工具
   * @returns SendUserFile工具实例
   */
  createSendUserFileTool(): Tool | null {
    return null;
  }

  /**
   * 创建PushNotification工具
   * @returns PushNotification工具实例
   */
  createPushNotificationTool(): Tool | null {
    if (!isToolEnabled('ENABLE_PUSH_NOTIFICATION')) return null;
    try {
      if (!isPushNotificationEnabled()) return null;
      return {
        name: 'push_notification',
        description:
          'Send and manage push notifications. Supports sending notifications, listing, marking as read, and clearing.',
        params: [
          {
            name: 'action',
            type: 'string',
            description:
              'Action: send, list, unread, mark_read, mark_all_read, clear',
            required: true,
            enum: [
              'send',
              'list',
              'unread',
              'mark_read',
              'mark_all_read',
              'clear',
            ],
          },
          {
            name: 'title',
            type: 'string',
            description: 'Notification title (required for send)',
            required: false,
          },
          {
            name: 'body',
            type: 'string',
            description: 'Notification body (required for send)',
            required: false,
          },
          {
            name: 'url',
            type: 'string',
            description: 'Optional URL for notification',
            required: false,
          },
          {
            name: 'notificationId',
            type: 'string',
            description: 'Notification ID (required for mark_read)',
            required: false,
          },
        ],
        execute: async (input: Record<string, unknown>) => {
          const action = input.action as string;
          switch (action) {
            case 'send': {
              const n = sendNotification(
                input.title as string,
                input.body as string,
                input.url as string | undefined
              );
              return { success: true, output: JSON.stringify(n) };
            }
            case 'list': {
              const list = getNotifications();
              return { success: true, output: JSON.stringify(list) };
            }
            case 'unread': {
              const count = getUnreadCount();
              return {
                success: true,
                output: JSON.stringify({ unread: count }),
              };
            }
            case 'mark_read': {
              const ok = markAsRead(input.notificationId as string);
              return {
                success: ok,
                output: ok ? 'Marked as read' : 'Not found',
              };
            }
            case 'mark_all_read': {
              markAllAsRead();
              return { success: true, output: 'All marked as read' };
            }
            case 'clear': {
              clearNotifications();
              return { success: true, output: 'Notifications cleared' };
            }
            default:
              return { success: false, error: `Unknown action: ${action}` };
          }
        },
        isEnabled: () => true,
      } as unknown as Tool;
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_push_notification_tool',
      });
      return null;
    }
  }

  /**
   * 创建SubscribePR工具
   * @returns SubscribePR工具实例
   */
  createSubscribePRTool(): Tool | null {
    if (!isToolEnabled('ENABLE_SUBSCRIBE_PR')) return null;
    try {
      if (!isPRSubscriptionEnabled()) return null;
      return {
        name: 'subscribe_pr',
        description:
          'Subscribe to pull request events (opened, closed, merged, comment, review) for monitoring and notifications',
        params: [
          {
            name: 'action',
            type: 'string',
            description: 'Action: subscribe, list, unsubscribe',
            required: true,
            enum: ['subscribe', 'list', 'unsubscribe'],
          },
          {
            name: 'repo',
            type: 'string',
            description: 'Repository name (e.g., "owner/repo")',
            required: false,
          },
          {
            name: 'prNumber',
            type: 'number',
            description: 'PR number (optional, subscribe to specific PR)',
            required: false,
          },
          {
            name: 'events',
            type: 'array',
            description: 'Events to subscribe to',
            required: false,
          },
          {
            name: 'subscriptionId',
            type: 'string',
            description: 'Subscription ID (required for unsubscribe)',
            required: false,
          },
        ],
        execute: async (input: Record<string, unknown>) => {
          const action = input.action as string;
          if (action === 'subscribe') {
            const result = subscribeToPR(
              input.repo as string,
              input.events as string[] as any,
              input.prNumber as number | undefined
            );
            return { success: true, output: JSON.stringify(result) };
          }
          if (action === 'list') {
            const subs = getSubscriptions(input.repo as string | undefined);
            return { success: true, output: JSON.stringify(subs) };
          }
          if (action === 'unsubscribe') {
            const ok = unsubscribe(input.subscriptionId as string);
            return { success: ok, output: ok ? 'Unsubscribed' : 'Not found' };
          }
          return { success: false, error: `Unknown action: ${action}` };
        },
        isEnabled: () => true,
      } as unknown as Tool;
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_subscribe_pr_tool',
      });
      return null;
    }
  }

  /**
   * 创建Snip工具
   * @returns Snip工具实例
   */
  createSnipTool(): Tool | null {
    return null;
  }

  /**
   * 创建EnterWorktree工具
   * @returns EnterWorktree工具实例
   */
  createEnterWorktreeTool(): Tool | null {
    return new EnterWorktreeTool();
  }

  /**
   * 创建ExitWorktree工具
   * @returns ExitWorktree工具实例
   */
  createExitWorktreeTool(): Tool | null {
    return new ExitWorktreeTool();
  }

  /**
   * 创建ListPeers工具
   * @returns ListPeers工具实例
   */
  createListPeersTool(): Tool | null {
    return new ListPeersTool();
  }

  /**
   * 创建Workflow工具
   * @returns Workflow工具实例
   */
  createWorkflowTool(): Tool | null {
    return null;
  }

  /**
   * 创建ToolSearch工具
   * @returns ToolSearch工具实例
   */
  createToolSearchTool(): Tool | null {
    return new ToolSearchTool();
  }

  /**
   * 创建Sessions统一会话管理工具
   */
  createSessionsTool(): Tool {
    return new SessionsTool();
  }

  /**
   * 创建剪贴板工具
   */
  createClipboardTool(): Tool {
    return new ClipboardTool();
  }

  /**
   * 创建桌面自动化工具（ComputerUse）
   */
  createComputerUseTool(): Tool {
    return createComputerUseTool();
  }

  /**
   * 创建通用图片编辑工具
   */
  createImageTool(): Tool {
    return new ImageTool();
  }

  /**
   * 创建图片分析工具
   */
  createImageAnalysisTool(): Tool {
    return new ImageAnalysisTool();
  }

  /**
   * 创建通用视频编辑工具
   */
  createVideoTool(): Tool {
    return new VideoTool();
  }

  /**
   * 创建通用音频编辑工具
   */
  createMusicTool(): Tool {
    return new MusicTool();
  }

  /**
   * 创建 Canvas 画布工具
   */
  createCanvasTool(): Tool {
    return new CanvasTool();
  }

  /**
   * 创建图片生成工具
   */
  createImageGenerateTool(): Tool {
    return new ImageGenerateTool();
  }

  /**
   * 创建视频分析工具
   */
  createVideoAnalysisTool(): Tool {
    return new VideoAnalysisTool();
  }

  /**
   * 创建视频生成工具
   */
  createVideoGenerateTool(): Tool {
    return new VideoGenerateTool();
  }

  /**
   * 创建浏览器截图视觉分析工具
   */
  createBrowserVisionTool(): Tool {
    return new BrowserVisionTool();
  }

  /**
   * 创建 SVG 生成工具
   */
  createImageSvgTool(): Tool {
    return new ImageSvgTool();
  }

  /**
   * 创建图片预览工具
   */
  createImageDisplayTool(): Tool {
    return new ImageDisplayTool();
  }

  /**
   * 创建视频预览工具
   */
  createVideoDisplayTool(): Tool {
    return new VideoDisplayTool();
  }

  /**
   * 创建音频播放工具
   */
  createAudioPlayTool(): Tool {
    return new AudioPlayTool();
  }

  /**
   * 创建网关管理工具
   */
  createGatewayTool(): Tool {
    return new ChannelTool();
  }

  /**
   * 创建频道管理器工具
   */
  createChannelManagerTool(): Tool {
    return new ChannelTool();
  }

  /**
   * 创建广播工具
   */
  createBroadcastTool(): Tool {
    return new BroadcastTool();
  }
}

/**
 * 创建工具工厂实例
 * @returns 工具工厂实例
 */
export function createToolFactory(): ToolFactory {
  return new ToolFactory();
}

/**
 * 获取所有基础工具列表
 * 支持基于功能标志的条件加载，参考CC源码的getAllBaseTools()实现
 * 注意：当前应用使用PlanTool代替EnterPlanModeTool和ExitPlanModeTool
 */
export function getAllBaseTools(): Tool[] {
  const tools: Tool[] = [];

  tools.push(new AgentTool());
  tools.push(new TaskStopTool());
  tools.push(new TaskCreateListTool());
  tools.push(new TaskUpdateStatusTool());
  tools.push(new TaskGetListTool());
  tools.push(new ViewTasksTool());
  tools.push(new AbortTaskTool());
  tools.push(new ViewPlanTool());
  tools.push(new BashTool());

  const globTool = new GlobTool();
  const grepTool = new GrepTool();
  const fileSearchTool = new FileSearchTool();
  if (globTool) {
    tools.push(globTool);
  }
  if (grepTool) {
    tools.push(grepTool);
  }
  if (fileSearchTool) {
    tools.push(fileSearchTool);
  }

  tools.push(new FileEditTool());
  tools.push(new FileReadTool());
  tools.push(new FileWriteTool());
  tools.push(new WebFetchTool());
  tools.push(new TodoWriteTool());
  tools.push(new WebSearchTool());
  tools.push(new AskUserQuestionTool());

  const knowledgeSearchTool = createKnowledgeSearchTool(knowledgeRouter);
  if (knowledgeSearchTool) {
    tools.push(knowledgeSearchTool);
  }

  const knowledgeWriteTool = createKnowledgeWriteTool();
  if (knowledgeWriteTool) {
    tools.push(knowledgeWriteTool);
  }

  const knowledgeDeleteTool = createKnowledgeDeleteTool();
  if (knowledgeDeleteTool) {
    tools.push(knowledgeDeleteTool);
  }
  const knowledgeImportTool = createKnowledgeImportTool();
  if (knowledgeImportTool) {
    tools.push(knowledgeImportTool);
  }
  const knowledgeExportTool = createKnowledgeExportTool();
  if (knowledgeExportTool) {
    tools.push(knowledgeExportTool);
  }
  const knowledgeSnapshotsTool = createKnowledgeSnapshotsTool();
  if (knowledgeSnapshotsTool) {
    tools.push(knowledgeSnapshotsTool);
  }
  const knowledgeRestoreTool = createKnowledgeRestoreTool();
  if (knowledgeRestoreTool) {
    tools.push(knowledgeRestoreTool);
  }

  const memoryManager = new MemoryManagerImpl(resolveMemoryDir());
  const memorySearchTool = createMemoryTool(new SearchToolImpl(memoryManager));
  if (memorySearchTool) {
    tools.push(memorySearchTool);
  }

  const memoryGetTool = createMemoryGetTool(memoryManager);
  if (memoryGetTool) {
    tools.push(memoryGetTool);
  }

  const unifiedSearchService = createUnifiedSearchService(
    knowledgeRouter,
    memoryManager
  );
  const unifiedSearchTool = createUnifiedSearchTool(unifiedSearchService);
  if (unifiedSearchTool) {
    tools.push(unifiedSearchTool);
  }
  tools.push(new SkillTool());
  tools.push(
    new PlanTool() as unknown as Tool<unknown, unknown, ToolProgressData>
  );

  if (isAntUser()) {
    tools.push(new ConfigTool());
    tools.push(new TungstenTool());
  }

  if (isFeatureEnabled('LSP')) {
    tools.push(new LSPToolAdapter());
  }

  if (isFeatureEnabled('AGENT_TRIGGERS')) {
    tools.push(CronCreateTool.create());
    tools.push(CronDeleteTool.create());
    tools.push(CronListTool.create());
  }

  const sendMessageTool = new SendMessageTool();
  if (sendMessageTool) {
    tools.push(sendMessageTool);
  }

  const teamCreateTool = new TeamCreateTool();
  const teamDeleteTool = new TeamDeleteTool();
  if (teamCreateTool) {
    tools.push(teamCreateTool);
  }
  if (teamDeleteTool) {
    tools.push(teamDeleteTool);
  }

  const enterWorktreeTool = new EnterWorktreeTool();
  const exitWorktreeTool = new ExitWorktreeTool();
  if (enterWorktreeTool) {
    tools.push(enterWorktreeTool);
  }
  if (exitWorktreeTool) {
    tools.push(exitWorktreeTool);
  }

  const listPeersTool = new ListPeersTool();
  if (listPeersTool) {
    tools.push(listPeersTool);
  }

  if (isFeatureEnabled('VERIFICATION_AGENT')) {
    const verifyPlanTool = createVerifyPlanExecutionTool();
    if (verifyPlanTool) {
      tools.push(verifyPlanTool);
    }
  }

  if (isAntUser() && isFeatureEnabled('REPL')) {
    const replTool = new REPLToolAdapter();
    if (replTool) {
      tools.push(replTool);
    }
  }

  if (isFeatureEnabled('PROACTIVE') || isFeatureEnabled('KAIROS')) {
    const sleepTool = createSleepTool();
    if (sleepTool) {
      tools.push(sleepTool);
    }
  }

  const remoteTriggerTool = createRemoteTriggerTool();
  if (remoteTriggerTool) {
    tools.push(remoteTriggerTool);
  }

  const monitorTool = createMonitorTool();
  if (monitorTool) {
    tools.push(monitorTool);
  }

  const traceRecordingTool = createTraceRecordingTool();
  if (traceRecordingTool) {
    tools.push(traceRecordingTool);
  }

  tools.push(new BriefTool());
  tools.push(new SaveConversationTool());

  const sendUserFileTool = createSendUserFileTool();
  if (sendUserFileTool) {
    tools.push(sendUserFileTool);
  }

  const pushNotificationTool = createPushNotificationTool();
  if (pushNotificationTool) {
    tools.push(pushNotificationTool);
  }

  const subscribePRTool = createSubscribePRTool();
  if (subscribePRTool) {
    tools.push(subscribePRTool);
  }

  const powerShellTool = new PowerShellTool();
  if (powerShellTool) {
    tools.push(powerShellTool);
  }

  const snipTool = createSnipTool();
  if (snipTool) {
    tools.push(snipTool);
  }

  if (isFeatureEnabled('TEST_MODE')) {
    tools.push(createTestingPermissionTool());
  }

  tools.push(ListMcpResourcesTool);
  tools.push(ReadMcpResourceTool);

  const toolSearchTool = createToolSearchTool();
  if (toolSearchTool) {
    tools.push(toolSearchTool);
  }

  tools.push(new MCPResourceTool());
  tools.push(MCPTool);
  tools.push(new NotebookToolAdapter());
  tools.push(new BrowserTool());

  tools.push(new CanvasTool());

  // === Phase 1: 注册已存在但未注册的工具类 ===
  tools.push(new FileConvertTool());

  const sessionsTool = new SessionsTool();
  if (sessionsTool) {
    tools.push(sessionsTool);
  }

  const clipboardTool = new ClipboardTool();
  if (clipboardTool) {
    tools.push(clipboardTool);
  }

  const imageTool = new ImageTool();
  if (imageTool) {
    tools.push(imageTool);
  }

  const imageAnalysisTool = new ImageAnalysisTool();
  if (imageAnalysisTool) {
    tools.push(imageAnalysisTool);
  }

  const videoTool = new VideoTool();
  if (videoTool) {
    tools.push(videoTool);
  }

  const musicTool = new MusicTool();
  if (musicTool) {
    tools.push(musicTool);
  }

  const nodesTool = new NodesTool();
  if (nodesTool) {
    tools.push(nodesTool);
  }

  const codeAnalysisTool = new CodeAnalysisTool();
  if (codeAnalysisTool) {
    tools.push(codeAnalysisTool);
  }

  const voiceInputTool = new VoiceInputTool();
  if (voiceInputTool) {
    tools.push(voiceInputTool);
  }

  const voiceOutputTool = new VoiceOutputTool();
  if (voiceOutputTool) {
    tools.push(voiceOutputTool);
  }

  const ttsTool = new TTSTool();
  if (ttsTool) {
    tools.push(ttsTool);
  }

  const thinkingTool = new ThinkingTool();
  if (thinkingTool) {
    tools.push(thinkingTool);
  }

  const pdfTool = new PDFTool();
  if (pdfTool) {
    tools.push(pdfTool);
  }

  const kanbanTool = new KanbanTool();
  if (kanbanTool) {
    tools.push(kanbanTool);
  }

  const sessionsSendTool = new SessionsSendTool();
  if (sessionsSendTool) {
    tools.push(sessionsSendTool);
  }

  const sessionsSpawnTool = new SessionsSpawnTool();
  if (sessionsSpawnTool) {
    tools.push(sessionsSpawnTool);
  }

  const sessionStatusTool = new SessionStatusTool();
  if (sessionStatusTool) {
    tools.push(sessionStatusTool);
  }

  const sessionsYieldTool = new SessionsYieldTool();
  if (sessionsYieldTool) {
    tools.push(sessionsYieldTool);
  }

  const sessionsHistoryTool = new SessionsHistoryTool();
  if (sessionsHistoryTool) {
    tools.push(sessionsHistoryTool);
  }

  const channelTool = new ChannelTool();
  if (channelTool) {
    tools.push(channelTool);
  }

  const imageGenerateTool = new ImageGenerateTool();
  if (imageGenerateTool) {
    tools.push(imageGenerateTool);
  }

  const videoAnalysisTool = new VideoAnalysisTool();
  if (videoAnalysisTool) {
    tools.push(videoAnalysisTool);
  }

  const browserVisionTool = new BrowserVisionTool();
  if (browserVisionTool) {
    tools.push(browserVisionTool);
  }

  const imageSvgTool = new ImageSvgTool();
  if (imageSvgTool) {
    tools.push(imageSvgTool);
  }

  const imageDisplayTool = new ImageDisplayTool();
  if (imageDisplayTool) {
    tools.push(imageDisplayTool);
  }

  const videoDisplayTool = new VideoDisplayTool();
  if (videoDisplayTool) {
    tools.push(videoDisplayTool);
  }

  const audioPlayTool = new AudioPlayTool();
  if (audioPlayTool) {
    tools.push(audioPlayTool);
  }

  const musicGenerateTool = new MusicGenerateTool();
  if (musicGenerateTool) {
    tools.push(musicGenerateTool);
  }

  const videoGenerateTool = new VideoGenerateTool();
  if (videoGenerateTool) {
    tools.push(videoGenerateTool);
  }

  const mcpAuthTool = new McpAuthTool();
  if (mcpAuthTool) {
    tools.push(mcpAuthTool);
  }

  const agentsListTool = new AgentsListTool();
  if (agentsListTool) {
    tools.push(agentsListTool);
  }

  const updatePlanTool = new UpdatePlanTool();
  if (updatePlanTool) {
    tools.push(updatePlanTool);
  }

  const taskOutputTool = new TaskOutputTool();
  if (taskOutputTool) {
    tools.push(taskOutputTool);
  }

  const timeTool = TimeTool.create();
  if (timeTool) {
    tools.push(timeTool);
  }

  /**
   * Phase 3.5 双通道说明：
   * memory.md 内容已通过系统提示词注入（见 MessageContextPipeline），模型无需主动调用
   * recall_memory 即可获取会话记忆。当前 recall_memory 工具查询 SQLite 全局记忆，
   * 作为补充通道保留。Phase 4 统一双记忆系统后恢复双向查询。
   */
  const recallMemoryTool = RecallMemoryTool.create();
  if (recallMemoryTool) {
    tools.push(recallMemoryTool);
  }

  // === Phase 4: Expansion tools (5.2 工具数量追平首批) ===
  tools.push(createDecisionLoggerTool());
  tools.push(createConfidenceScorerTool());
  tools.push(createPerformanceProfilerTool());
  tools.push(createMemoryDumpTool());
  tools.push(createSystemInfoTool());
  tools.push(createProcessManagerTool());
  tools.push(createGitBranchTool());
  tools.push(createGitMergeTool());
  tools.push(createGitStashTool());
  tools.push(createCodeFormatTool());

  // === Phase 4b: 协作工具 ===
  const reviewAssignTool = createReviewAssignTool();
  if (reviewAssignTool) {
    tools.push(reviewAssignTool);
  }
  const codeReviewTool = createCodeReviewTool();
  if (codeReviewTool) {
    tools.push(codeReviewTool);
  }

  // === Phase 4c: 网关/通道工具（统一由 ChannelTool 覆盖） ===
  // 已在 Phase 3 中通过 channelTool 实例注册，此处不再重复创建 ChannelManagerTool
  const broadcastTool = createBroadcastTool();
  if (broadcastTool) {
    tools.push(broadcastTool);
  }

  // === Phase 2: 效用工具集 (编码/哈希/文本/数学/日期/系统/安全/网络等) ===
  const utilityTools = createUtilityTools();
  for (const utilTool of utilityTools) {
    tools.push(utilTool);
  }

  return tools.filter(
    (tool): tool is Tool => tool !== null && tool !== undefined
  );
}

function createSendMessageTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SEND_MESSAGE')) return null;
  const factory = new ToolFactory();
  return factory.createSendMessageTool();
}

function createTeamCreateTool(): Tool | null {
  if (!isToolEnabled('ENABLE_TEAM_CREATE')) return null;
  const factory = new ToolFactory();
  return factory.createTeamCreateTool();
}

function createTeamDeleteTool(): Tool | null {
  if (!isToolEnabled('ENABLE_TEAM_DELETE')) return null;
  const factory = new ToolFactory();
  return factory.createTeamDeleteTool();
}

function createVerifyPlanExecutionTool(): Tool | null {
  if (!isToolEnabled('VERIFICATION_AGENT')) return null;
  return null;
}

function createSleepTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SLEEP')) return null;
  const factory = new ToolFactory();
  return factory.createSleepTool();
}

function createRemoteTriggerTool(): Tool | null {
  if (!isToolEnabled('ENABLE_REMOTE_TRIGGER')) return null;
  const factory = new ToolFactory();
  return factory.createRemoteTriggerTool();
}

function createMonitorTool(): Tool | null {
  if (!isToolEnabled('ENABLE_MONITOR')) return null;
  const factory = new ToolFactory();
  return factory.createMonitorTool();
}

function createTraceRecordingTool(): Tool | null {
  const factory = new ToolFactory();
  return factory.createTraceRecordingTool();
}

function createSendUserFileTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SEND_USER_FILE')) return null;
  const factory = new ToolFactory();
  return factory.createSendUserFileTool();
}

function createPushNotificationTool(): Tool | null {
  if (!isToolEnabled('ENABLE_PUSH_NOTIFICATION')) return null;
  const factory = new ToolFactory();
  return factory.createPushNotificationTool();
}

function createSubscribePRTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SUBSCRIBE_PR')) return null;
  const factory = new ToolFactory();
  return factory.createSubscribePRTool();
}

function createSnipTool(): Tool | null {
  if (!isToolEnabled('ENABLE_SNIP')) return null;
  const factory = new ToolFactory();
  return factory.createSnipTool();
}

function createToolSearchTool(): Tool | null {
  if (!isToolEnabled('ENABLE_TOOL_SEARCH')) return null;
  const factory = new ToolFactory();
  return factory.createToolSearchTool();
}

function createTestingPermissionTool(): Tool {
  const tool = {
    name: 'testing_permission',
    description: 'Testing permission tool',
    execute: async () => ({
      success: true,
      output: 'Testing permission granted',
    }),
    isEnabled: () => true,
  };
  return tool as unknown as Tool;
}

/**
 * 工具权限上下文类型
 */
export interface ToolPermissionContextInput {
  mode?: 'default' | 'auto' | 'strict' | 'bypass';
  alwaysAllowRules?: Record<string, string[]>;
  alwaysDenyRules?: Record<string, string[]>;
  alwaysAskRules?: Record<string, string[]>;
}

/**
 * 过滤被拒绝规则阻止的工具
 * 参考CC源码的filterToolsByDenyRules实现
 * @param tools 工具列表
 * @param permissionContext 权限上下文
 * @returns 过滤后的工具列表
 */
export function filterToolsByDenyRules<
  T extends {
    name: string;
    mcpInfo?: { serverName: string; toolName: string };
  },
>(tools: readonly T[], permissionContext: ToolPermissionContextInput): T[] {
  const denyRules = getCompiledDenyRules(permissionContext);
  return tools.filter((tool) => !matchesDenyRule(tool, denyRules));
}

/**
 * 编译拒绝规则
 */
function getCompiledDenyRules(context: ToolPermissionContextInput): Array<{
  toolName: string;
  serverName?: string;
  isWildcard?: boolean;
}> {
  const rules: Array<{
    toolName: string;
    serverName?: string;
    isWildcard?: boolean;
  }> = [];

  const denyRulesBySource = context.alwaysDenyRules || {};
  for (const source of Object.keys(denyRulesBySource)) {
    const ruleStrings = denyRulesBySource[source] || [];
    for (const ruleString of ruleStrings) {
      const parsed = parseToolRule(ruleString);
      if (parsed) {
        rules.push(parsed);
      }
    }
  }

  return rules;
}

/**
 * 解析工具规则字符串
 * 支持格式：
 * - "ToolName" - 直接匹配工具名
 * - "mcp__server__tool" - MCP工具的完全限定名
 * - "mcp__server__*" - MCP服务器下的所有工具
 */
function parseToolRule(ruleString: string): {
  toolName: string;
  serverName?: string;
  isWildcard?: boolean;
} | null {
  if (!ruleString || typeof ruleString !== 'string') {
    return null;
  }

  if (ruleString.startsWith('mcp__')) {
    const parts = ruleString.split('__');
    if (parts.length >= 2) {
      const serverName = parts[1];
      const toolName = parts[2];
      return {
        toolName: toolName || ruleString,
        serverName,
        isWildcard: toolName === '*' || toolName === undefined,
      };
    }
  }

  return { toolName: ruleString };
}

/**
 * 检查工具是否匹配拒绝规则
 */
function matchesDenyRule<
  T extends {
    name: string;
    mcpInfo?: { serverName: string; toolName: string };
  },
>(
  tool: T,
  denyRules: Array<{
    toolName: string;
    serverName?: string;
    isWildcard?: boolean;
  }>
): boolean {
  const toolName = tool.name;

  for (const rule of denyRules) {
    if (rule.serverName) {
      if (tool.mcpInfo) {
        if (rule.isWildcard) {
          if (tool.mcpInfo.serverName === rule.serverName) {
            return true;
          }
        } else if (
          tool.mcpInfo.serverName === rule.serverName &&
          (tool.mcpInfo.toolName === rule.toolName ||
            toolName === rule.toolName)
        ) {
          return true;
        }
      }
      if (
        toolName.startsWith(`mcp__${rule.serverName}__`) &&
        (rule.isWildcard ||
          toolName === `mcp__${rule.serverName}__${rule.toolName}`)
      ) {
        return true;
      }
    } else if (toolName === rule.toolName) {
      return true;
    }
  }

  return false;
}

/**
 * 获取给定权限上下文下的所有可用工具
 * 这是工具系统的主要入口点，整合了条件加载和权限过滤
 * @param permissionContext 权限上下文
 * @returns 可用的工具列表
 */
export function getTools(
  permissionContext: ToolPermissionContextInput
): Tool[] {
  const allTools = getAllBaseTools();

  const simpleModeActive = isSimpleMode();
  if (simpleModeActive) {
    const simpleTools = allTools.filter((tool) => {
      const name = tool.name;
      return name === 'Bash' || name === 'Read' || name === 'Edit';
    });
    return filterToolsByDenyRules(simpleTools, permissionContext);
  }

  const filteredTools = filterToolsByDenyRules(allTools, permissionContext);

  return filteredTools.filter((tool) => {
    if (typeof tool.isEnabled === 'function') {
      return tool.isEnabled();
    }
    return true;
  });
}

/**
 * 组装完整的工具池，整合内置工具和MCP工具
 * 参考CC源码的assembleToolPool实现
 * @param permissionContext 权限上下文
 * @param mcpTools MCP工具列表
 * @returns 组合后的工具列表
 */
export function assembleToolPool(
  permissionContext: ToolPermissionContextInput,
  mcpTools: Tool[]
): Tool[] {
  const builtInTools = getTools(permissionContext);

  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext);

  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name);
  const uniqueTools = uniqByTools(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName))
  );

  return uniqueTools;
}

/**
 * 按名称去重工具列表，保留首次出现的工具
 */
function uniqByTools(tools: Tool[]): Tool[] {
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) {
      return false;
    }
    seen.add(tool.name);
    return true;
  });
}
