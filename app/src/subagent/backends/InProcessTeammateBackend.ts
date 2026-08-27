//
/**
 * InProcessTeammate后端
 * 在当前进程中运行teammate
 * */

import type { Message } from '@modules/chat/types/message';
import type {
  SubAgent,
  InProcessSubAgentConfig,
} from '@modules/subagent/types/SubAgent';
import { SubAgentType } from '@modules/subagent/types/SubAgent';
import {
  BaseTeammateBackend,
  TeammateConfig,
  TeammateHandle,
} from './TeammateBackend';

export class InProcessTeammateBackend extends BaseTeammateBackend {
  readonly type = 'in_process' as const;

  protected async createAgent(config: TeammateConfig): Promise<SubAgent> {
    const { SubAgentFactory } = await import('../SubAgentFactory');

    const subAgentConfig: InProcessSubAgentConfig = {
      id: `inprocess-${config.name}-${Date.now()}`,
      name: config.name,
      type: SubAgentType.IN_PROCESS,
      model: config.model,
      systemPrompt: config.systemPrompt,
      memoryLimit: config.memoryLimit,
    };

    const factory = new SubAgentFactory();
    const agent = await factory.createInProcessSubAgent(subAgentConfig);

    if (agent && typeof (agent as any).onMessage === 'function') {
      (agent as any).onMessage((message: Message) => {
        const handle = this.getHandleByAgent(agent);
        if (handle) {
          this.notifyMessage(handle, message);
        }
      });
    }

    return agent;
  }

  private getHandleByAgent(agent: SubAgent): TeammateHandle | undefined {
    for (const handle of this.getAllHandles()) {
      if (handle.agent === agent) {
        return handle;
      }
    }
    return undefined;
  }

  // BUG 1 修复（2026-08-27）：删除 restart override——原实现 kill+spawn 生成
  // 含时间戳的新 handle id，TeammateManager.activeTeammates 仍持有旧 handle，
  // 重启后新 agent 脱离管理（泄漏）且消息投递给已停止的旧 agent。
  // 基类 BaseTeammateBackend.restart 为"同 handle 重建 agent"，语义正确。

  override async isHealthy(handle: TeammateHandle): Promise<boolean> {
    if (handle.status !== 'running') {
      return false;
    }

    if (!handle.agent) {
      return false;
    }

    const agent = handle.agent as any;

    if (typeof agent.isHealthy === 'function') {
      return agent.isHealthy();
    }

    if (typeof agent.isRunning === 'function') {
      return agent.isRunning();
    }

    return true;
  }
}

export class InProcessTeammateBackendFactory {
  createBackend(): InProcessTeammateBackend {
    return new InProcessTeammateBackend();
  }
}
