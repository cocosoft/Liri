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
 * S4 同源门禁（T1-11）：T4.2 验证 + Landlock 显式 N/A。
 *
 * 取证结论（S4 第一步）：
 *  - 侧车 `lsp` 工具经**同一装配链**进入**同一** `ToolRegistry` ——
 *    `getBuiltinToolLoaders()` → `cond(coreFeature('LSP'), selectLspToolLoader())`
 *    （`tools/utils/ToolManagerUtils.ts:207,94-97`）⇒ **天然**经
 *    `chat/ReActToolLoop.ts:1145` 的 `pathGuard.checkToolCall`；
 *  - PathGuard 的路径入参判定由**运行期注册表**派生（`resolveToolParamNames`，
 *    `tools/ToolRegistry.ts:817`）⇒ 侧车工具声明的 `file_path`（∈ `PATH_ARG_KEYS`）被纳入拒绝列表检查；
 *  - 结果上限：侧车工具 `maxResultSizeChars=10000`（与内置 deep-equal）+ 同一 `ToolResultBudget` 路径。
 *
 * ⚠️ T4.1 口径并列（计划原文 vs S2 锁定不变量冲突；本切片**不**改名）：
 *  - 计划原文 T4.1 写"经 `MCPToolBridge` 注册为 `${server}__${tool}`"；
 *  - S2 已锁定（`sidecarLspTool.test.ts:237`）侧车工具 `name='lsp'` 且 schema 与内置 deep-equal
 *    ⇒ 改名为 `${server}__${tool}` 会破坏该不变量。本切片取**保名派**：同一 registry + 同一门禁链
 *    （与 T4.1 的"目标/验收"本质一致 —— "进同一 ToolRegistry 自动获同套门禁"），**不改名**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  SidecarLspTool,
  SIDECAR_LSP_LANDLOCK_APPLICABILITY,
} from '../../../src/tools/sidecar/SidecarLspTool';
import { LSPToolAdapter } from '../../../src/tools/adapters/LSPToolAdapter';
import { getBuiltinToolLoaders } from '../../../src/tools/utils/ToolManagerUtils';
import {
  createToolRegistry,
  getToolRegistry,
  resolveToolParamNames,
  setToolRegistry,
  type ToolRegistry,
} from '../../../src/tools/ToolRegistry';
import { createPathGuard } from '../../../src/query/PathGuard';
import { PATH_ARG_KEYS } from '../../../src/query/tool-constants';
import { ToolResultBudget } from '../../../src/context/budget/ToolResultBudget';
import type { Tool } from '../../../src/tools/types/Tool';
import type { ToolFactory } from '../../../src/tools/ToolFactory';

const ENV_LSP = 'FEATURE_LSP';
const ENV_SIDECAR = 'FEATURE_TOOL_SIDECAR_LSP';

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

/** 最小 `ToolFactory` 替身：`createLSPTool` 返回**真实**内置适配器（覆盖开关关分支） */
const stubFactory = {
  create: (key: string): Tool =>
    key === 'createLSPTool'
      ? (new LSPToolAdapter() as unknown as Tool)
      : ({ name: key } as unknown as Tool),
} as unknown as ToolFactory;

/** 走**同一** loader 链取出 `lsp` 工具（开关 + 环境由调用方设置） */
function lspFromBuiltinLoaders(): Tool | undefined {
  return getBuiltinToolLoaders()
    .map((loader) => loader(stubFactory))
    .filter((t): t is Tool => t !== null)
    .find((t) => t.name === 'lsp');
}

