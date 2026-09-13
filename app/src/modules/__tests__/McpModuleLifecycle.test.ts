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
 * mcp 模块生命周期接线单测（P0-1/P0-3：模块化接线 + 阶段提升回归防护）
 */
import { describe, it, expect } from 'bun:test';
import {
  MODULE_DEFINITIONS,
  MODULE_INITIALIZATION_ORDER,
} from '../ModuleDefinitions';
import { getEssentialModuleIds } from '../LazyModuleStrategy';

describe('mcp 模块生命周期接线', () => {
  it('mcp 模块定义含 initialize/destroy 生命周期（P0-1）', () => {
    const def = MODULE_DEFINITIONS.mcp;
    expect(def).toBeDefined();
    expect(typeof def.initialize).toBe('function');
    expect(typeof def.destroy).toBe('function');
    // 依赖声明包含 doc 前置依赖所需的基础模块
    expect(def.dependencies).toContain('oauth');
    expect(def.dependencies).toContain('infrastructure');
  });

  it('mcp 在 CRITICAL 阶段且位于 doc 之前（P0-3）', () => {
    const mcpIdx = MODULE_INITIALIZATION_ORDER.indexOf('mcp');
    const docIdx = MODULE_INITIALIZATION_ORDER.indexOf('doc');
    const sessionIdx = MODULE_INITIALIZATION_ORDER.indexOf('session');
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(mcpIdx);
    // mcp 属于 CRITICAL 段（在 DEFERRED 段首 session 之前）
    expect(mcpIdx).toBeLessThan(sessionIdx);
  });

  it('mcp 在 LazyModuleStrategy 中为 CRITICAL（启动急切加载）', () => {
    const essential = getEssentialModuleIds(MODULE_INITIALIZATION_ORDER);
    expect(essential).toContain('mcp');
  });
});
