/**
 * 协作编排统一层 · 薄端口 —— 端口契约与三通道适配器（用例）。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md` §6（验收用例）。
 * 全部使用 stub（**不触真模型 / 真网络**）。
 */

import { describe, it, expect } from 'bun:test';

import {
  COLLABORATION_SERVICE_ID,
  registerCollaborationSpi,
  resolveCollaboration,
} from '../../../src/core/spi/CollaborationService.js';
import { SwarmChannelAdapter } from '../../../src/agent/orchestration/SwarmChannelAdapter.js';
import { SchedulerChannelAdapter } from '../../../src/agent/orchestration/SchedulerChannelAdapter.js';
import { RemoteChannelAdapter } from '../../../src/agent/orchestration/RemoteChannelAdapter.js';
import type {
  AgentSwarmOptions,
  SwarmExecutor,
} from '../../../src/tasks/swarm/AgentSwarm.js';
import type { ScheduledAgentTask } from '../../../src/agent/moa/ParallelAgentScheduler.js';

describe('协作编排端口（预留端口 / 薄端口）', () => {
  // ① 未注册（必须最先执行：端口内部为模块级单例 `_service`）
  it('① 未注册：dispatch() === null 且 listChannels() === []', async () => {
    const port = resolveCollaboration();
    expect(await port.listChannels()).toEqual([]);
    expect(
      await port.dispatch({
        goal: 'g',
        units: [{ id: 'u1', instruction: 'i1' }],
      })
    ).toBeNull();
  });

  // ② 注册后解析到实现
  it('② registerCollaborationSpi 后：resolveCollaboration() 解析到实现', async () => {
    const descriptors: Array<{ id: string; scope: string }> = [];
    const container = {
      registerDescriptor<T>(desc: {
        id: string;
        factory: () => T;
        scope: 'singleton' | 'transient' | 'request';
      }): void {
        descriptors.push({ id: desc.id, scope: desc.scope });
      },
    };
    const impl = {
      listChannels: async () => ['stub-channel'],
      dispatch: async () => null,
    };

    await registerCollaborationSpi(container, impl);

    expect(await resolveCollaboration().listChannels()).toEqual([
      'stub-channel',
    ]);
    expect(descriptors).toEqual([
      { id: COLLABORATION_SERVICE_ID, scope: 'singleton' },
    ]);
  });

  // ③a swarm：unit → SwarmWorkerTask 映射 + 结果保序
  it('③a SwarmChannelAdapter：unit → task 映射 + 结果保序', async () => {
    const received: AgentSwarmOptions[] = [];
    const executor: SwarmExecutor = async () => ({ output: '', ok: true });

    const adapter = new SwarmChannelAdapter({
      swarm: {
        run: async (options) => {
          received.push(options);
          return {
            workers: options.tasks.map((t, idx) => ({
              id: t.id,
              description: t.description,
              output: `out-${idx}`,
              success: true,
              timedOut: false,
              verify: 'passed',
              ok: true,
            })),
            synthesized: '',
            allPassed: true,
            totalTokens: 0,
          };
        },
      },
      executor,
    });

    const units = [
      { id: 'u1', instruction: 'do-1' },
      { id: 'u2', instruction: 'do-2' },
    ];
    const res = await adapter.dispatch({
      goal: 'G',
      units,
      maxConcurrency: 2,
    });

    expect(res).not.toBeNull();
    expect(res?.channel).toBe('local-swarm');
    // unit → SwarmWorkerTask{ id, description: instruction }
    expect(received[0].tasks).toEqual([
      { id: 'u1', description: 'do-1' },
      { id: 'u2', description: 'do-2' },
    ]);
    // goal / maxConcurrency 透传；executor 由构造注入
    expect(received[0].goal).toBe('G');
    expect(received[0].maxConcurrency).toBe(2);
    expect(received[0].executor).toBe(executor);
    // 结果保序：下标与 units 对应
    expect(res?.outcomes.map((o) => o.unitId)).toEqual(['u1', 'u2']);
    expect(res?.allPassed).toBe(true);
    expect(await adapter.listChannels()).toEqual(['local-swarm']);
  });

  // ③b scheduler：unit → ScheduledAgentTask 映射 + 结果保序
  it('③b SchedulerChannelAdapter：unit → task 映射 + 结果保序', async () => {
    const received: ScheduledAgentTask[][] = [];

    const adapter = new SchedulerChannelAdapter({
      scheduler: {
        executeAll: async (tasks) => {
          received.push(tasks);
          const results = tasks.map((t, idx) => ({
            agentId: t.agentId,
            description: t.description,
            content: `c-${idx}`,
            success: true,
            durationMs: 0,
            tokensUsed: 0,
            status: 'completed' as const,
          }));
          return {
            results,
            completedCount: results.length,
            failedCount: 0,
            timeoutCount: 0,
            totalDurationMs: 0,
            totalTokens: 0,
          };
        },
      },
    });

    const units = [
      { id: 'u1', instruction: 'i1' },
      { id: 'u2', instruction: 'i2' },
    ];
    const res = await adapter.dispatch({ goal: 'G', units });

    expect(res).not.toBeNull();
    expect(res?.channel).toBe('local-scheduler');
    // unit → ScheduledAgentTask{ agentId, description, prompt }（不新增字段）
    expect(received[0]).toEqual([
      { agentId: 'u1', description: 'i1', prompt: 'i1' },
      { agentId: 'u2', description: 'i2', prompt: 'i2' },
    ]);
    expect(res?.outcomes.map((o) => o.unitId)).toEqual(['u1', 'u2']);
    expect(res?.allPassed).toBe(true);
    expect(await adapter.listChannels()).toEqual(['local-scheduler']);
  });

  // ③c remote：unit → RemoteAgentTask 映射 + 结果保序（已连接 + allowRemote）
  it('③c RemoteChannelAdapter：unit → task 映射 + 结果保序', async () => {
    const received: Array<{
      agentId: string;
      task: { id: string; description: string };
    }> = [];

    const adapter = new RemoteChannelAdapter({
      executor: {
        getStatus: () => 'connected',
        execute: async (agentId, task) => {
          received.push({ agentId, task });
          return {
            taskId: task.id,
            sessionId: 's1',
            success: true,
            content: `r-${agentId}`,
            timestamp: 0,
          };
        },
      },
    });

    const units = [
      { id: 'u1', instruction: 'i1' },
      { id: 'u2', instruction: 'i2' },
    ];
    const res = await adapter.dispatch({ goal: 'G', units, allowRemote: true });

    expect(res).not.toBeNull();
    expect(res?.channel).toBe('remote');
    expect(received).toEqual([
      { agentId: 'u1', task: { id: 'u1', description: 'i1' } },
      { agentId: 'u2', task: { id: 'u2', description: 'i2' } },
    ]);
    expect(res?.outcomes.map((o) => o.unitId)).toEqual(['u1', 'u2']);
    expect(res?.allPassed).toBe(true);
  });

  // ④ allowRemote !== true（或未连接）⇒ remote dispatch() === null，不降级到本地
  it('④ allowRemote !== true ⇒ remote 通道 dispatch() 返回 null', async () => {
    const units = [{ id: 'u1', instruction: 'i1' }];
    const online = new RemoteChannelAdapter({
      executor: {
        getStatus: () => 'connected',
        execute: async () => {
          throw new Error('不应被调用');
        },
      },
    });
    expect(await online.dispatch({ goal: 'g', units })).toBeNull();
    expect(
      await online.dispatch({ goal: 'g', units, allowRemote: false })
    ).toBeNull();

    const offline = new RemoteChannelAdapter({
      executor: {
        getStatus: () => 'disconnected',
        execute: async () => {
          throw new Error('不应被调用');
        },
      },
    });
    expect(
      await offline.dispatch({ goal: 'g', units, allowRemote: true })
    ).toBeNull();
  });
});
