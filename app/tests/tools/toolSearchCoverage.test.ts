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
import { searchToolsWithKeywords } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { describeHiddenReasons } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { truncateToolDescription } from '../../src/tools/ToolSearchTool/ToolSearchTool';
import { createVfsFamilyTool } from '@openliri/tool-workspace';
import { WriteProjectFileTool } from '@openliri/tool-workspace';
import { TodoWriteTool } from '../../src/tools/TodoWriteTool/TodoWriteTool';
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
    // 2026-11-23：`tool_search` 详情改从 `getInfo()` 读元数据（懒加载包装器同源口径）
    getInfo: () =>
      ({
        name,
        description,
        params: [],
        enabled: true,
        readOnly: true,
        destructive: false,
        concurrencySafe: true,
        deferred: false,
        alwaysLoad: true,
        interruptBehavior: 'block' as const,
      }) as unknown as ReturnType<Tool['getInfo']>,
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

/**
 * 多组多词查询（清单 1：3 组）。
 *
 * 探针描述刻意**不含工具名** ⇒ 命中只能来自「完整工具名下划线归一」这条判据，
 * 防止用例被 `description` 里恰好写了工具名而"假通过"。
 */
const MULTI_WORD_GROUPS: readonly (readonly string[])[] = [
  ['doc_generate', 'pdf', 'image_generate'],
  ['web_fetch', 'web_search'],
  ['bash', 'powershell'],
];
const injectedProbes: string[] = [];

beforeAll(() => {
  for (const name of MULTI_WORD_GROUPS.flat()) {
    if (!registry.getTool(name)) {
      registry.registerTool(fakeTool(name, 'probe tool'));
      injectedProbes.push(name);
    }
  }
});

afterAll(() => {
  for (const name of injectedProbes) registry.unregisterTool(name);
});

describe('tool_search 可解释性（2026-11-23 回归清单）', () => {
  it('清单 1：多组多词查询全部命中（含 snake_case 全名归一）', async () => {
    for (const group of MULTI_WORD_GROUPS) {
      const out = await run(group.join(' '));
      for (const name of group) {
        expect(out.matches).toContain(name);
      }
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

  it('P1（2026-11-23）：关键词空结果也给出结构化诊断（旧名词）', async () => {
    const out = await run('read_vfs');
    const diag = out.diagnostics?.find((d) => d.name === 'read_vfs');
    expect(diag?.reason).toBe('alias');
  });

  it('P1（2026-11-23）：诊断名字大小写归一（Music_Generate ⇒ declared_unregistered）', async () => {
    const out = await run('select:Music_Generate');
    expect(out.matches).toEqual([]);
    expect(out.reason).toBe('declared_unregistered');
  });

  /**
   * 会话复测（2026-11-23 13:49）：`TOOL_NAMES` 是生成物（不含运行期 flag），旧诊断把
   * `vfs`（VFS_ENABLED=false 未注册）误判为 task_filtered，并承诺"select 选中后可直接调用"。
   * 现已改为以真实注册表为准 ⇒ 必须落到 declared_unregistered，且不再承诺可调用。
   */
  it('P1（2026-11-23）：未注册的声明工具 ⇒ declared_unregistered（不再假承诺）', async () => {
    const out = await run('select:vfs');
    expect(out.matches).toEqual([]);
    expect(out.reason).toBe('declared_unregistered');
    expect(out.hint ?? '').not.toContain('可直接调用');
  });

  /** 会话复测：族工具的判别字段（op）在 schema 里 required=false ⇒ requiredParams 为空 */
  it('P1（2026-11-23）：族工具详情带出判别字段（op + 合法值）', async () => {
    const existing = registry.getTool('vfs');
    if (!existing) registry.registerTool(createVfsFamilyTool());
    try {
      const out = await run('select:vfs');
      const detail = out.details?.[0];
      expect(detail?.opParam?.name).toBe('op');
      expect(detail?.opParam?.values).toEqual(
        expect.arrayContaining(['read', 'list', 'stat', 'write'])
      );
    } finally {
      if (!existing) registry.unregisterTool('vfs');
    }
  });

  /** 会话复测：中文泛词（查看/生成）零权重 ⇒ 泛词不能单独决定命中 */
  it('P1（2026-11-23）：泛词抑制 —— 只命中泛词的工具被排除（覆盖率优先）', async () => {
    const common = Array.from({ length: 8 }, (_, i) =>
      fakeTool(`zzzcommon${i}`, 'commonword helper')
    );
    const target = fakeTool('zzztarget', 'specificword tool');
    const matches = await searchToolsWithKeywords(
      'commonword specificword',
      [...common, target],
      5
    );
    expect(matches).toContain('zzztarget');
    expect(matches.some((n) => n.startsWith('zzzcommon'))).toBe(false);
  });

  /** 会话复测：`requiredParams` 只报无条件必填 ⇒ 条件必填必须单独声明并透出 */
  it('P1（2026-11-23）：条件必填元数据（write_project_file / todo_write）', () => {
    expect(
      (WriteProjectFileTool.create().getInfo() as { requiredAnyOf?: unknown })
        .requiredAnyOf
    ).toEqual([['content'], ['source_file']]);
    expect(new TodoWriteTool().getInfo().requiredAnyOfByOp?.write).toEqual([
      ['todos'],
    ]);
  });

  /** 会话复测：两类 hiddenReason 观感不同 ⇒ 给出可读解释 */
  it('P1（2026-11-23）：hiddenReasons 两类原因可读化且可区分', () => {
    const taskFiltered = describeHiddenReasons(['not-in-task-whitelist']);
    const disclosure = describeHiddenReasons(['not-in-default-disclosure']);
    expect(taskFiltered).toContain('任务类别');
    expect(disclosure).toContain('默认披露白名单');
    expect(taskFiltered).not.toBe(disclosure);
  });

  /** 会话打磨项：描述截断 200 → 360，且优先在句/分句边界收口 */
  it('P3（2026-11-23）：描述截断 360，优先边界收口，短文本原样', () => {
    expect(truncateToolDescription('短描述')).toBe('短描述');

    const withBoundary = 'A'.repeat(250) + '。' + 'B'.repeat(300);
    const cut = truncateToolDescription(withBoundary);
    expect(cut.length).toBeLessThanOrEqual(361);
    expect(cut.endsWith('。…')).toBe(true);

    const withoutBoundary = 'C'.repeat(500);
    const hard = truncateToolDescription(withoutBoundary);
    expect(hard.length).toBe(361);
    expect(hard.endsWith('…')).toBe(true);
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
