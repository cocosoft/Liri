/**
 * Fork Subagent 实现
 *
 * 当不指定 subagent_type 时触发隐式 fork：
 * 子代理继承父代理的完整对话上下文和系统提示词。
 */

import { randomUUID } from 'crypto';
import type { ChatMessage } from '@modules/ai/models/types';
import { getSubAgentEngine } from './SubAgentEngine';
import { configManager } from '@modules/config';
import type {
  SubAgentEngine,
  SubAgentProgressEvent,
  SubAgentResult,
} from './SubAgentEngine';

export const FORK_SUBAGENT_TYPE = 'fork';
export const FORK_DIRECTIVE_PREFIX = 'FORK:';
export const FORK_BOILERPLATE_TAG = '[fork-subagent]';
export const FORK_PLACEHOLDER_RESULT =
  'Fork started - processing in background';

export interface ForkSubagentOptions {
  /** 父代理的系统提示词字节 */
  renderedSystemPrompt: string;
  /** 父代理的对话消息列表 */
  parentMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  /** fork 指令 */
  directive?: string;
  /** 最大轮次（默认 200） */
  maxTurns?: number;
  /** 可用工具定义 */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface ForkSubagentResult {
  taskId: string;
  completed: boolean;
  result?: string;
  error?: string;
  turnsUsed?: number;
  durationMs?: number;
}

export function isForkSubagentEnabled(): boolean {
  const disabled = configManager.env('DISABLE_FORK_SUBAGENT') === 'true';
  return !disabled;
}

export function isInForkChild(
  messages: Array<{ role: string; content: string }>
): boolean {
  return messages.some(
    (m) => m.role === 'user' && m.content.includes(FORK_BOILERPLATE_TAG)
  );
}

export function buildForkSystemPrompt(
  parentSystemPrompt: string,
  options: ForkSubagentOptions
): string {
  const prompt = [parentSystemPrompt];

  if (options.directive) {
    prompt.push('');
    prompt.push(FORK_DIRECTIVE_PREFIX + ' ' + options.directive);
  }

  prompt.push('');
  prompt.push(
    '[You are a forked sub-agent operating in the same session context as the parent agent.]'
  );

  return prompt.join('\n');
}

export function buildForkContextMessages(
  parentMessages: ForkSubagentOptions['parentMessages']
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const contextMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }> = [];

  const recent = parentMessages.slice(-30);

  for (const msg of recent) {
    contextMessages.push(msg);
  }

  contextMessages.push({
    role: 'user',
    content: `${FORK_BOILERPLATE_TAG} This is a forked sub-agent session. Continue the task autonomously.`,
  });

  return contextMessages;
}

/**
 * 构建子代理工作指令消息
 *
 * 对标 CC buildChildMessage() 实现严格的 worker 指令约束：
 * - 禁止递归 fork
 * - 要求静默执行工具，最后一次性汇报
 * - 限制在指令范围内执行
 * - 特定输出格式
 */
export function buildChildMessage(directive: string): string {
  return `<${FORK_BOILERPLATE_TAG}>
STOP. READ THIS FIRST.

You are a forked worker process. You are NOT the main agent.

RULES (non-negotiable):
1. Do NOT spawn sub-agents; execute directly.
2. Do NOT converse, ask questions, or suggest next steps.
3. Do NOT editorialize or add meta-commentary.
4. USE your tools directly: Bash, Read, Write, etc.
5. Do NOT emit text between tool calls. Use tools silently, then report once at the end.
6. Stay strictly within your directive's scope.
7. Keep your report under 500 words unless the directive specifies otherwise.
8. Your response MUST begin with "Scope:". No preamble, no thinking-out-loud.
9. REPORT structured facts, then stop.

Output format (plain text labels, not markdown headers):
  Scope: <echo back your assigned scope in one sentence>
  Result: <the answer or key findings>
  Key files: <relevant file paths>
  Issues: <list - include only if there are issues to flag>
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`;
}

/**
 * 构建工作目录隔离通知
 *
 * 告知 fork 子代理继承的上下文路径需要进行转换，
 * 同时告知其更改被隔离在工作树中。
 */
export function buildWorktreeNotice(
  parentCwd: string,
  worktreeCwd: string
): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreeCwd}. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them. Your changes stay in this worktree.`;
}

/**
 * 执行 fork 子代理任务
 *
 * 创建子代理在后台运行，继承父代理上下文。
 * 使用 SubAgentEngine 的完整查询循环执行多轮交互。
 *
 * @param directive fork 指令
 * @param engine 子代理引擎
 * @param options fork 选项
 * @param onProgress 进度回调
 * @returns fork 执行结果
 */
export async function executeForkSubagent(
  directive: string,
  engine: SubAgentEngine,
  options: ForkSubagentOptions,
  onProgress?: (event: SubAgentProgressEvent) => void
): Promise<ForkSubagentResult> {
  const taskId = `fork-${randomUUID().replace(/-/g, '').substring(0, 8)}`;
  const startTime = Date.now();

  try {
    const systemPrompt = buildForkSystemPrompt(options.renderedSystemPrompt, {
      ...options,
      directive,
    });

    const contextMessages = buildForkContextMessages(options.parentMessages);

    const childDirective = buildChildMessage(directive);

    const messages: ChatMessage[] = contextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    messages.push({
      role: 'user',
      content: childDirective,
    });

    const toolDefinitions = (options.tools || []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const result: SubAgentResult = await engine.execute(
      {
        agentId: taskId,
        systemPrompt,
        messages,
        tools: toolDefinitions,
        toolInstances: new Map(),
        maxTurns: options.maxTurns || 50,
      },
      onProgress
    );

    return {
      taskId,
      completed: result.completed,
      result: result.output,
      turnsUsed: result.turnsUsed,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      taskId,
      completed: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

export function formatForkAgentDefinition(): {
  agentType: string;
  whenToUse: string;
  maxTurns: number;
  model: string;
  permissionMode: string;
} {
  return {
    agentType: FORK_SUBAGENT_TYPE,
    whenToUse:
      'Implicit fork — inherits full conversation context. Not selectable via subagent_type; triggered by omitting subagent_type when fork is enabled.',
    maxTurns: 200,
    model: 'inherit',
    permissionMode: 'bubble',
  };
}
