/**
 * DecisionGate 单元测试
 *
 * 覆盖：
 *  - classifySignal：四类信号判定
 *  - isIntercepted：三档门控拦截规则
 *  - shouldAsk：端到端门控检查
 *  - checkTimeout / defaultAnswerForTimeout：超时降级
 */

import { describe, it, expect } from 'bun:test';
import {
  classifySignal,
  isIntercepted,
  shouldAsk,
  checkTimeout,
  defaultAnswerForTimeout,
  type GateTier,
  type StepContext,
  type PendingQuestion,
} from '../../src/chat/services/DecisionGate.js';

describe('DecisionGate', () => {
  // ─── classifySignal ────────────────────────────────────

  describe('classifySignal', () => {
    it('检测 external_action 信号（白名单工具）', () => {
      const step: StepContext = {
        toolName: 'send_message',
        toolInput: { channel: 'email' },
      };
      const signal = classifySignal(step);
      expect(signal).not.toBeNull();
      expect(signal!.kind).toBe('external_action');
    });

    it('检测 selection 信号（含 model 字段）', () => {
      const step: StepContext = {
        toolName: 'generate_content',
        toolInput: { model: 'gpt-4', content: 'hello' },
      };
      const signal = classifySignal(step);
      expect(signal).not.toBeNull();
      expect(signal!.kind).toBe('selection');
      expect((signal as { field: string }).field).toBe('model');
    });

    it('检测 unexpected_result 信号（上一轮失败）', () => {
      const step: StepContext = {
        toolName: 'read_file',
        toolInput: { path: '/tmp/test.txt' },
        prevResult: { success: false, error: 'File not found' },
      };
      const signal = classifySignal(step);
      expect(signal).not.toBeNull();
      expect(signal!.kind).toBe('unexpected_result');
    });

    it('检测 scope_drift 信号（大纲节点变化 >20%）', () => {
      const step: StepContext = {
        toolName: 'update_outline',
        toolInput: {},
        outlineNodeCount: 15,
        baselineNodeCount: 10,
      };
      const signal = classifySignal(step);
      expect(signal).not.toBeNull();
      expect(signal!.kind).toBe('scope_drift');
      expect((signal as { deltaPct: number }).deltaPct).toBe(50);
    });

    it('无信号时返回 null', () => {
      const step: StepContext = {
        toolName: 'read_file',
        toolInput: { path: '/tmp/test.txt' },
      };
      const signal = classifySignal(step);
      expect(signal).toBeNull();
    });

    it('scope_drift 变化 <=20% 不触发', () => {
      const step: StepContext = {
        toolName: 'update_outline',
        toolInput: {},
        outlineNodeCount: 11,
        baselineNodeCount: 10,
      };
      const signal = classifySignal(step);
      expect(signal).toBeNull();
    });
  });

  // ─── isIntercepted ────────────────────────────────────

  describe('isIntercepted', () => {
    const signals = {
      selection: {
        kind: 'selection' as const,
        toolName: 'gen',
        field: 'model',
      },
      scopeDrift: {
        kind: 'scope_drift' as const,
        deltaPct: 50,
        detail: 'test',
      },
      externalAction: {
        kind: 'external_action' as const,
        toolName: 'send_message',
      },
      unexpectedResult: {
        kind: 'unexpected_result' as const,
        toolName: 'read',
        detail: 'fail',
      },
    };

    it('strict 拦截全部四类信号', () => {
      const tier: GateTier = 'strict';
      expect(isIntercepted(signals.selection, tier)).toBe(true);
      expect(isIntercepted(signals.scopeDrift, tier)).toBe(true);
      expect(isIntercepted(signals.externalAction, tier)).toBe(true);
      expect(isIntercepted(signals.unexpectedResult, tier)).toBe(true);
    });

    it('moderate 仅拦截 external_action + unexpected_result', () => {
      const tier: GateTier = 'moderate';
      expect(isIntercepted(signals.selection, tier)).toBe(false);
      expect(isIntercepted(signals.scopeDrift, tier)).toBe(false);
      expect(isIntercepted(signals.externalAction, tier)).toBe(true);
      expect(isIntercepted(signals.unexpectedResult, tier)).toBe(true);
    });

    it('relaxed 仅拦截 external_action', () => {
      const tier: GateTier = 'relaxed';
      expect(isIntercepted(signals.selection, tier)).toBe(false);
      expect(isIntercepted(signals.scopeDrift, tier)).toBe(false);
      expect(isIntercepted(signals.externalAction, tier)).toBe(true);
      expect(isIntercepted(signals.unexpectedResult, tier)).toBe(false);
    });
  });

  // ─── shouldAsk ────────────────────────────────────────

  describe('shouldAsk', () => {
    it('无信号时放行（返回 null）', () => {
      const step: StepContext = {
        toolName: 'read_file',
        toolInput: { path: '/tmp/test.txt' },
      };
      expect(shouldAsk(step, 'strict')).toBeNull();
    });

    it('信号未被拦截时放行（返回 null）', () => {
      const step: StepContext = {
        toolName: 'generate_content',
        toolInput: { model: 'gpt-4' },
      };
      // moderate 不拦截 selection
      expect(shouldAsk(step, 'moderate')).toBeNull();
    });

    it('信号被拦截时返回 PendingQuestion', () => {
      const step: StepContext = {
        toolName: 'send_message',
        toolInput: { channel: 'email' },
      };
      const q = shouldAsk(step, 'relaxed');
      expect(q).not.toBeNull();
      expect(q!.type).toBe('confirm');
      expect(q!.stage).toBe('execute');
      expect(q!.askedAt).toBeDefined();
    });

    it('plan 阶段标记正确', () => {
      const step: StepContext = {
        toolName: 'deploy',
        toolInput: {},
      };
      const q = shouldAsk(step, 'moderate', 'plan');
      expect(q).not.toBeNull();
      expect(q!.stage).toBe('plan');
    });

    it('unexpected_result 返回 choice 类型并带选项', () => {
      const step: StepContext = {
        toolName: 'read_file',
        toolInput: {},
        prevResult: { success: false, error: 'permission denied' },
      };
      const q = shouldAsk(step, 'moderate');
      expect(q).not.toBeNull();
      expect(q!.type).toBe('choice');
      expect(q!.options).toEqual(['重试', '跳过', '中止']);
    });
  });

  // ─── checkTimeout ──────────────────────────────────────

  describe('checkTimeout', () => {
    it('未超时返回 ok', () => {
      const askedAt = Date.now() - 10000; // 10 秒前
      expect(checkTimeout(askedAt, 5 * 60 * 1000)).toBe('ok');
    });

    it('接近超时返回 warn', () => {
      const askedAt = Date.now() - 5 * 60 * 1000; // 5 分钟前
      expect(checkTimeout(askedAt, 5 * 60 * 1000)).toBe('warn');
    });

    it('超时返回 timeout', () => {
      const askedAt = Date.now() - 10 * 60 * 1000; // 10 分钟前
      expect(checkTimeout(askedAt, 5 * 60 * 1000)).toBe('timeout');
    });
  });

  // ─── defaultAnswerForTimeout ──────────────────────────

  describe('defaultAnswerForTimeout', () => {
    it('choice 类型取首个选项', () => {
      const q: PendingQuestion = {
        id: 'test',
        type: 'choice',
        question: 'test',
        options: ['重试', '跳过', '中止'],
        rationale: 'test',
        stage: 'execute',
      };
      expect(defaultAnswerForTimeout(q)).toEqual(['重试']);
    });

    it('confirm 类型默认"确认"', () => {
      const q: PendingQuestion = {
        id: 'test',
        type: 'confirm',
        question: 'test',
        rationale: 'test',
        stage: 'execute',
      };
      expect(defaultAnswerForTimeout(q)).toEqual(['确认']);
    });

    it('open 类型返回 null（跳过）', () => {
      const q: PendingQuestion = {
        id: 'test',
        type: 'open',
        question: 'test',
        rationale: 'test',
        stage: 'execute',
      };
      expect(defaultAnswerForTimeout(q)).toBeNull();
    });
  });
});
