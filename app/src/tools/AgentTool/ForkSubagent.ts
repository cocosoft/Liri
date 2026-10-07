/**
 * Fork Subagent 实现
 *
 * 当不指定 subagent_type 时触发隐式 fork：
 * 子代理继承父代理的完整对话上下文和系统提示词。
 */

import { randomUUID } from 'crypto';
import type { ChatMessage } from '@modules/ai';
import { getSubAgentEngine } from './SubAgentEngine';
import { configManager } from '@modules/config';
import type { ToolUseContext } from '../types/ToolUseContext';
import {
  cloneFileStateCache,
  resolveReadFileState,
} from '../../utils/fileStateCache';
import type {
  SubAgentEngine,
  SubAgentProgressEvent,
  SubAgentResult,
} from './SubAgentEngine';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:AgentTool:ForkSubagent');

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
  /** B2：父代工具执行上下文（含 readFileState 快照缓存） */
  parentToolContext?: ToolUseContext;
  /** B2：父代 readFileState（缺省时从 parentToolContext 读取） */
  readFileState?: unknown;
  /** B3：当前嵌套深度（缺省 0；子代理内为父代 +1） */
  subagentDepth?: number;
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
  prompt.push('[你是一个 fork 出来的子代理，与父代理运行在同一会话上下文中。]');

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
    content: `${FORK_BOILERPLATE_TAG} 这是一个 fork 出来的子代理会话。请自主继续完成任务。`,
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
停！先读以下内容。

你是一个 fork 出来的 worker 进程。你**不是**主代理。

规则（不可协商）：
1. 不要 spawn 子代理；直接执行。
2. 不要交谈、不要提问、不要建议下一步。
3. 不要发表议论，也不要添加元评论。
4. 直接使用你的工具：Bash、Read、Write 等。
5. 不要在工具调用之间输出文本。静默使用工具，最后一次性汇报。
6. 严格停留在你被指派指令的范围内。
7. 报告控制在 500 词以内，除非指令另有规定。
8. 你的回复**必须**以 "Scope:" 开头。不要前言，不要边想边说。
9. 汇报结构化事实，然后停止。

输出格式（纯文本标签，不是 markdown 标题）：
  Scope: <用一句话复述你被指派的范围>
  Result: <答案或关键发现>
  Key files: <相关文件路径>
  Issues: <列表 —— 仅当确有需要标记的问题时才包含>
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

    // B2：子代理继承父代 readFileState（深克隆，子代理的编辑快照不回写父代）
    const parentCache =
      resolveReadFileState(
        options.readFileState ?? options.parentToolContext?.readFileState
      ) ?? null;
    const parentDepth = options.subagentDepth ?? 0;
    const childToolContext: ToolUseContext | undefined = parentCache
      ? {
          ...(options.parentToolContext ?? ({} as ToolUseContext)),
          readFileState: cloneFileStateCache(parentCache),
          // B3：深度 +1（顶层 AgentTool 会据此拦截嵌套超限）
          subagentDepth: parentDepth + 1,
        }
      : options.parentToolContext
        ? { ...options.parentToolContext, subagentDepth: parentDepth + 1 }
        : undefined;

    const result: SubAgentResult = await engine.execute(
      {
        agentId: taskId,
        systemPrompt,
        messages,
        tools: toolDefinitions,
        toolInstances: new Map(),
        maxTurns: options.maxTurns || 50,
        toolContext: childToolContext,
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
