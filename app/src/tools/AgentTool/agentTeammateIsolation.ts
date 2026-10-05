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

import { WorkspaceGit } from '../../workspaces/WorkspaceGit';
import { getTeammateManager } from '../../subagent/TeammateManager';
import type { AgentInput } from './types';
import type { ToolUseContext } from '../types/ToolUseContext';
import {
  buildForkSystemPrompt,
  buildForkContextMessages,
  buildChildMessage,
} from './ForkSubagent';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:agentTool');

/**
 * 队友（teammate）注册 / 注销 / 隔离 / fork 组装（C8）。
 *
 * 2026-10-05 纯搬迁自 `tools/AgentTool/AgentTool.ts`（文件规模债拆分 B3，见
 * `.trae/specs/file-size-debt-partition-plan.md` §28.5）——方法体、注释、日志文案、日志
 * module 名逐字保留。
 *
 * 依赖说明：本类**零宿主依赖**（不访问宿主 `this` 成员）——`agentTeammateHandles` 字段
 * 随迁为本类私有字段；被迁出成员引用的符号全部来自**模块级 import**（`getTeammateManager`
 * / `WorkspaceGit` / `ForkSubagent` 三函数）⇒ 无 deps 对象、可无参构造。
 *
 * 可见性说明：`unregisterTeammate` / `bindTeammate` / `applyIsolationAndFork` 原为
 * `private`，外迁后宿主执行主链直调 `this.agentTeammateIsolation.X(...)` ⇒ 改为 `public`
 * （签名与实现逐字不变）；`registerTeammate` 仅被簇内 `bindTeammate` 调用 ⇒ 保持 `private`。
 */
export class AgentTeammateIsolation {
  /**
   * 活跃子 agent 的 teammate handle 映射（设计二 2026-08-26）：
   * 注册时机前移到 execute 入口（agentId 确定后），生命周期绑定执行全程；
   * 前台在 execute 返回时清理，后台在 bgTask 完成/失败回调中清理。
   */
  private agentTeammateHandles: Map<string, string> = new Map();