describe('S4/T4.1（保名派）：侧车工具进同一 ToolRegistry（同一装配链）', () => {
  let savedLsp: string | undefined;
  let savedSidecar: string | undefined;
  beforeEach(() => {
    savedLsp = process.env[ENV_LSP];
    savedSidecar = process.env[ENV_SIDECAR];
    process.env[ENV_LSP] = 'true';
  });
  afterEach(() => {
    restoreEnv(ENV_LSP, savedLsp);
    restoreEnv(ENV_SIDECAR, savedSidecar);
  });

  it('开关开 ⇒ 同一 loader 链产出侧车适配器，name 恒为 "lsp"（非 mcp__…，非 ${server}__${tool}）', () => {
    process.env[ENV_SIDECAR] = 'true';
    const lsp = lspFromBuiltinLoaders();
    expect(lsp).toBeInstanceOf(SidecarLspTool);
    expect(lsp?.name).toBe('lsp');
  });

  it('注册进同一 ToolRegistry：getTool("lsp") 命中该侧车工具（同源注册）', () => {
    process.env[ENV_SIDECAR] = 'true';
    const lsp = lspFromBuiltinLoaders();
    expect(lsp).toBeInstanceOf(SidecarLspTool);
    const registry = createToolRegistry();
    registry.registerTool(lsp!);
    expect(registry.getTool('lsp')).toBe(lsp);
  });

  it('开关关 ⇒ 同一 loader 链产出内置 LSPToolAdapter（逐字等价现状）', () => {
    delete process.env[ENV_SIDECAR];
    const lsp = lspFromBuiltinLoaders();
    expect(lsp).toBeInstanceOf(LSPToolAdapter);
    expect(lsp).not.toBeInstanceOf(SidecarLspTool);
  });
});

describe('S4/T4.2 PathGuard 同源门禁：注册表驱动判定覆盖侧车工具', () => {
  let savedRegistry: ToolRegistry;
  beforeEach(() => {
    savedRegistry = getToolRegistry();
  });
  afterEach(() => {
    setToolRegistry(savedRegistry);
  });

  it('侧车工具声明的 file_path 属"路径语义键"（⇒ 会被提取判定）', () => {
    const names = new SidecarLspTool().getInfo().params.map((p) => p.name);
    expect(names).toContain('file_path');
    expect(PATH_ARG_KEYS).toContain('file_path');
  });

  it('注册表含侧车 lsp ⇒ file_path 命中拒绝列表(.env) ⇒ 拦截；普通路径 ⇒ 放行', () => {
    const registry = createToolRegistry();
    registry.registerTool(new SidecarLspTool());
    setToolRegistry(registry);
    const guard = createPathGuard({
      resolvePathArgKeys: resolveToolParamNames,
    });

    const blocked = guard.checkToolCall('lsp', {
      action: 'hover',
      language: 'typescript',
      file_path: '/repo/.env',
      position: { line: 0, character: 0 },
    });
    expect(blocked.allowed).toBe(false);

    const allowed = guard.checkToolCall('lsp', {
      action: 'hover',
      language: 'typescript',
      file_path: '/repo/src/a.ts',
      position: { line: 0, character: 0 },
    });
    expect(allowed.allowed).toBe(true);
  });

  it('对照：未注入注册表解析器时同一调用放行（证明是注册表驱动的净收紧）', () => {
    const guard = createPathGuard();
    expect(
      guard.checkToolCall('lsp', { file_path: '/repo/.env' }).allowed
    ).toBe(true);
  });
});

describe('S4/T4.2 结果上限：与内置同源（同一 maxResultSizeChars + 同一预算器）', () => {
  it('侧车工具 maxResultSizeChars 与内置逐字一致（deep-equal ⇒ 同源）', () => {
    expect(new SidecarLspTool().maxResultSizeChars).toBe(
      new LSPToolAdapter().maxResultSizeChars
    );
    expect(new SidecarLspTool().maxResultSizeChars).toBe(10000);
  });

  it('同一 ToolResultBudget：超限内容被截断、未超限内容原样返回', () => {
    const budget = new ToolResultBudget({
      maxResultSizeChars: 10000,
      maxResultTokens: 10_000_000,
    });
    const big = budget.apply('x'.repeat(20000), 'tc-big');
    expect(big.truncated).toBe(true);
    expect(big.content).toContain('已截断');

    const small = budget.apply('hello', 'tc-small');
    expect(small.truncated).toBe(false);
    expect(small.content).toBe('hello');
  });
});

describe('S4/T4.2 Landlock：只读 LSP 查询 ⇒ 显式 N/A（不装作同源）', () => {
  it('显式声明：applies=false 且有非空理由', () => {
    expect(SIDECAR_LSP_LANDLOCK_APPLICABILITY.applies).toBe(false);
    expect(SIDECAR_LSP_LANDLOCK_APPLICABILITY.reason.length).toBeGreaterThan(0);
  });
});
