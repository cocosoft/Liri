/**
 * SessionStateMachine — 会话状态机单元测试（**3 态**，阶段 3 / 2026-10-12）
 *
 * 阶段 3 把 8 态收敛为 `idle`/`running`/`requires_action`。本测试锁三件事：
 * ① **折叠映射**（旧 `PAUSED/ERROR → requires_action`、`COMPLETED/ARCHIVED/ABORTED → idle`）不得漂移；
 * ② **转移表**（`SESSION_TRANSITIONS`）与**无终态/成环**语义；
 * ③ **幂等无操作**：`from === to` 由引擎早返回 true（3 态折叠后"同目标再触发"不新增异常面）。
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import { SessionStateMachine } from '../../../src/state/session/SessionStateMachine.js';
import { SESSION_TRANSITIONS } from '../../../src/state/session/types.js';
import { IllegalTransitionError } from '../../../src/state/errors.js';

/** 构造 requires_action 所需的最小详情 */
const actionDetails = {
  tool_name: 'code_review',
  action_description: '请审查代码变更',
  tool_use_id: 'tu-001',
  request_id: 'req-001',
};

describe('SessionStateMachine（3 态 · 阶段 3）', () => {
  let sm: SessionStateMachine;

  beforeEach(() => {
    sm = new SessionStateMachine('session-001');
  });

  // ============================================================
  // 转移表（唯一事实源）
  // ============================================================

  describe('SESSION_TRANSITIONS（3 态唯一事实源）', () => {
    it('恰好 3 个状态，且与目录登记的取值一致', () => {
      expect(Object.keys(SESSION_TRANSITIONS).sort()).toEqual([
        'idle',
        'requires_action',
        'running',
      ]);
    });

    it('边集与"8→3 折叠归并"结果一致', () => {
      expect([...SESSION_TRANSITIONS.idle]).toEqual(['running']);
      expect([...SESSION_TRANSITIONS.running].sort()).toEqual([
        'idle',
        'requires_action',
      ]);
      expect([...SESSION_TRANSITIONS.requires_action].sort()).toEqual([
        'idle',
        'running',
      ]);
    });

    it('3 态下无终态（生命周期成环：idle 可再次 start）', () => {
      for (const targets of Object.values(SESSION_TRANSITIONS)) {
        expect(targets.length).toBeGreaterThan(0);
      }
      expect(sm.isTerminal()).toBe(false);
    });
  });

  // ============================================================
  // 构造与初始状态
  // ============================================================

  describe('构造与初始状态', () => {
    it('初始状态应为 idle', () => {
      expect(sm.getState()).toBe('idle');
    });

    it('contextId 应与 sessionId 一致', () => {
      expect(sm.getContextId()).toBe('session-001');
    });

    it('初始应可启动、且无待处理动作', () => {
      expect(sm.canStart()).toBe(true);
      expect(sm.hasPendingAction()).toBe(false);
    });
  });

  // ============================================================
  // 折叠映射（阶段 3 的核心语义）
  // ============================================================

  describe('折叠映射（旧 8 态 → 3 态）', () => {
    it('start：idle → running', () => {
      expect(sm.start('用户发起会话')).toBe(true);
      expect(sm.getState()).toBe('running');
      expect(sm.canStart()).toBe(false);
    });

    it('requireAction：running → requires_action', () => {
      sm.start();
      expect(sm.requireAction(actionDetails)).toBe(true);
      expect(sm.getState()).toBe('requires_action');
      expect(sm.hasPendingAction()).toBe(true);
    });

    it('pause：running → requires_action（旧 PAUSED 折叠目标）', () => {
      sm.start();
      expect(sm.pause('用户暂停')).toBe(true);
      expect(sm.getState()).toBe('requires_action');
    });

    it('error：running → requires_action（旧 ERROR 折叠目标）+ 元数据', () => {
      sm.start();
      expect(sm.error(new Error('网络连接超时'))).toBe(true);
      expect(sm.getState()).toBe('requires_action');

      const record = sm.getHistory().at(-1);
      expect(record?.metadata?.name).toBe('Error');
      expect(record?.metadata?.stack).toBeString();
    });

    it('complete：running → idle（旧 COMPLETED 折叠目标）', () => {
      sm.start();
      expect(sm.complete('任务完成')).toBe(true);
      expect(sm.getState()).toBe('idle');
    });

    it('finish：running → idle（与 complete 同目标，语义侧重多轮循环）', () => {
      sm.start();
      expect(sm.finish('工具执行完成')).toBe(true);
      expect(sm.getState()).toBe('idle');
    });

    it('abort：running → idle（旧 ABORTED 折叠目标）', () => {
      sm.start();
      expect(sm.abort('手动中止')).toBe(true);
      expect(sm.getState()).toBe('idle');
    });
  });

  // ============================================================
  // 幂等无操作（引擎 from === to 早返回）
  // ============================================================

  describe('同目标再触发 = 幂等无操作（不抛、不记历史）', () => {
    it('已在 requires_action 时 pause() 返回 true 且状态/历史不变', () => {
      sm.start();
      sm.requireAction(actionDetails);
      const historyBefore = sm.getHistory().length;

      expect(sm.pause('重复暂停')).toBe(true);
      expect(sm.getState()).toBe('requires_action');
      expect(sm.getHistory().length).toBe(historyBefore);
    });

    it('已在 requires_action 时 error() 返回 true 且状态不变（旧表本就允许 REQUIRES_ACTION→ERROR）', () => {
      sm.start();
      sm.error(new Error('e1'));
      expect(sm.error(new Error('e2'))).toBe(true);
      expect(sm.getState()).toBe('requires_action');
    });

    it('已在 idle 时 abort() 返回 true 且状态不变', () => {
      expect(sm.abort('弃用')).toBe(true);
      expect(sm.getState()).toBe('idle');
    });
  });

  // ============================================================
  // 非法转移
  // ============================================================

  describe('非法转移抛 IllegalTransitionError', () => {
    it('idle 时 requireAction 应抛出', () => {
      expect(() => sm.requireAction(actionDetails)).toThrow(
        IllegalTransitionError
      );
    });

    it('idle 时 pause 应抛出', () => {
      expect(() => sm.pause()).toThrow(IllegalTransitionError);
    });

    it('idle 时 error 应抛出', () => {
      expect(() => sm.error(new Error('test'))).toThrow(IllegalTransitionError);
    });

    it('requires_action 时 start 合法（折叠必然：start 与 resume 同 target=running）；且与旧 8 态表一致', () => {
      sm.start();
      sm.requireAction(actionDetails);
      expect(sm.start('折叠后与 resume 同目标')).toBe(true);
      expect(sm.getState()).toBe('running');
    });
  });

  // ============================================================
  // 历史记录
  // ============================================================

  describe('历史记录', () => {
    it('requireAction 应把动作详情写入 metadata', () => {
      sm.start();
      sm.requireAction({ ...actionDetails, input: { file: 'src/main.ts' } });

      const record = sm.getHistory().at(-1);
      expect(record?.metadata?.tool_name).toBe('code_review');
      expect(record?.metadata?.tool_use_id).toBe('tu-001');
      expect(record?.metadata?.input).toEqual({ file: 'src/main.ts' });
    });
  });

  // ============================================================
  // 完整生命周期
  // ============================================================

  describe('完整生命周期（成环）', () => {
    it('idle → running → requires_action → running → idle → running（可再启动）', () => {
      sm.start();
      expect(sm.getState()).toBe('running');

      sm.requireAction(actionDetails);
      expect(sm.getState()).toBe('requires_action');

      sm.resume('用户已确认');
      expect(sm.getState()).toBe('running');

      sm.complete('完成');
      expect(sm.getState()).toBe('idle');
      expect(sm.canStart()).toBe(true);

      // 3 态无终态 ⇒ 同一会话可进入下一轮
      expect(sm.start('下一轮')).toBe(true);
      expect(sm.getState()).toBe('running');
    });

    it('错误恢复路径：running → requires_action → running → idle', () => {
      sm.start();
      sm.error(new Error('网络超时'));
      expect(sm.getState()).toBe('requires_action');

      sm.resume('重试');
      expect(sm.getState()).toBe('running');

      sm.finish();
      expect(sm.getState()).toBe('idle');
    });

    it('暂停恢复路径：running → requires_action(暂停) → running', () => {
      sm.start();
      sm.pause('暂停');
      expect(sm.getState()).toBe('requires_action');

      sm.resume('恢复');
      expect(sm.getState()).toBe('running');
    });
  });

  // ============================================================
  // 已删除 API（防回流）
  // ============================================================

  describe('阶段 3 删除项（防回流）', () => {
    it('archive() 已删除（3 态下 ARCHIVED 折叠为 idle，无独立目标）', () => {
      expect(
        (sm as unknown as Record<string, unknown>).archive
      ).toBeUndefined();
    });
  });
});
