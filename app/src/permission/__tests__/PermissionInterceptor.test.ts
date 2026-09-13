/**
 * PermissionInterceptor 权限读时拦截（T3.1）测试
 *
 * 对齐方案 T3.1 验收标准：
 * - 拦截层拒绝与既有检查器拒绝统一为同一错误码 + 统一提示文案
 * - set/check/intercept 能力工作正常
 * - 既有 permission/ 检查器无行为回归（拦截层独立，不侵入）
 */

import { describe, test, expect } from 'bun:test';
import {
  PermissionInterceptor,
  InterceptMeta,
} from '../intercept/PermissionInterceptor.js';
import { PermissionBehavior } from '../types/PermissionRule.js';
import { createDenyDecision } from '../PermissionResult.js';

describe('PermissionInterceptor（T3.1）', () => {
  describe('能力层', () => {
    test('set 后 check 读取拦截元数据', () => {
      const interceptor = new PermissionInterceptor();
      interceptor.set('file:write:/etc/passwd', { denyReason: '敏感路径' });

      const meta = interceptor.check('file:write:/etc/passwd');
      expect(meta?.denyReason).toBe('敏感路径');
    });

    test('未注册资源 check 返回 undefined（等待而非报错）', () => {
      const interceptor = new PermissionInterceptor();
      expect(interceptor.check('file:read:/tmp/ok.txt')).toBeUndefined();
    });
  });

  describe('读时拦截', () => {
    test('denyReason 存在 → 返回统一 deny 决策', () => {
      const interceptor = new PermissionInterceptor();
      interceptor.set('channel:send:admin', { denyReason: '超管通道受控' });

      const decision = interceptor.intercept('channel:send:admin');
      expect(decision).toBeDefined();
      expect(decision!.behavior).toBe(PermissionBehavior.DENY);
      expect(decision!.message).toContain('权限拦截');
    });

    test('无拦截元数据 → 返回 undefined（放行）', () => {
      const interceptor = new PermissionInterceptor();
      expect(interceptor.intercept('model:request:chat')).toBeUndefined();
    });
  });

  describe('错误归一化', () => {
    test('拦截层拒绝与既有检查器 createDenyDecision 结构一致', () => {
      const interceptor = new PermissionInterceptor();
      interceptor.set('tool:run:rm', { denyReason: '危险命令' });

      const interceptDecision = interceptor.intercept('tool:run:rm');
      const checkerDecision = createDenyDecision('Denied by rule from test');

      // 统一为 behavior: DENY + message 结构
      expect(interceptDecision!.behavior).toBe(checkerDecision.behavior);
      expect(typeof interceptDecision!.message).toBe('string');
      expect(interceptDecision!.message!.length).toBeGreaterThan(0);
    });
  });

  describe('清理', () => {
    test('clear 后拦截不再生效', () => {
      const interceptor = new PermissionInterceptor();
      interceptor.set('tool:run:rm', { denyReason: '危险命令' });
      expect(interceptor.intercept('tool:run:rm')).toBeDefined();

      interceptor.clear('tool:run:rm');
      expect(interceptor.intercept('tool:run:rm')).toBeUndefined();
    });
  });
});
