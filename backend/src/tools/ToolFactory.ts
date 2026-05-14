/**
 * 工具工厂
 * 负责创建各种工具实例，支持基于功能标志的条件加载
 */
import { Tool } from './types/Tool';
import type { ToolProgressData } from './types/ToolProgress';
import { createToolResult } from './types/ToolResult';
import { BashTool } from './bash/BashTool';
import { FileReadTool } from './FileReadTool/FileReadTool';
import { FileWriteTool } from './FileWriteTool/FileWriteTool';
import { FileEditTool } from './FileEditTool/FileEditTool';
import { FileConvertTool } from './FileConvertTool/FileConvertTool';
import { GrepTool } from './search/GrepTool';
import { GlobTool } from './search/GlobTool';
import { NotebookEditTool } from './NotebookEditTool/NotebookEditTool';
import { CronCreateTool } from './ChronosTool/CronCreateTool';
import { CronDeleteTool } from './ChronosTool/CronDeleteTool';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { CronListTool } from './ChronosTool/CronListTool';

const logger = new Logger({ level: LogLevel.INFO });
import { PowerShellTool } from './PowerShellTool/PowerShellTool';
import { WebFetchTool } from './WebFetchTool/WebFetchTool';
import { WebSearchTool } from './WebSearchTool/WebSearchTool';
import { AgentTool } from './AgentTool/AgentTool';
import { SkillTool } from './SkillTool/SkillTool';
import { TaskCreateTool } from './TaskTool/TaskCreateTool';
import { TaskListTool } from './TaskTool/TaskListTool';
import { TaskGetTool } from './TaskTool/TaskGetTool';
import { TaskUpdateTool } from './TaskTool/TaskUpdateTool';
import { TaskStopTool } from './TaskTool/TaskStopTool';
import { TodoWriteTool } from './TodoWriteTool/TodoWriteTool';
import { TungstenTool } from './TungstenTool/TungstenTool';
import { LSPToolAdapter } from './adapters/LSPToolAdapter';
import { REPLToolAdapter } from './adapters/REPLToolAdapter';
import { NotebookToolAdapter } from './adapters/NotebookToolAdapter';
import { AskUserQuestionTool } from './AskUserQuestionTool/AskUserQuestionTool';
import { ConfigTool } from './ConfigTool/ConfigTool';
import { MCPResourceTool } from './MCPResourceTool/MCPResourceTool';
import { BriefTool } from './BriefTool/BriefTool';
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
import { ImageTool } from './ImageTool/ImageTool';
import { VideoTool } from './VideoTool/VideoTool';
import { MusicTool } from './MusicTool/MusicTool';
import { ListMcpResourcesTool } from './ListMcpResourcesTool/ListMcpResourcesTool.js';
import { ReadMcpResourceTool } from './ReadMcpResourceTool/ReadMcpResourceTool.js';
import { MCPTool } from '../mcp/MCPTool';
import { isAntUser, isSimpleMode } from '../utils/features.js';
import { isToolEnabled } from './utils/ToolFeatureFlags';
import { isFeatureEnabled } from '@modules/core';

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
   * 创建NotebookEdit工具
   * @returns NotebookEdit工具实例
   */
  createNotebookEditTool(): Tool {
    return NotebookEditTool;
  }

  /**
   * 创建TaskCreate工具
   * @returns TaskCreate工具实例
   */
  createTaskCreateTool(): Tool {
    return new TaskCreateTool();
  }

  /**
   * 创建TaskList工具
   * @returns TaskList工具实例
   */
  createTaskListTool(): Tool {
    return new TaskListTool();
  }

  /**
   * 创建TaskGet工具
   * @returns TaskGet工具实例
   */
  createTaskGetTool(): Tool {
    return new TaskGetTool();
  }

  /**
   * 创建TaskUpdate工具
   * @returns TaskUpdate工具实例
   */
  createTaskUpdateTool(): Tool {
    return new TaskUpdateTool();
  }

  /**
   * 创建TaskStop工具
   * @returns TaskStop工具实例
   */
  createTaskStopTool(): Tool {
    return new TaskStopTool();
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
      const { SleepTool } = require('./SleepTool/SleepTool.js');
      return new SleepTool();
    } catch (error) {
      logger.error(
        'Failed to create SleepTool',
        error instanceof Error ? error : new Error(String(error))
      );
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
      const { MonitorTool } = require('./MonitorTool/MonitorTool.js');
      return new MonitorTool();
    } catch (error) {
      logger.error(
        'Failed to create MonitorTool',
        error instanceof Error ? error : new Error(String(error))
      );
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
      logger.error(
        'Failed to create SendMessageTool',
        error instanceof Error ? error : new Error(String(error))
      );
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
      logger.error(
        'Failed to create TeamCreateTool',
        error instanceof Error ? error : new Error(String(error))
      );
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
      logger.error(
        'Failed to create TeamDeleteTool',
        error instanceof Error ? error : new Error(String(error))
      );
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
    return null;
  }

  /**
   * 创建SubscribePR工具
   * @returns SubscribePR工具实例
   */
  createSubscribePRTool(): Tool | null {
    return null;
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
   * 创建通用图片编辑工具
   */
  createImageTool(): Tool {
    return new ImageTool();
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
  tools.push(new BashTool());

  const globTool = new GlobTool();
  const grepTool = new GrepTool();
  if (globTool) {
    tools.push(globTool);
  }
  if (grepTool) {
    tools.push(grepTool);
  }

  tools.push(new FileEditTool());
  tools.push(new FileReadTool());
  tools.push(new FileWriteTool());
  tools.push(NotebookEditTool);
  tools.push(new WebFetchTool());
  tools.push(new TodoWriteTool());
  tools.push(new WebSearchTool());
  tools.push(new TaskStopTool());
  tools.push(new AskUserQuestionTool());
  tools.push(new SkillTool());
  tools.push(
    new PlanTool() as unknown as Tool<unknown, unknown, ToolProgressData>
  );

  if (isAntUser()) {
    tools.push(new ConfigTool());
    tools.push(new TungstenTool());
  }

  if (isFeatureEnabled('ENABLE_WORKFLOWS')) {
    tools.push(new TaskCreateTool());
    tools.push(new TaskGetTool());
    tools.push(new TaskUpdateTool());
    tools.push(new TaskListTool());
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

  tools.push(new BriefTool());

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
