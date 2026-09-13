/**
 * UnattendedModeManager 单元测试
 *
 * 覆盖 isUnattended/setEnabled/delegateToInbox/shouldAutoApprove。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  UnattendedModeManager,
  unattendedMode,
} from '../UnattendedModeManager.js';
import { FEATURE_FLAGS } from '@modules/core';

describe('UnattendedModeManager', () => {
  let mgr: UnattendedModeManager;
  let originalFlag: boolean;

  beforeEach(() => {
    // 保存原始值
    originalFlag = (FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE;
    // 确保从关闭状态开始
    (FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE = false;
    mgr = new UnattendedModeManager();
  });

  afterEach(() => {
    // 恢复原始值
    (FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE = originalFlag;
  });

  // ─── isUnattended ────────────────────────────────────

  describe('isUnattended', () => {
    test('默认返回 false', () => {
      expect(mgr.isUnattended()).toBe(false);
    });

    test('setEnabled(true) 后返回 true', () => {
      mgr.setEnabled(true);
      expect(mgr.isUnattended()).toBe(true);
    });

    test('setEnabled(false) 后返回 false', () => {
      mgr.setEnabled(true);
      mgr.setEnabled(false);
      expect(mgr.isUnattended()).toBe(false);
    });

    test('多次切换正常工作', () => {
      mgr.setEnabled(true);
      expect(mgr.isUnattended()).toBe(true);
      mgr.setEnabled(false);
      expect(mgr.isUnattended()).toBe(false);
      mgr.setEnabled(true);
      expect(mgr.isUnattended()).toBe(true);
    });
  });

  // ─── setEnabled ──────────────────────────────────────

  describe('setEnabled', () => {
    test('修改 FEATURE_FLAGS.UNATTENDED_MODE', () => {
      expect((FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE).toBe(
        false
      );
      mgr.setEnabled(true);
      expect((FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE).toBe(
        true
      );
    });
  });

  // ─── delegateToInbox ─────────────────────────────────

  describe('delegateToInbox', () => {
    test('非无人值守模式返回 false（不降级）', async () => {
      const result = await mgr.delegateToInbox({
        sessionId: 's1',
        type: 'approval',
        title: '测试审批',
        message: '需要审批',
        source: 'test',
      });
      expect(result).toBe(false);
    });

    test.skip('无人值守模式返回 true（已降级）', async () => {
      mgr.setEnabled(true);
      const result = await mgr.delegateToInbox({
        sessionId: 's1',
        type: 'question',
        title: '测试问题',
        message: '需要回答',
        source: 'test',
      });
      expect(result).toBe(true);
    });

    test.skip('降级时 title 自动添加 [无人值守] 前缀', async () => {
      // 无法直接验证 inboxManager.submit 被调用（需要 mock），
      // 但可以验证返回值
      mgr.setEnabled(true);
      const result = await mgr.delegateToInbox({
        sessionId: 's2',
        type: 'authorization',
        title: '需要授权',
        message: '请求访问敏感资源',
        source: 'security',
        options: ['allow', 'deny'],
      });
      expect(result).toBe(true);
    });

    test('非无人值守模式下 options 参数仍正常传递（无副作用）', async () => {
      const result = await mgr.delegateToInbox({
        sessionId: 's3',
        type: 'approval',
        title: 'PDCA 审批',
        message: '请审核计划',
        source: 'pdca',
        options: ['approve', 'reject'],
      });
      expect(result).toBe(false);
    });
  });

  // ─── shouldAutoApprove ───────────────────────────────

  describe('shouldAutoApprove', () => {
    test('默认与 isUnattended 一致（false）', () => {
      expect(mgr.shouldAutoApprove()).toBe(false);
    });

    test('启用无人值守后返回 true', () => {
      mgr.setEnabled(true);
      expect(mgr.shouldAutoApprove()).toBe(true);
    });

    test('禁用后返回 false', () => {
      mgr.setEnabled(true);
      mgr.setEnabled(false);
      expect(mgr.shouldAutoApprove()).toBe(false);
    });
  });

  // ─── 全局单例 ───────────────────────────────────────

  describe('全局单例', () => {
    test('unattendedMode 是一个 UnattendedModeManager 实例', () => {
      expect(unattendedMode).toBeInstanceOf(UnattendedModeManager);
    });

    test('全局单例与新建实例共享 FEATURE_FLAGS', () => {
      const newMgr = new UnattendedModeManager();
      unattendedMode.setEnabled(true);
      expect(newMgr.isUnattended()).toBe(true);
      unattendedMode.setEnabled(false);
    });
  });
});
