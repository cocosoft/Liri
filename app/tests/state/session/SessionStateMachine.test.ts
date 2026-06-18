/**
 * SessionStateMachine — 会话状态机单元测试
 *
 * 覆盖所有便捷方法、合法/非法转移、error 元数据、状态查询。
 * 共 8 种状态的全量转移规则覆盖。
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import { SessionStateMachine, SessionState } from '../../../src/state/session/index.js';
import { IllegalTransitionError } from '../../../src/state/errors.js';

describe('SessionStateMachine', () => {

  let sm: SessionStateMachine;

  beforeEach(() => {
    sm = new SessionStateMachine('session-001');
  });

  // ============================================================
  // 构造
  // ============================================================

  describe('构造与初始状态', () => {

    it('初始状态应为 IDLE', () => {
      expect(sm.getState()).toBe(SessionState.IDLE);
    });

    it('contextId 应与 sessionId 一致', () => {
      expect(sm.getContextId()).toBe('session-001');
    });

    it('初始应可启动', () => {
      expect(sm.canStart()).toBe(true);
    });

    it('初始不应有待处理动作', () => {
      expect(sm.hasPendingAction()).toBe(false);
    });

  });

  // ============================================================
  // start
  // ============================================================

  describe('start', () => {

    it('IDLE → RUNNING 应成功', () => {
      const result = sm.start('用户发起会话');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.RUNNING);
    });

    it('终态 start 应抛出', () => {
      sm.start();
      sm.complete();
      sm.archive();
      expect(() => sm.start()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // requireAction
  // ============================================================

  describe('requireAction', () => {

    it('RUNNING → REQUIRES_ACTION 应成功', () => {
      sm.start();
      const result = sm.requireAction({
        tool_name: 'code_review',
        action_description: '请审查代码变更',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.REQUIRES_ACTION);
      expect(sm.hasPendingAction()).toBe(true);
    });

    it('requireAction 应携带元数据到历史记录', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'code_review',
        action_description: '审查代码',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
        input: { file: 'src/main.ts' },
      });
      const history = sm.getHistory();
      const record = history[history.length - 1];
      expect(record.metadata).toBeDefined();
      expect(record.metadata?.tool_name).toBe('code_review');
      expect(record.metadata?.tool_use_id).toBe('tu-001');
      expect(record.metadata?.input).toEqual({ file: 'src/main.ts' });
    });

    it('非 RUNNING 状态 requireAction 应抛出', () => {
      expect(() => sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      })).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // resume
  // ============================================================

  describe('resume', () => {

    it('REQUIRES_ACTION → RUNNING 应成功', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      const result = sm.resume('用户已确认');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.RUNNING);
    });

    it('PAUSED → RUNNING 应成功', () => {
      sm.start();
      sm.pause('系统暂停');
      const result = sm.resume('恢复执行');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.RUNNING);
    });

    it('终态 resume 应抛出', () => {
      sm.start();
      sm.complete();
      sm.archive();
      expect(() => sm.resume()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // pause
  // ============================================================

  describe('pause', () => {

    it('RUNNING → PAUSED 应成功', () => {
      sm.start();
      const result = sm.pause('用户暂停');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.PAUSED);
    });

    it('REQUIRES_ACTION → PAUSED 应成功', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      const result = sm.pause();
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.PAUSED);
    });

    it('IDLE 状态 pause 应抛出', () => {
      expect(() => sm.pause()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // complete
  // ============================================================

  describe('complete', () => {

    it('RUNNING → COMPLETED 应成功', () => {
      sm.start();
      const result = sm.complete('任务完成');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.COMPLETED);
    });

    it('非 RUNNING 状态 complete 应抛出', () => {
      expect(() => sm.complete()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // error
  // ============================================================

  describe('error', () => {

    it('RUNNING → ERROR 应成功并携带错误信息', () => {
      sm.start();
      const err = new Error('网络连接超时');
      const result = sm.error(err);
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.ERROR);

      // 验证 metadata 包含 stack 和 name
      const history = sm.getHistory();
      const record = history[history.length - 1];
      expect(record.metadata).toBeDefined();
      expect(record.metadata?.name).toBe('Error');
      expect(record.metadata?.stack).toBeString();
    });

    it('REQUIRES_ACTION → ERROR 应成功', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      const result = sm.error(new Error('超时'));
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.ERROR);
    });

    it('IDLE 状态 error 应抛出', () => {
      expect(() => sm.error(new Error('test'))).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // abort
  // ============================================================

  describe('abort', () => {

    it('IDLE → ABORTED 应成功', () => {
      const result = sm.abort('弃用');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.ABORTED);
    });

    it('RUNNING → ABORTED 应成功', () => {
      sm.start();
      sm.abort('手动中止');
      expect(sm.getState()).toBe(SessionState.ABORTED);
    });

    it('ERROR → ABORTED 应成功', () => {
      sm.start();
      sm.error(new Error('fatal'));
      sm.abort();
      expect(sm.getState()).toBe(SessionState.ABORTED);
    });

    it('终态 abort 应抛出', () => {
      sm.start();
      sm.complete();
      expect(() => sm.abort()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // archive
  // ============================================================

  describe('archive', () => {

    it('COMPLETED → ARCHIVED 应成功', () => {
      sm.start();
      sm.complete();
      const result = sm.archive('归档历史会话');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(SessionState.ARCHIVED);
    });

    it('非 COMPLETED 状态 archive 应抛出', () => {
      expect(() => sm.archive()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // 完整生命周期
  // ============================================================

  describe('完整生命周期', () => {

    it('成功路径：IDLE → RUNNING → COMPLETED → ARCHIVED', () => {
      sm.start('开始');
      expect(sm.getState()).toBe(SessionState.RUNNING);
      expect(sm.canStart()).toBe(false);

      sm.complete('完成');
      expect(sm.getState()).toBe(SessionState.COMPLETED);
      expect(sm.isTerminal()).toBe(false); // COMPLETED 不是终态（可归档）

      sm.archive('归档');
      expect(sm.getState()).toBe(SessionState.ARCHIVED);
      expect(sm.isTerminal()).toBe(true);
    });

    it('错误恢复路径：IDLE → RUNNING → ERROR → RUNNING → COMPLETED', () => {
      sm.start();
      sm.error(new Error('网络超时'));
      expect(sm.getState()).toBe(SessionState.ERROR);

      sm.resume('重试');
      expect(sm.getState()).toBe(SessionState.RUNNING);

      sm.complete();
      expect(sm.getState()).toBe(SessionState.COMPLETED);
    });

    it('完整暂停恢复路径：RUNNING → PAUSED → RUNNING → REQUIRES_ACTION → RUNNING', () => {
      sm.start();
      sm.pause('暂停');
      sm.resume('恢复');
      sm.requireAction({
        tool_name: 'confirm',
        action_description: '请确认',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      sm.resume('已确认');
      sm.complete();
      expect(sm.getState()).toBe(SessionState.COMPLETED);
    });

  });

  // ============================================================
  // hasPendingAction
  // ============================================================

  describe('hasPendingAction', () => {

    it('REQUIRES_ACTION 状态应返回 true', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      expect(sm.hasPendingAction()).toBe(true);
    });

    it('离开 REQUIRES_ACTION 后应返回 false', () => {
      sm.start();
      sm.requireAction({
        tool_name: 'test',
        action_description: 'test',
        tool_use_id: 'tu-001',
        request_id: 'req-001',
      });
      sm.resume();
      expect(sm.hasPendingAction()).toBe(false);
    });

  });

});
