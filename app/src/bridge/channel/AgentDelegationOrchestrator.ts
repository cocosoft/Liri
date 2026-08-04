/**
 * 跨机器 Agent 任务委托
 *
 * 完整闭环：用户 → Channel → Agent → 子任务 → Bridge 分发 → 远程执行 → 回传 → Agent 汇总 → Channel 回复
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type {
  ChannelId,
  MessageContext,
  SendResult,
} from '@modules/channels/types';
import { channelRegistry } from '@modules/channels/registry/ChannelRegistry';
import { ChannelBridgeAdapter } from './ChannelBridgeAdapter';
import type { Coordinator, CoordinatorTask } from '@modules/core';

const logger = new Logger({
  module: 'bridge:channel:agentDelegationOrchestrator',
  level: LogLevel.INFO,
});

/**
 * 子任务定义（由 Agent 拆分生成）
 */
export interface SubTaskDef {
  name: string;
  description: string;
  prompt: string;
  priority?: number;
  dependsOn?: string;
}

/**
 * 委托场景
 */
export type DelegationScenario =
  | 'code_refactor' // 跨模块代码重构
  | 'batch_test' // 多仓库批量测试
  | 'multi_analysis' // 多维度代码分析
  | 'parallel_search' // 并行搜索
  | 'custom'; // 自定义

/**
 * 委托会话
 */
export interface DelegationSession {
  id: string;
  scenario: DelegationScenario;
  channelId: ChannelId;
  senderId: string;
  senderName?: string;
  originalMessage: string;
  subTasks: SubTaskDef[];
  bridgeTaskIds: string[];
  status: 'pending' | 'distributing' | 'executing' | 'completed' | 'failed';
  resultSummary?: string;
  createdAt: number;
  completedAt?: number;
}

/**
 * 跨机器 Agent 委托编排器
 *
 * 将 Agent 拆分出的子任务，通过 Bridge 分发到多台机器并行执行
 */
export class AgentDelegationOrchestrator {
  private adapter: ChannelBridgeAdapter;
  private sessions: Map<string, DelegationSession> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(coordinator: Coordinator) {
    this.adapter = new ChannelBridgeAdapter({
      coordinator,
      autoProgressReply: true,
      progressIntervalMs: 15000,
      taskTimeoutMs: 900000,
    });
  }

  /**
   * 创建委托会话
   */
  createDelegation(
    scenario: DelegationScenario,
    ctx: MessageContext,
    subTasks: SubTaskDef[]
  ): DelegationSession {
    const sessionId = `delegate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const session: DelegationSession = {
      id: sessionId,
      scenario,
      channelId: ctx.channelId,
      senderId: ctx.senderId,
      senderName: ctx.senderName,
      originalMessage: ctx.content,
      subTasks,
      bridgeTaskIds: [],
      status: 'pending',
      createdAt: Date.now(),
    };

    this.sessions.set(sessionId, session);

    logger.info(
      `委托会话创建: ${sessionId} (场景: ${scenario}, ${subTasks.length} 个子任务)`
    );

    return session;
  }

  /**
   * 分发委托（启动所有子任务到 Bridge）
   */
  async distribute(
    sessionId: string
  ): Promise<{ success: boolean; taskIds: string[] }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, taskIds: [] };
    }

    session.status = 'distributing';

    const ctx: MessageContext = {
      channelId: session.channelId,
      senderId: session.senderId,
      senderName: session.senderName,
      messageId: session.id,
      content: session.originalMessage,
      timestamp: session.createdAt,
      messageType: 'text',
      rawPayload: {},
      isDirectMessage: true,
    };

    const taskIds = this.adapter.delegateBatch(
      ctx,
      session.subTasks.map((st) => ({
        description: `[${session.scenario}] ${st.description}`,
        prompt: st.prompt,
        priority: st.priority,
      }))
    );

    session.bridgeTaskIds = taskIds;
    session.status = 'executing';

    // 启动轮询
    this.startPolling();

    // 发送确认消息
    await this.sendChannelReply(
      session.channelId,
      session.senderId,
      [
        `🚀 已分发 ${taskIds.length} 个子任务到 Bridge 网络`,
        ...session.subTasks.map((st, i) => `  ${i + 1}. ${st.description}`),
        '',
        `ID: ${sessionId.slice(-8)}`,
        `使用 Liri bridge status 查看进度`,
      ].join('\n')
    );

    logger.info(`委托已分发: ${sessionId} → ${taskIds.length} 个 Bridge 任务`);

    return { success: true, taskIds };
  }

  /**
   * 获取委托进度
   */
  getProgress(sessionId: string): {
    total: number;
    running: number;
    completed: number;
    failed: number;
    pending: number;
    percentComplete: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        total: 0,
        running: 0,
        completed: 0,
        failed: 0,
        pending: 0,
        percentComplete: 0,
      };
    }

    let running = 0;
    let completed = 0;
    let failed = 0;
    let pending = 0;

    for (const taskId of session.bridgeTaskIds) {
      const meta = this.adapter.getDelegationMeta(taskId);
      if (!meta) continue;

      // 从 Coordinator 查询状态
      const tasks = (
        this.adapter as unknown as { options: { coordinator: Coordinator } }
      ).options.coordinator.getAllTasks();
      const task = tasks.find((t: CoordinatorTask) => t.id === taskId);

      if (!task) {
        pending++;
      } else if (task.status === 'running') {
        running++;
      } else if (task.status === 'completed') {
        completed++;
      } else if (task.status === 'failed' || task.status === 'timed_out') {
        failed++;
      } else {
        pending++;
      }
    }

    const total = session.bridgeTaskIds.length || 1;
    return {
      total,
      running,
      completed,
      failed,
      pending,
      percentComplete: Math.round(((completed + failed) / total) * 100),
    };
  }

  /**
   * 获取委托会话
   */
  getSession(sessionId: string): DelegationSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 停止轮询
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.info('委托轮询已停止');
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(async () => {
      const count = await this.adapter.pollAndReport();

      // 检查所有会话是否完成
      let allDone = true;
      for (const [sessionId, session] of this.sessions) {
        if (session.status === 'completed' || session.status === 'failed')
          continue;

        const progress = this.getProgress(sessionId);
        if (progress.completed + progress.failed >= progress.total) {
          session.status = progress.failed > 0 ? 'failed' : 'completed';
          session.completedAt = Date.now();
          await this.sendChannelReply(
            session.channelId,
            session.senderId,
            [
              `🏁 委托完成 (${sessionId.slice(-8)})`,
              `  ✅ ${progress.completed} 成功  ❌ ${progress.failed} 失败`,
              `  ⏱ 总耗时 ${((session.completedAt - session.createdAt) / 1000).toFixed(1)}s`,
            ].join('\n')
          );
        } else {
          allDone = false;
        }
      }

      if (allDone && this.sessions.size > 0) {
        this.stopPolling();
      }
    }, 5000);

    logger.info('委托轮询已启动 (间隔: 5s)');
  }

  private async sendChannelReply(
    channelId: ChannelId,
    target: string,
    message: string
  ): Promise<boolean> {
    const entry = channelRegistry.get(channelId);
    if (!entry || !entry.connected) return false;

    try {
      const ok = await entry.plugin!.outbound.sendText(target, message);
      return ok;
    } catch {
      void handleError(new Error('Channel reply failed'), {
        module: 'bridge:agent',
        action: 'sendChannelReply',
      });
      return false;
    }
  }
}
