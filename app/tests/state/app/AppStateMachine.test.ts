/**
 * AppStateMachine — 应用状态机单元测试
 *
 * 覆盖所有便捷方法、合法/非法转移、错误元数据、状态查询。
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import { AppStateMachine, AppState } from '../../../src/state/app/index.js';
import { IllegalTransitionError } from '../../../src/state/errors.js';

describe('AppStateMachine', () => {

  let sm: AppStateMachine;

  beforeEach(() => {
    sm = new AppStateMachine('test-app');
  });

  // ============================================================
  // 构造
  // ============================================================

  describe('构造与初始状态', () => {

    it('初始状态应为 IDLE', () => {
      expect(sm.getState()).toBe(AppState.IDLE);
    });

    it('默认 appId 为 app', () => {
      const defaultSm = new AppStateMachine();
      expect(defaultSm.getContextId()).toBe('app');
    });

    it('初始应空闲', () => {
      expect(sm.isIdle()).toBe(true);
      expect(sm.isBusy()).toBe(false);
      expect(sm.hasError()).toBe(false);
    });

  });

  // ============================================================
  // setBusy
  // ============================================================

  describe('setBusy', () => {

    it('IDLE → BUSY 应成功', () => {
      const result = sm.setBusy('处理请求');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(AppState.BUSY);
      expect(sm.isIdle()).toBe(false);
      expect(sm.isBusy()).toBe(true);
    });

    it('非 IDLE 状态 setBusy 应抛出', () => {
      sm.setBusy();
      sm.setIdle();
      sm.pause();
      expect(() => sm.setBusy()).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // setIdle
  // ============================================================

  describe('setIdle', () => {

    it('BUSY → IDLE 应成功', () => {
      sm.setBusy();
      const result = sm.setIdle('完成');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(AppState.IDLE);
    });

    it('PAUSED → IDLE 应成功', () => {
      sm.pause();
      sm.setIdle();
      expect(sm.getState()).toBe(AppState.IDLE);
    });

    it('ERROR → IDLE 应成功', () => {
      sm.setBusy();
      sm.setError(new Error('db down'));
      const result = sm.setIdle('恢复');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(AppState.IDLE);
    });

  });

  // ============================================================
  // pause
  // ============================================================

  describe('pause', () => {

    it('IDLE → PAUSED 应成功', () => {
      const result = sm.pause('系统休眠');
      expect(result).toBe(true);
      expect(sm.getState()).toBe(AppState.PAUSED);
    });

    it('BUSY → PAUSED 应成功', () => {
      sm.setBusy();
      sm.pause();
      expect(sm.getState()).toBe(AppState.PAUSED);
    });

    it('ERROR → PAUSED 应成功', () => {
      sm.setBusy();
      sm.setError(new Error('error'));
      sm.pause('暂停排查');
      expect(sm.getState()).toBe(AppState.PAUSED);
    });

    it('PAUSED → PAUSED 同状态不应抛出', () => {
      sm.pause();
      const result = sm.pause();
      expect(result).toBe(true);
    });

  });

  // ============================================================
  // setError
  // ============================================================

  describe('setError', () => {

    it('BUSY → ERROR 应成功并携带错误信息', () => {
      sm.setBusy();
      const err = new Error('数据库连接失败');
      const result = sm.setError(err);
      expect(result).toBe(true);
      expect(sm.getState()).toBe(AppState.ERROR);
      expect(sm.hasError()).toBe(true);

      // 验证 metadata
      const history = sm.getHistory();
      const record = history[history.length - 1];
      expect(record.metadata).toBeDefined();
      expect(record.metadata?.name).toBe('Error');
      expect(record.metadata?.stack).toBeString();
    });

    it('非 BUSY 状态 setError 应抛出', () => {
      expect(() => sm.setError(new Error('test'))).toThrow(IllegalTransitionError);
    });

  });

  // ============================================================
  // 完整生命周期
  // ============================================================

  describe('完整生命周期', () => {

    it('正常路径：IDLE → BUSY → IDLE', () => {
      sm.setBusy('工作中');
      expect(sm.getState()).toBe(AppState.BUSY);
      sm.setIdle('空闲');
      expect(sm.getState()).toBe(AppState.IDLE);
    });

    it('暂停恢复：IDLE → BUSY → PAUSED → IDLE', () => {
      sm.setBusy();
      sm.pause('暂停');
      sm.setIdle('恢复');
      expect(sm.getState()).toBe(AppState.IDLE);
    });

    it('错误恢复：IDLE → BUSY → ERROR → IDLE', () => {
      sm.setBusy();
      sm.setError(new Error('崩溃'));
      expect(sm.getState()).toBe(AppState.ERROR);
      sm.setIdle('已修复');
      expect(sm.getState()).toBe(AppState.IDLE);
    });

  });

});
