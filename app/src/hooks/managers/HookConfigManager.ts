//
/**
 * Hook配置管理
 * 负责Hook配置的加载、解析和验证
 */

import {
  IndividualHookConfig,
  HookEvent,
  HookEventMetadata,
  MatcherMetadata,
} from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'hooks\managers\HookConfigManager',
  level: LogLevel.INFO,
});

/**
 * Hook配置管理器
 */
export class HookConfigManager {
  private static instance: HookConfigManager;
  private hooks: IndividualHookConfig[] = [];

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): HookConfigManager {
    if (!HookConfigManager.instance) {
      HookConfigManager.instance = new HookConfigManager();
    }
    return HookConfigManager.instance;
  }

  /**
   * 加载Hook配置
   * @param config 配置对象
   */
  public loadConfig(config: unknown): void {
    if (config && Array.isArray((config as Record<string, unknown>).hooks)) {
      this.hooks = ((config as Record<string, unknown>).hooks as unknown[]).map(
        (hook: unknown) => this.validateHookConfig(hook)
      );
    }
  }

  /**
   * 验证Hook配置
   * @param hook Hook配置对象
   * @returns 验证后的Hook配置
   */
  private validateHookConfig(hook: unknown): IndividualHookConfig {
    const h = hook as Record<string, unknown>;
    // 验证事件类型
    if (!h.event) {
      throw new AppError(
        'Hook must have an event',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 验证配置
    if (!h.config) {
      throw new AppError(
        'Hook must have a config',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const hc = h.config as Record<string, unknown>;
    // 验证配置类型
    if (!['command', 'prompt', 'http', 'agent'].includes(hc.type as string)) {
      throw new AppError(
        'Hook config type must be one of: command, prompt, http, agent',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 验证命令类型Hook
    if (hc.type === 'command' && !hc.command) {
      throw new AppError(
        'Command type hook must have a command',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 验证HTTP类型Hook
    if (
      hc.type === 'http' &&
      (!hc.http || !(hc.http as Record<string, unknown>).url)
    ) {
      throw new AppError(
        'HTTP type hook must have a url',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 验证代理类型Hook
    if (
      hc.type === 'agent' &&
      (!hc.agent || !(hc.agent as Record<string, unknown>).id)
    ) {
      throw new AppError(
        'Agent type hook must have an agent id',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return {
      id: (h.name as string) || `${h.event}:${h.matcher || 'default'}`,
      name: (h.name as string) || `${h.event} hook`,
      enabled: hc.enabled !== false,
      priority: ((hc.priority as number) ||
        0) as unknown as IndividualHookConfig['priority'],
      event: h.event as IndividualHookConfig['event'],
      matcher: h.matcher as IndividualHookConfig['matcher'],
      config: {
        type: hc.type as IndividualHookConfig['config']['type'],
        command: hc.command as string | undefined,
        prompt: hc.prompt as string | undefined,
        http: hc.http as IndividualHookConfig['config']['http'],
        agent: hc.agent as IndividualHookConfig['config']['agent'],
        timeout: (hc.timeout as number) || 30000,
        enabled: hc.enabled !== false,
        priority: ((hc.priority as number) ||
          0) as unknown as IndividualHookConfig['config']['priority'],
      },
      source: (h.source as string) || 'user',
      pluginName: h.pluginName as string | undefined,
    };
  }

  /**
   * 获取所有Hook配置
   * @returns Hook配置列表
   */
  public getAllHooks(): IndividualHookConfig[] {
    return this.hooks.filter((hook) => hook.config.enabled);
  }

  /**
   * 根据事件类型获取Hook配置
   * @param event 事件类型
   * @returns Hook配置列表
   */
  public getHooksByEvent(event: HookEvent): IndividualHookConfig[] {
    return this.hooks.filter(
      (hook) => hook.event === event && hook.config.enabled
    );
  }

  /**
   * 根据事件类型和匹配器获取Hook配置
   * @param event 事件类型
   * @param matcher 匹配器值
   * @returns Hook配置列表
   */
  public getHooksByEventAndMatcher(
    event: HookEvent,
    matcher?: string
  ): IndividualHookConfig[] {
    return this.hooks.filter(
      (hook) =>
        hook.event === event &&
        (matcher === undefined ||
          (hook.matcher as unknown as string) === matcher) &&
        hook.config.enabled
    );
  }

  /**
   * 获取Hook事件元数据
   * @param toolNames 工具名称列表
   * @returns Hook事件元数据
   */
  public getHookEventMetadata(
    toolNames: string[]
  ): Record<HookEvent, HookEventMetadata> {
    return {
      PreToolUse: {
        summary: 'Before tool execution',
        description:
          'Input to command is JSON of tool call arguments.\nExit code 0 - stdout/stderr not shown\nExit code 2 - show stderr to model and block tool call\nOther exit codes - show stderr to user only but continue with tool call',
        matcherMetadata: {
          fieldToMatch: 'tool_name',
          values: toolNames,
        },
      },
      PostToolUse: {
        summary: 'After tool execution',
        description:
          'Input to command is JSON with fields "inputs" (tool call arguments) and "response" (tool call response).\nExit code 0 - stdout shown in transcript mode (ctrl+o)\nExit code 2 - show stderr to model immediately\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'tool_name',
          values: toolNames,
        },
      },
      PostToolUseFailure: {
        summary: 'After tool execution fails',
        description:
          'Input to command is JSON with tool_name, tool_input, tool_use_id, error, error_type, is_interrupt, and is_timeout.\nExit code 0 - stdout shown in transcript mode (ctrl+o)\nExit code 2 - show stderr to model immediately\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'tool_name',
          values: toolNames,
        },
      },
      PermissionDenied: {
        summary: 'After auto mode classifier denies a tool call',
        description:
          'Input to command is JSON with tool_name, tool_input, tool_use_id, and reason.\nReturn {"hookSpecificOutput":{"hookEventName":"PermissionDenied","retry":true}} to tell the model it may retry.\nExit code 0 - stdout shown in transcript mode (ctrl+o)\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'tool_name',
          values: toolNames,
        },
      },
      Notification: {
        summary: 'When notifications are sent',
        description:
          'Input to command is JSON with notification message and type.\nExit code 0 - stdout/stderr not shown\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'notification_type',
          values: [
            'permission_prompt',
            'idle_prompt',
            'auth_success',
            'elicitation_dialog',
            'elicitation_complete',
            'elicitation_response',
          ],
        },
      },
      UserPromptSubmit: {
        summary: 'When the user submits a prompt',
        description:
          'Input to command is JSON with original user prompt text.\nExit code 0 - stdout shown to Liri\nExit code 2 - block processing, erase original prompt, and show stderr to user only\nOther exit codes - show stderr to user only',
      },
      SessionStart: {
        summary: 'When a new session is started',
        description:
          'Input to command is JSON with session start source.\nExit code 0 - stdout shown to Liri\nBlocking errors are ignored\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'source',
          values: ['startup', 'resume', 'clear', 'compact'],
        },
      },
      SessionEnd: {
        summary: 'When a session is ending',
        description:
          'Input to command is JSON with session end reason.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'reason',
          values: ['clear', 'logout', 'prompt_input_exit', 'other'],
        },
      },
      Stop: {
        summary: 'Right before Liri concludes its response',
        description:
          'Exit code 0 - stdout/stderr not shown\nExit code 2 - show stderr to model and continue conversation\nOther exit codes - show stderr to user only',
      },
      StopFailure: {
        summary: 'When the turn ends due to an API error',
        description:
          'Fires instead of Stop when an API error (rate limit, auth failure, etc.) ended the turn. Fire-and-forget — hook output and exit codes are ignored.',
        matcherMetadata: {
          fieldToMatch: 'error',
          values: [
            'rate_limit',
            'authentication_failed',
            'billing_error',
            'invalid_request',
            'server_error',
            'max_output_tokens',
            'unknown',
          ],
        },
      },
      CwdChanged: {
        summary: 'After the working directory changes',
        description:
          'Input to command is JSON with old_cwd and new_cwd.\nTEMP_ENV_FILE is set — write bash exports there to apply env to subsequent BashTool commands.\nHook output can include hookSpecificOutput.watchPaths (array of absolute paths) to register with the FileChanged watcher.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
      FileChanged: {
        summary: 'When a watched file changes',
        description:
          'Input to command is JSON with file_path and event (change, add, unlink).\nTEMP_ENV_FILE is set — write bash exports there to apply env to subsequent BashTool commands.\nThe matcher field specifies filenames to watch in the current directory (e.g. ".envrc|.env").\nHook output can include hookSpecificOutput.watchPaths (array of absolute paths) to dynamically update the watch list.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'matcher',
          values: [],
        },
      },
      SubagentStart: {
        summary: 'When a subagent starts',
        description:
          'Input to command is JSON with subagent information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'subagent_type',
          values: [],
        },
      },
      SubagentStop: {
        summary: 'When a subagent stops',
        description:
          'Input to command is JSON with subagent information and exit reason.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'exit_reason',
          values: [],
        },
      },
      PreCompact: {
        summary: 'Before session compaction',
        description:
          'Input to command is JSON with session compaction information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
      PostCompact: {
        summary: 'After session compaction',
        description:
          'Input to command is JSON with session compaction results.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
      PermissionRequest: {
        summary: 'When a permission request is made',
        description:
          'Input to command is JSON with permission request details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'permission_type',
          values: [],
        },
      },
      Setup: {
        summary: 'During application setup',
        description:
          'Input to command is JSON with setup information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
      TeammateIdle: {
        summary: 'When a teammate becomes idle',
        description:
          'Input to command is JSON with teammate information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'teammate_id',
          values: [],
        },
      },
      TaskCreated: {
        summary: 'When a task is created',
        description:
          'Input to command is JSON with task information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'task_type',
          values: [],
        },
      },
      TaskCompleted: {
        summary: 'When a task is completed',
        description:
          'Input to command is JSON with task completion information.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'completion_status',
          values: [],
        },
      },
      Elicitation: {
        summary: 'When an elicitation is triggered',
        description:
          'Input to command is JSON with elicitation details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'elicitation_type',
          values: [],
        },
      },
      ElicitationResult: {
        summary: 'When an elicitation result is received',
        description:
          'Input to command is JSON with elicitation result.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
      ConfigChange: {
        summary: 'When configuration changes',
        description:
          'Input to command is JSON with configuration change details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'config_key',
          values: [],
        },
      },
      WorktreeCreate: {
        summary: 'When a worktree is created',
        description:
          'Input to command is JSON with worktree creation details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'worktree_path',
          values: [],
        },
      },
      WorktreeRemove: {
        summary: 'When a worktree is removed',
        description:
          'Input to command is JSON with worktree removal details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
        matcherMetadata: {
          fieldToMatch: 'worktree_path',
          values: [],
        },
      },
      InstructionsLoaded: {
        summary: 'When instructions are loaded',
        description:
          'Input to command is JSON with loaded instructions details.\nExit code 0 - command completes successfully\nOther exit codes - show stderr to user only',
      },
    };
  }

  /**
   * 获取匹配器元数据
   * @param event 事件类型
   * @param toolNames 工具名称列表
   * @returns 匹配器元数据
   */
  public getMatcherMetadata(
    event: HookEvent,
    toolNames: string[]
  ): MatcherMetadata | undefined {
    return this.getHookEventMetadata(toolNames)[event].matcherMetadata;
  }
}
