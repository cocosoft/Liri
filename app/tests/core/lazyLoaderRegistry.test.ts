// MIT License
// Copyright (c) 2026 Liri
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 按需加载器注册表（core 独立包 P2）自证。
 *
 * 覆盖**双 API 语义**（复审 G3 的核心分歧点）：
 *   · `has*` 在变体缺席时返回 false（合法结果，**不得抛错**）；
 *   · `require*` 在执行路径缺失时抛 `AppError`（fail-closed，错误码固定）。
 * 另覆盖：重复注册 fail-closed、批量注册、list/reset。
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  getLazyLoader,
  hasLazyLoader,
  listLazyLoaderIds,
  registerLazyLoader,
  registerLazyLoaders,
  requireLazyLoader,
  resetLazyLoaders,
} from '@openliri/kernel';
import { AppError } from '@modules/error';
import {
  registerKernelLazyLoaders,
  resetKernelLazyLoadersRegistration,
} from '../../src/bootstrap/registerKernelLazyLoaders';

afterEach(() => {
  resetLazyLoaders();
});

describe('按需加载器注册表：注册与查询', () => {
  it('注册后可查询、可加载', async () => {
    registerLazyLoader('demo', async () => ({ value: 42 }));

    expect(hasLazyLoader('demo')).toBe(true);
    expect(typeof getLazyLoader('demo')).toBe('function');
    await expect(requireLazyLoader('demo')()).resolves.toEqual({ value: 42 });
  });

  it('批量注册 + listLazyLoaderIds 稳定排序', () => {
    registerLazyLoaders({
      beta: async () => ({}),
      alpha: async () => ({}),
    });

    expect(listLazyLoaderIds()).toEqual(['alpha', 'beta']);
  });
});

describe('按需加载器注册表：宿主生成物接线', () => {
  it('registerKernelLazyLoaders 用真实生成物注册，且幂等', () => {
    resetLazyLoaders();
    resetKernelLazyLoadersRegistration();

    registerKernelLazyLoaders();
    const ids = listLazyLoaderIds();

    // 开发默认（default 全量）⇒ 8 个基础 + ink/ui
    for (const id of [
      'featureflags',
      'memory',
      'chronos',
      'lsp',
      'mcp',
      'security',
      'sandbox',
      'voice',
      'ink',
      'ui',
    ]) {
      expect(ids).toContain(id);
    }

    // 幂等：重复调用不得触发「重复注册」的 fail-closed
    expect(() => registerKernelLazyLoaders()).not.toThrow();
  });
});

describe('按需加载器注册表：双 API 语义（能力查询 vs 执行路径）', () => {
  it('未注册：has=false / get=undefined（变体缺席是正常结果，不抛错）', () => {
    expect(hasLazyLoader('ink')).toBe(false);
    expect(getLazyLoader('ink')).toBeUndefined();
  });

  it('未注册：require 抛 AppError（错误码 CORE_LAZY_LOADER_NOT_REGISTERED）', () => {
    expect(() => requireLazyLoader('ink')).toThrow(AppError);
    try {
      requireLazyLoader('ink');
    } catch (err) {
      expect((err as AppError).code).toBe('CORE_LAZY_LOADER_NOT_REGISTERED');
      expect((err as AppError).context).toEqual({ moduleId: 'ink' });
    }
  });

  it('重复注册 ⇒ AppError（CORE_LAZY_LOADER_DUPLICATE）', () => {
    registerLazyLoader('dup', async () => ({}));
    try {
      registerLazyLoader('dup', async () => ({}));
      throw new Error('应当抛错');
    } catch (err) {
      expect((err as AppError).code).toBe('CORE_LAZY_LOADER_DUPLICATE');
    }
  });
});
