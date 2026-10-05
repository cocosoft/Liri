// MIT License
// Copyright (c) 2026 190615273@qq.com
/**
 * code_run 工具清单注入（T-2 ①，2026-10-05）
 *
 * 背景：沙箱只暴露 `__liriRuntime.callTool(name, args)`，模型此前无从得知**有哪些工具
 * 可调、参数形状如何**。本批把清单由工具注册表按**生效白名单**生成并拼进 `code_run`
 * 描述（模型读工具契约处）。
 *
 * 锁定三点：① 只列白名单内工具（清单必须与沙箱可调集一致）；② 格式规则
 * `name(param: type, optional?: type) — description`（含 120 字截断）；③ 白名单项缺失
 * 时**跳过、不编造**（CS06）。
 */

import { describe, it, expect, afterAll } from 'bun:test';

import {
  buildCodeRunnerToolManifest,
  configureCodeRunner,
  CodeRunnerTool,
  DEFAULT_TOOL_WHITELIST,
} from '../../src/tools/CodeRunner/CodeRunnerTool';
import { getToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool, ToolParam } from '../../src/tools/types';

/** 参数桩（清单只用 name/type/required） */
function p(
  name: string,
  type: ToolParam['type'],
  required: boolean
): ToolParam {
  return { name, type, required, description: `${name} 参数` };
}

/** 最小工具桩（清单只读 name/description/params，不触达 getInfo/execute） */
function stubTool(
  name: string,
  description: string,
  params: ToolParam[]
): Tool {
  return { name, description, params } as unknown as Tool;
}

const registry = getToolRegistry();

function ensureTool(
  name: string,
  description: string,
  params: ToolParam[]
): void {
  if (!registry.getTool(name)) {
    registry.registerTool(stubTool(name, description, params));
  }
}

/** 复位为默认白名单（用例间互不污染） */
function resetWhitelist(): void {
  configureCodeRunner({ toolWhitelist: undefined });
}

afterAll(() => {
  resetWhitelist();
});

describe('code_run 工具清单注入（T-2 ①）', () => {
  it('默认白名单：含三件只读工具，且**排除**白名单外工具', () => {
    ensureTool('file_read', 'Read a file from disk', [
      p('path', 'string', true),
    ]);
    ensureTool('grep', 'Search file contents', [p('pattern', 'string', true)]);
    ensureTool('glob', 'Find files by pattern', [p('pattern', 'string', true)]);
    ensureTool('bash', 'Run a shell command', [p('command', 'string', true)]);

    const manifest = buildCodeRunnerToolManifest();

    expect(manifest).toContain('__liriRuntime.callTool');
    expect(manifest).toContain('file_read(');
    expect(manifest).toContain('grep(');
    expect(manifest).toContain('glob(');
    // 清单必须与沙箱可调集一致 ⇒ 白名单外工具不得出现
    expect(manifest).not.toContain('bash(');
    expect([...DEFAULT_TOOL_WHITELIST].sort()).toEqual([
      'file_read',
      'glob',
      'grep',
    ]);
  });

  it('格式规则：name(param: type, optional?: type) — description', () => {
    ensureTool('zz_manifest_probe', 'Probe tool description', [
      p('a', 'string', true),
      p('b', 'number', false),
    ]);
    configureCodeRunner({ toolWhitelist: new Set(['zz_manifest_probe']) });
    try {
      const manifest = buildCodeRunnerToolManifest();
      expect(manifest).toContain(
        '- zz_manifest_probe(a: string, b?: number) — Probe tool description'
      );
    } finally {
      resetWhitelist();
    }
  });

  it('描述超过 120 字被截断（控制 token 成本）', () => {
    ensureTool('zz_manifest_long', 'D'.repeat(200), []);
    configureCodeRunner({ toolWhitelist: new Set(['zz_manifest_long']) });
    try {
      const manifest = buildCodeRunnerToolManifest();
      expect(manifest).toContain('D'.repeat(120));
      expect(manifest).not.toContain('D'.repeat(121));
    } finally {
      resetWhitelist();
    }
  });

  it('运行期白名单覆盖生效（configureCodeRunner({ toolWhitelist })）', () => {
    ensureTool('bash', 'Run a shell command', []);
    configureCodeRunner({ toolWhitelist: new Set(['bash']) });
    try {
      const manifest = buildCodeRunnerToolManifest();
      expect(manifest).toContain('- bash(');
      expect(manifest).not.toContain('file_read(');
    } finally {
      resetWhitelist();
    }
  });

  it('白名单项在注册表缺失 ⇒ 跳过不编造；一条都取不到 ⇒ 空串（CS06）', () => {
    configureCodeRunner({
      toolWhitelist: new Set(['no_such_tool_xyz', 'file_read']),
    });
    try {
      const manifest = buildCodeRunnerToolManifest();
      expect(manifest).not.toContain('no_such_tool_xyz');
      expect(manifest).toContain('file_read(');
    } finally {
      resetWhitelist();
    }

    configureCodeRunner({
      toolWhitelist: new Set(['no_such_tool_xyz', 'also_missing_abc']),
    });
    try {
      expect(buildCodeRunnerToolManifest()).toBe('');
    } finally {
      resetWhitelist();
    }
  });

  it('CodeRunnerTool.description = 基础契约 + 清单（getter 每轮取值，getInfo 同源）', () => {
    ensureTool('file_read', 'Read a file from disk', []);
    const tool = new CodeRunnerTool();

    const description = tool.description;
    expect(description).toContain('__liriRuntime');
    expect(description).toContain('file_read(');
    // 模型工具定义走 `getToolSchemas() → getInfo()` ⇒ 必须同源
    expect(tool.getInfo().description).toBe(description);
  });
});
