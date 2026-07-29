// MIT License
// Copyright (c) 2026 190615273@qq.com

// P1-12: TrackedTool 状态机单元测试
import { describe, it, expect } from 'bun:test';
import { TrackedTool, TrackedToolState } from '../../src/query/TrackedTool';

describe('TrackedTool 状态机', () => {
  describe('初始状态', () => {
    it('创建时状态为 QUEUED', () => {
      const tool = new TrackedTool('call-1', 'bash', { cmd: 'ls' });
      expect(tool.state).toBe(TrackedToolState.QUEUED);
    });

    it('非终端状态 isTerminal=false', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      expect(tool.isTerminal).toBe(false);
    });

    it('活跃状态 isActive=true', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      expect(tool.isActive).toBe(true);
    });
  });

  describe('合法状态转换', () => {
    it('QUEUED → EXECUTING', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      expect(tool.state).toBe(TrackedToolState.EXECUTING);
    });

    it('EXECUTING → COMPLETED', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markCompleted({ stdout: 'ok' });
      expect(tool.state).toBe(TrackedToolState.COMPLETED);
      expect(tool.isTerminal).toBe(true);
      expect(tool.result).toEqual({ stdout: 'ok' });
    });

    it('EXECUTING → FAILED', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markFailed('command not found');
      expect(tool.state).toBe(TrackedToolState.FAILED);
      expect(tool.error).toBe('command not found');
    });

    it('EXECUTING → ABORTED', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markAborted('cascade abort');
      expect(tool.state).toBe(TrackedToolState.ABORTED);
      expect(tool.error).toContain('cascade abort');
    });

    it('EXECUTING → TIMED_OUT', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markTimedOut(120_000);
      expect(tool.state).toBe(TrackedToolState.TIMED_OUT);
      expect(tool.error).toContain('120000ms');
    });
  });

  describe('非法状态转换（不抛异常，仅记录 warning）', () => {
    it('从 COMPLETED 无法再转换', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markCompleted('ok');
      tool.markFailed('should not happen');
      expect(tool.state).toBe(TrackedToolState.COMPLETED);
    });

    it('从 QUEUED 不能直接到 COMPLETED', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markCompleted('skip');
      expect(tool.state).toBe(TrackedToolState.QUEUED); // 未变更
    });

    it('从 QUEUED 不能直接到 FAILED', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markFailed('skip');
      expect(tool.state).toBe(TrackedToolState.QUEUED);
    });
  });

  describe('时间指标', () => {
    it('durationMs 在完成前为 0', async () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      expect(tool.durationMs).toBe(0);
    });

    it('durationMs 在完成后大于 0', async () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      await new Promise((r) => setTimeout(r, 5));
      tool.markCompleted('done');
      expect(tool.durationMs).toBeGreaterThan(0);
    });

    it('queueWaitMs 计算排队等待时长', async () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      await new Promise((r) => setTimeout(r, 5));
      tool.markExecuting();
      expect(tool.queueWaitMs).toBeGreaterThan(0);
    });
  });

  describe('toResult', () => {
    it('返回 TrackedToolResult', () => {
      const tool = new TrackedTool('call-1', 'search', { q: 'test' });
      tool.markExecuting();
      tool.markCompleted({ hits: 5 });

      const result = tool.toResult();
      expect(result.toolCallId).toBe('call-1');
      expect(result.toolName).toBe('search');
      expect(result.state).toBe(TrackedToolState.COMPLETED);
      expect(result.result).toEqual({ hits: 5 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('失败时返回 error', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      tool.markExecuting();
      tool.markFailed('permission denied');

      const result = tool.toResult();
      expect(result.state).toBe(TrackedToolState.FAILED);
      expect(result.error).toBe('permission denied');
    });
  });

  describe('状态变更回调', () => {
    it('状态变更时触发回调', () => {
      const tool = new TrackedTool('call-1', 'bash', {});
      const states: TrackedToolState[] = [];
      tool.setOnStateChange((t) => states.push(t.state));

      tool.markExecuting();
      tool.markCompleted('ok');

      expect(states).toEqual([
        TrackedToolState.EXECUTING,
        TrackedToolState.COMPLETED,
      ]);
    });
  });

  describe('属性', () => {
    it('toolCallId / toolName / arguments', () => {
      const tool = new TrackedTool('id-123', 'grep', { pattern: 'error' });
      expect(tool.toolCallId).toBe('id-123');
      expect(tool.toolName).toBe('grep');
      expect(tool.arguments).toEqual({ pattern: 'error' });
    });
  });

  describe('isActive', () => {
    it('QUEUED 为 active', () => {
      expect(new TrackedTool('c1', 'tool', {}).isActive).toBe(true);
    });

    it('EXECUTING 为 active', () => {
      const tool = new TrackedTool('c1', 'tool', {});
      tool.markExecuting();
      expect(tool.isActive).toBe(true);
    });

    it('COMPLETED 不是 active', () => {
      const tool = new TrackedTool('c1', 'tool', {});
      tool.markExecuting();
      tool.markCompleted('ok');
      expect(tool.isActive).toBe(false);
    });

    it('FAILED 不是 active', () => {
      const tool = new TrackedTool('c1', 'tool', {});
      tool.markExecuting();
      tool.markFailed('err');
      expect(tool.isActive).toBe(false);
    });
  });
});
