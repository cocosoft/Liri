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
 * `tool_search` 检索覆盖面回归（2026-10-11 真机事故修复）。
 *
 * 事故：普通会话 `taskType:"default"` 的任务裁剪把 `bash`/`powershell` 从模型函数清单移除，
 * 而 `tool_search` 的**关键词分支只搜「延迟加载」工具** ⇒ 模型查 "execute shell command
 * bash …" 返回空 ⇒ 自述"环境无 shell 工具"，执行类任务无法验证产物（导出会话实证）。
 *
 * 锁定两条契约：
 *  1. 关键词分支覆盖**全量已注册工具**（含 alwaysLoad / 非延迟的内置工具）；
 *  2. 检索面**排除有意归档**工具（`ARCHIVED_MISC_TOOLS`，如 `computer_use`）——
 *     归档语义是"对模型永久不可见"，放宽检索不得成为绕过归档的旁路。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ToolSearchTool } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { getToolRegistry } from '../../src/tools/ToolRegistry';
import { ARCHIVED_MISC_TOOLS } from '../../src/tools/toolCategories';
import { BUILTIN_TOOL_FACTORIES } from '../../src/tools/factories/builtinToolRegistry';
import { getBuiltinToolFactoryKeys } from '../../src/tools/utils/ToolManagerUtils';
import type { Tool } from '../../src/tools/types/Tool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';
import type { ToolSearchOutput } from '../../src/tools/ToolSearchTool/schemas';

/** 单 token 名 ⇒ 关键词命中 `parsed.parts.includes(term)`（最高权重路径） */
const PROBE_NAME = 'zzzprobetool';
/** 有意归档工具名（须被检索面排除） */
const ARCHIVED_NAME = 'computer_use';

const registry = getToolRegistry();
let prevArchived: Tool | undefined;

function fakeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    params: [],
    searchHint: description,
    isMcp: false,
    // 关键：**非延迟**（alwaysLoad）—— 修复前关键词分支只搜延迟工具 ⇒ 不可命中
    shouldDefer: false,
    alwaysLoad: true,
    isEnabled: () => true,
    isReadOnly: () => true,
    execute: async () => ({ data: 'ok' }),
  } as unknown as Tool;
}

const ctx = {} as unknown as ToolUseContext;

async function search(query: string): Promise<string[]> {
  const r = await new ToolSearchTool().execute({ query }, ctx);
  return (r.data as { matches: string[] }).matches;
}

beforeAll(() => {
  prevArchived = registry.getTool(ARCHIVED_NAME);
  registry.registerTool(fakeTool(PROBE_NAME, 'execute shell command probe'));
  registry.registerTool(fakeTool(ARCHIVED_NAME, 'control desktop computer'));
});

afterAll(() => {
  registry.unregisterTool(PROBE_NAME);
  registry.unregisterTool(ARCHIVED_NAME);
  // 若真实 `computer_use` 原本已注册，测试覆盖后需还原（避免污染同进程其它用例）
  if (prevArchived) registry.registerTool(prevArchived);
});

describe('tool_search 检索覆盖面（2026-10-11）', () => {
  it('非延迟的内置工具可被关键词命中（修复前只搜延迟工具 ⇒ 永远搜不到）', async () => {
    expect(await search(PROBE_NAME)).toContain(PROBE_NAME);
  });

  it('有意归档工具被排除在检索面外（归档机制仍生效）', async () => {
    // 2026-11-21：`computer_use` 已解除归档（改为功能开关控制）⇒ 此处**临时注入**一个
    // 归档名来锁定"归档 ⇒ 检索面排除"的机制本身，不再依赖某个具体工具是否归档。
    const archivedSet = ARCHIVED_MISC_TOOLS as unknown as Set<string>;
    archivedSet.add(ARCHIVED_NAME);
    try {
      expect(await search('computer')).not.toContain(ARCHIVED_NAME);
    } finally {
      archivedSet.delete(ARCHIVED_NAME);
    }
  });
});

/**
 * 2026-11-23：会话 `session_mwrf18pu00456e0f2b` 的回归清单（1/2/3/7/8 + 两条遗留项）。
 *
 * 现场痛点：`tool_search` 只回名字、空结果零诊断、旧名与裁剪对模型不可见。
 */
async function run(query: string): Promise<ToolSearchOutput> {
  const r = await new ToolSearchTool().execute({ query }, ctx);
  return r.data as ToolSearchOutput;
}

/** 在**真实工具名**上验证多词召回（缺失时注入同名探针，避免依赖加载顺序） */
const MULTI_WORD_PROBES = ['doc_generate', 'pdf', 'image_generate'] as const;
const injectedProbes: string[] = [];

beforeAll(() => {
  for (const name of MULTI_WORD_PROBES) {
    if (!registry.getTool(name)) {
      registry.registerTool(fakeTool(name, `${name} probe`));
      injectedProbes.push(name);
    }
  }
});

afterAll(() => {
  for (const name of injectedProbes) registry.unregisterTool(name);
});

describe('tool_search 可解释性（2026-11-23 回归清单）', () => {
  it('清单 1：多词查询 `doc_generate pdf image_generate` 三者全部命中', async () => {
    const out = await run('doc_generate pdf image_generate');
    for (const name of MULTI_WORD_PROBES) {
      expect(out.matches).toContain(name);
    }
  });

  it('清单 2：命中项带 description + 必填参数（details）', async () => {
    const out = await run(PROBE_NAME);
    const detail = out.details?.find((d) => d.name === PROBE_NAME);
    expect(detail).toBeDefined();
    expect(typeof detail!.description).toBe('string');
    expect(Array.isArray(detail!.requiredParams)).toBe(true);
    expect(typeof detail!.visible).toBe('boolean');
    expect(Array.isArray(detail!.hiddenReasons)).toBe(true);
  });

  it('清单 3：未注册名返回结构化 reason（不再只有空数组）', async () => {
    const out = await run('select:zzz_no_such_tool_xyz');
    expect(out.matches).toEqual([]);
    expect(out.reason).toBe('not_registered');
    expect(out.diagnostics?.[0]?.reason).toBe('not_registered');
    expect(out.diagnostics?.[0]?.hint?.length ?? 0).toBeGreaterThan(0);
  });

  it('清单 8：旧名（alias-only）不返回可用结果，但解释为 alias', async () => {
    const out = await run('select:read_vfs');
    expect(out.matches).toEqual([]);
    expect(out.reason).toBe('alias');
    expect(out.hint).toContain('vfs');
  });

  it('清单 7：命中项带本轮可见性与不可见原因（裁剪可解释）', async () => {
    const out = await run('select:' + PROBE_NAME);
    const detail = out.details?.[0];
    expect(detail?.name).toBe(PROBE_NAME);
    // 探针是运行期注入名（不在声明面）⇒ 可见性按"已注册即可见"处理，原因为空
    expect(detail?.visible).toBe(true);
    expect(detail?.hiddenReasons).toEqual([]);
  });

  it('遗留项：项目/图像工具在工厂表与 loader 清单中真实登记', () => {
    const keys = new Set<string>(getBuiltinToolFactoryKeys());
    const factories = BUILTIN_TOOL_FACTORIES as Record<string, unknown>;
    for (const key of [
      'createProjectTool',
      'createReadProjectFileTool',
      'createWriteProjectFileTool',
      'createImageTool',
      'createRecallMemoryTool',
    ]) {
      expect(typeof factories[key]).toBe('function');
      expect(keys.has(key)).toBe(true);
    }
  });
});
