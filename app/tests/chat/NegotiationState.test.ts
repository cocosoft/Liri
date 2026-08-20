/**
 * NegotiationState 单元测试
 *
 * 覆盖：
 *  - createNegotiationState：初始状态创建
 *  - transition：状态机转换合法性
 *  - addPendingQuestion / recordAnswer：问答队列管理
 *  - hasPendingRestoration：挂起恢复检测
 *  - saveNegotiationState / loadNegotiationState：持久化往返
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import {
  createNegotiationState,
  transition,
  addPendingQuestion,
  recordAnswer,
  hasPendingRestoration,
  saveNegotiationState,
  loadNegotiationState,
  deleteNegotiationState,
  type NegotiationState,
} from '../../src/chat/services/NegotiationState.js';
import type { PendingQuestion } from '../../src/chat/services/DecisionGate.js';

const TEST_SESSION_ID = 'test-negotiation-session';

describe('NegotiationState', () => {
  let state: NegotiationState;

  beforeEach(() => {
    state = createNegotiationState(TEST_SESSION_ID, { tier: 'moderate' });
  });

  afterEach(() => {
    deleteNegotiationState(TEST_SESSION_ID);
  });

  // ─── createNegotiationState ────────────────────────────

  describe('createNegotiationState', () => {
    it('创建初始状态', () => {
      expect(state.sessionId).toBe(TEST_SESSION_ID);
      expect(state.phase).toBe('idle');
      expect(state.pending).toEqual([]);
      expect(state.awaitingUser).toBe(false);
      expect(state.answered).toEqual({});
      expect(state.tier).toBe('moderate');
      expect(state.timeoutMs).toBe(5 * 60 * 1000);
    });

    it('支持自定义 tier 和 timeoutMs', () => {
      const custom = createNegotiationState('custom', {
        tier: 'strict',
        timeoutMs: 10000,
      });
      expect(custom.tier).toBe('strict');
      expect(custom.timeoutMs).toBe(10000);
    });
  });

  // ─── transition ───────────────────────────────────────

  describe('transition', () => {
    it('idle → analyzing 合法', () => {
      const result = transition(state, 'analyzing');
      expect(result.phase).toBe('analyzing');
    });

    it('analyzing → awaiting_confirm 合法', () => {
      transition(state, 'analyzing');
      const result = transition(state, 'awaiting_confirm');
      expect(result.phase).toBe('awaiting_confirm');
    });

    it('analyzing → executing 合法（无决策点）', () => {
      transition(state, 'analyzing');
      const result = transition(state, 'executing');
      expect(result.phase).toBe('executing');
    });

    it('awaiting_confirm → executing 合法（用户确认）', () => {
      transition(state, 'analyzing');
      transition(state, 'awaiting_confirm');
      const result = transition(state, 'executing');
      expect(result.phase).toBe('executing');
    });

    it('executing → awaiting_review 合法（子任务完成）', () => {
      transition(state, 'analyzing');
      transition(state, 'executing');
      const result = transition(state, 'awaiting_review');
      expect(result.phase).toBe('awaiting_review');
    });

    it('awaiting_review → executing 合法（用户确认继续）', () => {
      transition(state, 'analyzing');
      transition(state, 'executing');
      transition(state, 'awaiting_review');
      const result = transition(state, 'executing');
      expect(result.phase).toBe('executing');
    });

    it('awaiting_review → analyzing 合法（用户要求调整）', () => {
      transition(state, 'analyzing');
      transition(state, 'executing');
      transition(state, 'awaiting_review');
      const result = transition(state, 'analyzing');
      expect(result.phase).toBe('analyzing');
    });

    it('executing → done 合法（全部完成）', () => {
      transition(state, 'analyzing');
      transition(state, 'executing');
      const result = transition(state, 'done');
      expect(result.phase).toBe('done');
    });

    it('idle → executing 非法（不返回状态）', () => {
      const result = transition(state, 'executing');
      expect(result.phase).toBe('idle');
    });

    it('done → analyzing 非法（不返回状态）', () => {
      transition(state, 'analyzing');
      transition(state, 'executing');
      transition(state, 'done');
      const result = transition(state, 'analyzing');
      expect(result.phase).toBe('done');
    });
  });

  // ─── addPendingQuestion / recordAnswer ─────────────────

  describe('addPendingQuestion & recordAnswer', () => {
    const question: PendingQuestion = {
      id: 'q_test_1',
      type: 'confirm',
      question: '是否继续？',
      rationale: '需要用户确认',
      stage: 'execute',
      askedAt: Date.now(),
    };

    it('addPendingQuestion 添加问题并设 awaitingUser=true', () => {
      const result = addPendingQuestion(state, question);
      expect(result.pending).toHaveLength(1);
      expect(result.pending[0].id).toBe('q_test_1');
      expect(result.awaitingUser).toBe(true);
      expect(result.askedAt).toBeDefined();
    });

    it('recordAnswer 记录答案并从队列移除', () => {
      addPendingQuestion(state, question);
      const result = recordAnswer(state, 'q_test_1', '确认');
      expect(result.answered['q_test_1']).toBe('确认');
      expect(result.pending).toHaveLength(0);
      expect(result.awaitingUser).toBe(false);
      expect(result.askedAt).toBeUndefined();
    });

    it('多个待确认问题：回答一个后仍有 pending', () => {
      const q2: PendingQuestion = {
        id: 'q_test_2',
        type: 'choice',
        question: '选择方案？',
        options: ['A', 'B'],
        rationale: '需要用户选择',
        stage: 'plan',
      };
      addPendingQuestion(state, question);
      addPendingQuestion(state, q2);
      const result = recordAnswer(state, 'q_test_1', '确认');
      expect(result.pending).toHaveLength(1);
      expect(result.awaitingUser).toBe(true);
    });
  });

  // ─── hasPendingRestoration ────────────────────────────

  describe('hasPendingRestoration', () => {
    it('null 状态返回 false', () => {
      expect(hasPendingRestoration(null)).toBe(false);
    });

    it('awaitingUser=false 返回 false', () => {
      state.awaitingUser = false;
      expect(hasPendingRestoration(state)).toBe(false);
    });

    it('awaitingUser=true 但 pending 为空返回 false', () => {
      state.awaitingUser = true;
      state.pending = [];
      expect(hasPendingRestoration(state)).toBe(false);
    });

    it('awaitingUser=true 且 pending 非空返回 true', () => {
      const question: PendingQuestion = {
        id: 'q_restore',
        type: 'confirm',
        question: '恢复提问？',
        rationale: '应用重启后恢复',
        stage: 'execute',
      };
      addPendingQuestion(state, question);
      expect(hasPendingRestoration(state)).toBe(true);
    });
  });

  // ─── 持久化往返 ────────────────────────────────────────

  describe('saveNegotiationState & loadNegotiationState', () => {
    it('保存后能加载回来', () => {
      transition(state, 'analyzing');
      const question: PendingQuestion = {
        id: 'q_persist',
        type: 'choice',
        question: '选择？',
        options: ['A', 'B'],
        rationale: '持久化测试',
        stage: 'plan',
      };
      addPendingQuestion(state, question);

      saveNegotiationState(state);
      const loaded = loadNegotiationState(TEST_SESSION_ID);

      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(TEST_SESSION_ID);
      expect(loaded!.phase).toBe('analyzing');
      expect(loaded!.pending).toHaveLength(1);
      expect(loaded!.pending[0].id).toBe('q_persist');
      expect(loaded!.awaitingUser).toBe(true);
    });

    it('未保存时加载返回 null', () => {
      deleteNegotiationState(TEST_SESSION_ID);
      const loaded = loadNegotiationState(TEST_SESSION_ID);
      expect(loaded).toBeNull();
    });

    it('删除后加载返回 null', () => {
      saveNegotiationState(state);
      deleteNegotiationState(TEST_SESSION_ID);
      const loaded = loadNegotiationState(TEST_SESSION_ID);
      expect(loaded).toBeNull();
    });
  });
});
