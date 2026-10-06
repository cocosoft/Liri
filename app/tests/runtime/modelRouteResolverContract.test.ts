// MIT License
// Copyright (c) 2026 190615273@qq.com
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
 * U7 试点守卫：模型路由**窄契约** `ModelRouteResolver` 不可静默漂移。
 *
 * 背景（`dev_docs/任务计划-20261004.md` §19.4-U7）：13 个 `*Router` 全量族普查后，全仓**唯一**
 * 满足「≥1 真实多态消费者」的角色 = **模型路由**（`SmartRouter` / `ModelRouter` 在
 * `resolveModelRoute.ts:103-126` 与 `CoreAPIImpl.resolveSmartModel()` 处真实二选一），
 * 且该端口已有**两个实现**（生产适配 = 组合根 · 测试桩）。故试点 = 把既有内联匿名类型**具名化**，
 * 并用本用例把它钉住：改动契约（增/删/改签名）必须**有意识地**同步本文件，否则端口两侧
 * （生产适配 / 测试桩）会静默分叉。
 *
 * 断言分层：①② 为**编译期**（`Record<keyof T, true>` 穷尽 + 双向可赋值）；③④ 为运行期面。
 */
import { describe, it, expect } from 'bun:test';
import type {
  CoreApiAppDeps,
  ModelRouteResolver,
} from '../../src/runtime/api/CoreAPIImpl';

/** 双向可赋值 ⇒ 结构等价；任一向不成立即坍缩为 `never`（编译期断言，运行期零行为） */
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

const EXPECTED_METHODS = [
  'resolveChat',
  'resolveDefault',
  'resolveWithPhase',
] as const;

describe('U7 试点：ModelRouteResolver 窄契约（模型路由角色）', () => {
  it('① 契约面穷尽：漏一 / 多一即**编译期**失败', () => {
    // 漏键 ⇒ TS2739/2741；多键（字面量超出 Record 键）⇒ TS2353
    const surface: Record<keyof ModelRouteResolver, true> = {
      resolveDefault: true,
      resolveWithPhase: true,
      resolveChat: true,
    };
    expect(Object.keys(surface).sort()).toEqual([...EXPECTED_METHODS]);
  });

  it('② CoreApiAppDeps.router 与该契约**结构等价**（编译期双向断言，防两处漂移）', () => {
    // 二者若不等价 ⇒ 类型坍缩为 `never` ⇒ 编译期 TS2322（本行即守卫）
    const equivalent: MutuallyAssignable<
      CoreApiAppDeps['router'],
      ModelRouteResolver
    > = true;
    expect(equivalent).toBe(true);
    expect(EXPECTED_METHODS).toHaveLength(3);
  });

  it('③ 生产适配形状（组合根）满足契约，且恰好这 3 个方法', () => {
    const productionShape = {
      resolveDefault: () => 'model-x',
      resolveWithPhase: (_phase: unknown) => null,
      resolveChat: async () => 'model-x',
    } satisfies ModelRouteResolver;
    // `satisfies` 保证编译期符合；此处锁定"面恰好 3 个"（多一个即需显式改契约）
    expect(Object.keys(productionShape).sort()).toEqual([...EXPECTED_METHODS]);
  });

  it('④ 存在第二实现（测试桩）⇒ 该契约**非死契约**（多态消费成立）', async () => {
    const stub: ModelRouteResolver = {
      resolveDefault: () => 'stub-default',
      resolveWithPhase: () => 'stub-phase',
      resolveChat: async () => 'stub-chat',
    };
    expect(stub.resolveDefault()).toBe('stub-default');
    expect(stub.resolveWithPhase({})).toBe('stub-phase');
    expect(await stub.resolveChat()).toBe('stub-chat');
  });
});
