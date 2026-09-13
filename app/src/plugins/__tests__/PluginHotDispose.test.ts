/**
 * 插件 HMR __hotDispose 增强（T3.3）测试
 *
 * 对齐方案 T3.3 验收标准：
 * 1. hasHotDisposeHook 正确识别声明了 __hotDispose 的插件实例
 * 2. isHotReloadEligible：未声明钩子的插件被保守拒绝（保留旧版本）
 * 3. plugin-sdk createPlugin 支持 __hotDispose 可选钩子
 */

import { describe, test, expect } from 'bun:test';
import {
  hasHotDisposeHook,
  isHotReloadEligible,
} from '../hotload/PluginHotloadManager.js';
import { createPlugin } from '../../plugin-sdk/core.js';

describe('插件 HMR __hotDispose（T3.3）', () => {
  describe('hasHotDisposeHook', () => {
    test('声明 __hotDispose 的实例 → true', () => {
      const instance = { __hotDispose: async () => {} };
      expect(hasHotDisposeHook(instance)).toBe(true);
    });

    test('未声明 → false（undefined / 普通对象 / null）', () => {
      expect(hasHotDisposeHook(undefined)).toBe(false);
      expect(hasHotDisposeHook({})).toBe(false);
      expect(hasHotDisposeHook(null)).toBe(false);
      expect(hasHotDisposeHook('string')).toBe(false);
    });
  });

  describe('isHotReloadEligible（保守拒绝）', () => {
    test('已声明钩子 → 允许热更', () => {
      const instance = { __hotDispose: () => {} };
      expect(isHotReloadEligible(instance, 'my-plugin')).toBe(true);
    });

    test('未声明钩子 → 拒绝热更（保留旧版本）', () => {
      expect(isHotReloadEligible({}, 'my-plugin')).toBe(false);
    });
  });

  describe('plugin-sdk createPlugin 契约', () => {
    test('createPlugin 支持 __hotDispose 可选钩子', () => {
      const plugin = createPlugin({
        id: 'hot-plugin',
        name: 'Hot Plugin',
        version: '1.0.0',
        description: '',
        author: 'demo',
        category: 'tool',
        __hotDispose: async () => {},
      });

      expect(typeof plugin.__hotDispose).toBe('function');
    });
  });
});