  /** 注册子 agent 为可寻址 teammate（返回 handleId；失败返回 null 不阻断执行） */
  private async registerTeammate(
    agentId: string,
    name: string | undefined,
    systemPrompt: string,
    model?: string
  ): Promise<string | null> {
    if (!name) return null;
    try {
      const handle = await getTeammateManager().spawnTeammate('in_process', {
        name,
        model,
        systemPrompt,
      });
      this.agentTeammateHandles.set(agentId, handle.id);
      logger.info('子 agent 已注册为可寻址 teammate', {
        agentId,
        name,
        handleId: handle.id,
      });
      return handle.id;
    } catch (error) {
      // 注册失败（重名/上限）不阻断主流程：子 agent 仅不可寻址
      logger.warning('子 agent teammate 注册失败（仅不可寻址，不影响执行）', {
        agentId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** 注销子 agent 的 teammate（幂等，失败仅记录） */
  async unregisterTeammate(agentId: string): Promise<void> {
    const handleId = this.agentTeammateHandles.get(agentId);
    if (!handleId) return;
    this.agentTeammateHandles.delete(agentId);
    try {
      await getTeammateManager().killTeammate(handleId);
      logger.info('子 agent teammate 已清理', { agentId, handleId });
    } catch (error) {
      logger.warning('teammate 清理失败', {
        agentId,
        handleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 执行生命周期：teammate 绑定（O5 seam `executeLifecycle` / bind）。
   *
   * 行为中性：注册时机（systemPrompt 确定后、后台回调清理）与
   * `isSimpleTaskNow` 判定（`prompt.length < 500 && !isFork && !subagent_type`）逐字保留；
   * 信箱订阅与日志字段不变。返回 `isSimpleTaskNow` 供前台路径复用（原实现同源复用）。
   */
  async bindTeammate(params: {
    agentInput: AgentInput;
    agentId: string;
    systemPrompt: string;
    isFork: boolean;
  }): Promise<{
    teammateHandleId: string | null;
    mailbox: Array<{ role: 'user'; content: string }>;
    isSimpleTaskNow: boolean;
  }> {
    const { agentInput, agentId, systemPrompt, isFork } = params;

    // 设计二（2026-08-26）：teammate 注册前移到 execute 入口（systemPrompt 确定后）——
    // 原在 runWithEngine 内注册+finally kill，后台模式会在主线程返回时被过早清理。
    // 现注册时机提前，生命周期绑定执行全程（前台 execute 返回清理，后台 bgTask 回调清理）。
    let teammateHandleId: string | null = null;
    const mailbox: Array<{ role: 'user'; content: string }> = [];
    // BUG 6 修复（2026-08-27）：simple task（runDirectCall，无 SubAgentEngine
    // messageSource 消费）不注册 teammate——原注册后 mailbox 无人消费，消息堆积丢弃
    const isSimpleTaskNow =
      agentInput.prompt.length < 500 && !isFork && !agentInput.subagent_type;
    if (!isSimpleTaskNow) {
      teammateHandleId = await this.registerTeammate(
        agentId,
        agentInput.name,
        systemPrompt,
        agentInput.model
      );
    }
    if (teammateHandleId && agentInput.name) {
      const handleName = agentInput.name;
      getTeammateManager().onTeammateMessage(teammateHandleId, (message) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);
        mailbox.push({
          role: 'user',
          content: `[来自 ${String(message.metadata?.sender ?? 'teammate')} 的消息] ${content}`,
        });
        logger.info('teammate 消息已进入子 agent 信箱', {
          agentId,
          name: handleName,
        });
      });
    }

    return { teammateHandleId, mailbox, isSimpleTaskNow };
  }

  /**
   * 执行生命周期：隔离与 fork 提示词组装（O5 seam `executeLifecycle` / isolation+prompt）。
   *
   * 行为中性：worktree 三条分支（后台降级 / 前台创建 / 创建失败降级）的日志与提示词
   * **逐字保留**；fork 上下文组装与 `agentInput.prompt` 就地改写保留（同一对象引用）。
   */
  async applyIsolationAndFork(params: {
    agentInput: AgentInput;
    agentId: string;
    systemPrompt: string;
    context?: ToolUseContext;
    isFork: boolean;
    isBackground: boolean;
  }): Promise<{
    systemPrompt: string;
    worktreeGit?: WorkspaceGit;
    worktreeContext?: ToolUseContext;
  }> {
    const { agentInput, agentId, context, isFork, isBackground } = params;
    let systemPrompt = params.systemPrompt;
    let worktreeGit: WorkspaceGit | undefined;
    let worktreeContext: ToolUseContext | undefined;

    // G3 接线（2026-08-31）：isolation='worktree' 程序化创建隔离 worktree，
    // 将 cwd 注入子代理工具上下文（文件工具相对路径解析到 worktree 内）。
    if (agentInput.isolation === 'worktree') {
      if (isBackground) {
        // 后台任务生命周期复杂（execute 返回后任务仍在运行），保留提示词注入降级
        systemPrompt +=
          '\n\nThis agent runs in an isolated git worktree.\n' +
          `Use EnterWorktree to create a worktree with slug "${agentInput.name || agentId}" before making changes.\n` +
          'After completing work, use ExitWorktree to clean up the worktree.\n' +
          'All file modifications must be done inside the worktree, never in the parent workspace.';
        logger.warn(
          'Worktree isolation: 后台任务不程序化创建 worktree，降级为提示词引导',
          {
            agentId,
          }
        );
      } else {
        try {
          const baseDir = context?.options?.cwd;
          if (baseDir) {
            const git = new WorkspaceGit({ baseDir });
            const info = await git.createWorktree(agentId);
            worktreeGit = git;
            worktreeContext = {
              ...context,
              options: {
                ...(context?.options ?? {}),
                cwd: info.worktreePath,
              },
            } as ToolUseContext;
            systemPrompt +=
              '\n\nThis agent runs in an isolated git worktree.\n' +
              `Your working directory is: ${info.worktreePath}\n` +
              // 台账「隔离提示词工具名漂移」修复（2026-09-26）：真实注册名为
              // file_read/file_write/file_edit（FileReadTool.ts:238 等），原写
              // read_file/write_file/edit_file ⇒ 提示模型调用不存在的工具。
              'Relative file paths in file_read/file_write/file_edit resolve to this directory.\n' +
              'All file modifications must be inside the worktree, never in the parent workspace.';
            logger.info('Worktree isolation: 已程序化创建 worktree', {
              agentId,
              worktreePath: info.worktreePath,
            });
          }
        } catch (error) {
          // 创建失败（非 git 仓库等）→ 降级为提示词引导
          logger.warn('Worktree isolation: 程序化创建失败，降级为提示词引导', {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
          systemPrompt +=
            '\n\nThis agent runs in an isolated git worktree.\n' +
            `Use EnterWorktree to create a worktree with slug "${agentInput.name || agentId}" before making changes.\n` +
            'After completing work, use ExitWorktree to clean up the worktree.\n';
        }
      }
    }

    if (isFork) {
      const parentMessages: Array<{
        role: 'user' | 'assistant';
        content: string;
      }> = context?.messages
        ? context.messages.map((m: { role: string; content: string }) => ({
            role: m.role as 'user' | 'assistant',
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
          }))
        : [];

      systemPrompt = buildForkSystemPrompt(systemPrompt, {
        renderedSystemPrompt: systemPrompt,
        parentMessages,
        directive: agentInput.description,
      });

      const forkMessages = buildForkContextMessages(parentMessages);
      const childInstruction = buildChildMessage(agentInput.prompt);
      agentInput.prompt =
        forkMessages.map((m) => `${m.role}: ${m.content}`).join('\n\n') +
        '\n\n' +
        childInstruction;
    }

    return { systemPrompt, worktreeGit, worktreeContext };
  }
}
