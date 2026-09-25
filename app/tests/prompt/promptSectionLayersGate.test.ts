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
 * 提示词段落登记门禁（2026-09-25，N-60 根因防复发）
 *
 * 背景：`promptSectionLayers.SECTION_META` 是**可见性白名单**，而
 * 「**未登记 = 仅 full 模式可见**」是隐式规则 —— 新增静态段漏登记会**静默失效**
 * （不报错、不进提示词、无任何可观测信号）。实机踩过：`outputArtifactBoundary`
 * 在 `mode=conversation` 下完全不注入，两次实机验证才暴露。
 *
 * 两道防线：
 * 1. **编译期**（`satisfies Record<StaticPromptSectionName, PromptSectionMeta>`）——
 *    新增静态段漏登记 ⇒ `bun run typecheck` 报缺键；
 * 2. **本用例**（运行时穷尽断言）—— 覆盖任何绕过类型推导的注册路径，
 *    并对 N-60 的具体场景加回归锁。
 */
import { describe, it, expect } from 'bun:test';
import { getRegisteredSections } from '../../src/constants/systemPromptSections';
import {
  isSectionDeclared,
  isSectionVisibleIn,
} from '../../src/services/prompt/promptSectionLayers';

describe('提示词段落登记门禁', () => {
  it('DEFAULT_SECTIONS 的每一段都在 SECTION_META 显式登记（漏登记 = 仅 full = 静默失效）', () => {
    const names = getRegisteredSections().map((s) => s.name);
    expect(names.length).toBeGreaterThan(0);
    const undeclared = names.filter((n) => !isSectionDeclared(n));
    expect(undeclared).toEqual([]);
  });

  it('N-60 回归锁：outputArtifactBoundary 在四个模式均可见（含 conversation）', () => {
    for (const mode of ['full', 'conversation', 'minimal', 'local'] as const) {
      expect(isSectionVisibleIn('outputArtifactBoundary', mode)).toBe(true);
    }
    // none 模式只保留 identity（最小存活前缀）
    expect(isSectionVisibleIn('outputArtifactBoundary', 'none')).toBe(false);
  });

  it('未登记段确实仅 full 可见（门禁存在的理由本身被锁定）', () => {
    expect(isSectionVisibleIn('__not_declared__', 'conversation')).toBe(false);
    expect(isSectionVisibleIn('__not_declared__', 'full')).toBe(true);
  });

  it('W2/Y：outputArtifactBoundary 必须含「无项目时向用户索取 + 禁止瞎搜 + 禁止顶替」指引', () => {
    const sec = getRegisteredSections().find(
      (s) => s.name === 'outputArtifactBoundary'
    );
    if (!sec) throw new Error('outputArtifactBoundary 未登记（门禁应已拦截）');
    const text = String(sec.compute());
    expect(text).toContain('向用户询问项目');
    expect(text).toContain('不要用 `grep`/`glob`/`read` 在工作区里搜寻项目');
    expect(text).toContain('write_project_file');
  });
});
