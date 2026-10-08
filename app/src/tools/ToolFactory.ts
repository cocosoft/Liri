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
// 2026-09-29（台账 D-32）：删除 `FileSearchTool` 导入 —— 该类**从未被任何 loader 注册**（零消费者，
// 已被 `glob`/`grep` 取代）⇒ 属"类里声明但不在注册面"的死代码（N-27 同族），随死类集群一并清理。
import { CronCreateTool } from './ChronosTool/CronCreateTool';
import { CronDeleteTool } from './ChronosTool/CronDeleteTool';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { CronListTool } from './ChronosTool/CronListTool';
import { CronStopTool } from './ChronosTool/CronStopTool';

const logger = getLogger('tools:factory');
import { PowerShellTool } from './PowerShellTool/PowerShellTool';
import { WebFetchTool } from './WebFetchTool/WebFetchTool';
import { WebSearchTool } from './WebSearchTool/WebSearchTool';
import { AgentTool } from './AgentTool/AgentTool';
import { SkillTool } from './SkillTool/SkillTool';
import { SkillListTool } from './SkillTool/SkillListTool';
import { SkillViewTool } from './SkillTool/SkillViewTool';
import { KnowledgeSaveTool } from './KnowledgeSaveTool/KnowledgeSaveTool';
import { TaskStopTool } from './TaskTool/TaskStopTool';
import {
  TaskCreateListTool,
  TaskUpdateStatusTool,
  TaskGetListTool,
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
import { DocGenerateTool } from './DocGenerateTool/DocGenerateTool';
import { createComputerUseTool } from './ComputerUseTool/ComputerUseTool';
import { ImageTool } from './ImageTool/ImageTool';
import { ImageAnalysisTool } from './ImageAnalysisTool/ImageAnalysisTool';
import { VideoTool } from './VideoTool/VideoTool';
import { MusicTool } from './MusicTool/MusicTool';
import { CanvasTool } from './CanvasTool/CanvasTool';
import { MCPTool } from '../mcp/MCPTool';
import { isToolEnabled } from './utils/ToolFeatureFlags';
import { SleepTool } from './SleepTool/SleepTool.js';
import { CodeRunnerTool } from './CodeRunner/CodeRunnerTool.js';
import { MonitorTool } from './MonitorTool/MonitorTool.js';
import { SessionsYieldTool } from './SessionsYieldTool/SessionsYieldTool';
// N-37（2026-09-20）：自唤醒工具（sleep_for / sleep_until）—— 此前仅有 JSON schema
// 与执行器、无 BaseTool 包装与注册点 ⇒ 对模型不可达；见 SelfWakeTool.ts 头部说明。
import {
  createSleepForTool,
  createSleepUntilTool,
} from './SelfWakeTool/SelfWakeTool';
import { ChannelTool } from './ChannelTool/ChannelTool';
import { ImageGenerateTool } from './ImageGenerateTool/ImageGenerateTool';
import { ImageSvgTool } from './ImageSvgTool/ImageSvgTool';
import { ImageDisplayTool } from './ImageDisplayTool/ImageDisplayTool';
import { VideoDisplayTool } from './VideoDisplayTool/VideoDisplayTool';
import { AudioPlayTool } from './AudioPlayTool/AudioPlayTool';
import { VideoAnalysisTool } from './VideoAnalysisTool/VideoAnalysisTool';
import { BrowserVisionTool } from './BrowserVisionTool/BrowserVisionTool';
import { VideoGenerateTool } from './VideoGenerateTool/VideoGenerateTool';
import { BroadcastTool } from './BroadcastTool/BroadcastTool';
import { CreateProjectTool } from './CreateProjectTool/CreateProjectTool';
import { ReadProjectFileTool } from './ReadProjectFileTool/ReadProjectFileTool';
import { WriteProjectFileTool } from './WriteProjectFileTool/WriteProjectFileTool';
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
   * 创建Cron暂停/恢复工具
   * @returns Cron暂停/恢复工具实例
   */
  createCronStopTool(): Tool {
    return CronStopTool.create();
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
   * 创建SkillList工具（skills_list，T9' 渐进式披露 tier 1）
   * 2026-08-30：注册进 ToolManager loaders——此前仅存在于 getAllBaseTools()
   * 工具池路径，未进入 ToolRegistry，导致 tool_search 搜不到 → 模型反复搜索死循环
   * @returns SkillListTool实例
   */
  createSkillListTool(): Tool {
    return new SkillListTool();
  }

  /**
   * 创建SkillView工具（skill_view，T9' 渐进式披露 tier 2-3）
   * @returns SkillViewTool实例
   */
  createSkillViewTool(): Tool {
    return new SkillViewTool();
  }

  /**
   * 创建知识库保存工具（knowledge_save，2026-09-01）
   * 封装 KnowledgeBaseWriter（frontmatter/快照/去重/事件联动），模型结构化调用。
   * @returns KnowledgeSaveTool实例
   */
  createKnowledgeSaveTool(): Tool {
    return new KnowledgeSaveTool();
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

  // 2026-09-29（台账 D-34）：删除 `createViewTasksTool` / `createAbortTaskTool` / `createViewPlanTool`
  // 三个工厂方法 —— 对应 `view_tasks` / `abort_task` / `view_plan` 均**未注册**（不在
  // `getBuiltinToolLoaders()` 活清单），已由 `get_task_list` / `task_stop` 取代。

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
   * 创建 CodeRunner 工具（code_run，Code Mode）
   * 由 ToolManagerUtils 条件注册（CODE_MODE 开关），此处工厂方法兜底。
   * @returns CodeRunner工具实例
   */
  createCodeRunnerTool(): Tool | null {
    try {
      return new CodeRunnerTool();
    } catch (error) {
      void handleError(error, {
        module: 'tools:factory',
        action: 'create_code_runner_tool',
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
   * 创建会话让出工具（阶段 A：真实实现）
   *
   * 注（2026-09-20，N-27）：`getBuiltinToolLoaders()` 中的登记才是**真实生效路径**
   * （`ToolManager.loadBuiltinTools()` → toolRegistry → 注入给模型）；
   * `getAllBaseTools()` 内的同类注册属另一条未被 ToolManager 使用的路径。
   */
  createSessionsYieldTool(): Tool {
    return new SessionsYieldTool();
  }

  /**
   * 创建自唤醒工具 `sleep_for`（挂起 N 秒；≤5min setTimeout / 长时 CronScheduler tick）
   *
   * 注（2026-09-20，N-37）：与 `sessions_yield` 同一教训 —— 真正生效的是
   * `getBuiltinToolLoaders()` 里的登记；仅有 schema 定义而无注册点 = 对模型不可达。
   */
  createSleepForTool(): Tool {
    return createSleepForTool();
  }

  /**
   * 创建自唤醒工具 `sleep_until`（挂起到指定 ISO 时间）
   *
   * 注：`wake_on_job` / `wake_on_event` **暂不注册** —— 其条目无 `triggerAt` 且全仓无
   * "任务完成 / 事件到达" 的唤醒生产者，注册即"永不兑现的等待"（CS04），详见
   * `SelfWakeTool.ts` 头部与台账 N-37。
   */
  createSleepUntilTool(): Tool {
    return createSleepUntilTool();
  }

  /**
   * 创建剪贴板工具
   */
  createClipboardTool(): Tool {
    return new ClipboardTool();
  }

  /**
   * 创建文档生成工具（officecli）
   */
  createDocGenerateTool(): Tool {
    return new DocGenerateTool();
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
   * 创建频道管理器工具
   *
   * ⚠️ 2026-09-29（台账 **D-29**）：原另有 `createGatewayTool()` —— 它与本方法
   * **都是 `return new ChannelTool()`** ⇒ 清单里出现**两条同名 `channel` 加载器**。
   * 按用户裁定**保留本方法**、删除 `createGatewayTool()`（去重）。
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

  /**
   * 创建 create_project 工具实例
   */
  createProjectTool(): Tool {
    return CreateProjectTool.create();
  }

  /** 创建 read_project_file 工具实例 */
  createReadProjectFileTool(): Tool {
    return ReadProjectFileTool.create();
  }

  /** 创建 write_project_file 工具实例 */
  createWriteProjectFileTool(): Tool {
    return WriteProjectFileTool.create();
  }
}

// 2026-09-29（台账 D-47）：遗留"工具池组装链"整链已删除 ——
// `assembleToolPool` → `getTools` → `getAllBaseTools` + `filterToolsByDenyRules`（含私有 `getCompiledDenyRules`）
// 零生产消费者（链头 `assembleToolPool` 无导入方），连同模块私有工厂函数群一并移除。
// 现行生效来源 = `tools/utils/ToolManagerUtils.getBuiltinToolLoaders()`。
