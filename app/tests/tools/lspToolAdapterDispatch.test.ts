// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`LSPToolAdapter.execute` 的**分派特征化锁**（外移前先测）。
 *
 * 现状：`sidecarLspTool.test.ts` 只覆盖侧车工具与 schema 一致性，内置 `execute` 的行为
 * （文档来源归一化 + action 分派 + 收尾）没有回归锁。这里用替身注入私有依赖，锁定：
 *   ① document（小片段）路径 ⇒ 文档原样传给 LSP，server 启动/停止各一次；
 *   ② file_path 存在 ⇒ 读盘内容生效，defaultUri 由路径派生（documentSymbol 用）；
 *   ③ file_path 不存在 ⇒ fail-closed 文案，且不触达 LSP 能力；
 *   ④ 未知 action ⇒ Unknown action + 未知操作 双文案；
 *   ⑤ workspaceSymbol / callHierarchy 的参数回落链；
 *   ⑥ 执行抛错 ⇒ 失败结果（含 LSP tool failed），finally 仍停 server。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LSPToolAdapter } from '@openliri/tool-code';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const ctx = {} as ToolUseContext;

type Call = { method: string; args: unknown[] };

/** 替身：记录每次调用的方法名与入参（含 server 启停） */
function makeInternals(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args });
      const handler = overrides[method];
      if (typeof handler === 'function') {
        return (handler as (...a: unknown[]) => unknown)(...args);
      }
      return `${method}-result`;
    };
  return {
    calls,
    internals: {
      lspTool: {
        startServer: async () => {
          calls.push({ method: 'startServer', args: [] });
        },
        stopServer: async () => {
          calls.push({ method: 'stopServer', args: [] });
        },
        getHover: record('getHover'),
        getDiagnostics: record('getDiagnostics'),
        formatDocument: record('formatDocument'),
        renameSymbol: record('renameSymbol'),
      },
      symbolSearch: {
        searchWorkspaceSymbols: record('searchWorkspaceSymbols'),
        getDocumentSymbols: record('getDocumentSymbols'),
      },
      callHierarchy: {
        prepareCallHierarchy: record('prepareCallHierarchy'),
        buildCallHierarchy: record('buildCallHierarchy'),
      },
      symbolContextProvider: {
        getSymbolContext: record('getSymbolContext'),
      },
    },
  };
}

function makeTool(overrides: Record<string, unknown> = {}) {
  const tool = new LSPToolAdapter();
  const { calls, internals } = makeInternals(overrides);
  Object.assign(tool as unknown as Record<string, unknown>, internals);
  return { tool, calls };
}

describe('LSPToolAdapter.execute 分派（P3-2 外移前特征化）', () => {
  it('document 片段 ⇒ 原样传给 LSP，server 启停各一次', async () => {
    const { tool, calls } = makeTool();
    const position = { line: 1, character: 2 };

    const res = await tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        document: 'const x = 1;',
        position,
      },
      ctx
    );

    expect(res.success).toBe(true);
    expect(res.data).toBe('getHover-result');
    expect(res.output).toBe('LSP hover completed successfully');
    // 文档**不做 trim**（LSP 诊断/格式化依赖精确行号与换行）
    expect(calls.find((c) => c.method === 'getHover')?.args).toEqual([
      'const x = 1;',
      position,
    ]);
    expect(calls.filter((c) => c.method === 'startServer')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'stopServer')).toHaveLength(1);
  });

  it('file_path 存在 ⇒ 读盘内容生效，且 documentSymbol 用路径派生的 defaultUri', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lsp-adapter-'));
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const fromDisk = 1;', 'utf8');
    try {
      const { tool, calls } = makeTool();
      await tool.execute(
        { action: 'diagnostics', language: 'typescript', file_path: file },
        ctx
      );
      expect(calls.find((c) => c.method === 'getDiagnostics')?.args).toEqual([
        'const fromDisk = 1;',
      ]);

      await tool.execute(
        { action: 'documentSymbol', language: 'typescript', file_path: file },
        ctx
      );
      const uriArg = calls.find((c) => c.method === 'getDocumentSymbols')
        ?.args[0];
      expect(String(uriArg)).toContain('a.ts');
      expect(String(uriArg).startsWith('file://')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('file_path 不存在 ⇒ fail-closed（不触达 LSP 能力，仍收尾停 server）', async () => {
    const { tool, calls } = makeTool();

    const res = await tool.execute(
      {
        action: 'hover',
        language: 'typescript',
        file_path: '__definitely_missing__/none.ts',
        position: { line: 0, character: 0 },
      },
      ctx
    );

    expect(res.success).toBe(false);
    expect(String(res.output)).toContain('file_path 指向的文件不存在');
    expect(calls.some((c) => c.method === 'getHover')).toBe(false);
    expect(calls.filter((c) => c.method === 'stopServer')).toHaveLength(1);
  });

  it('未知 action ⇒ Unknown action + 未知操作 双文案', async () => {
    const { tool } = makeTool();
    const res = await tool.execute(
      { action: 'notAnAction', language: 'typescript', document: 'x' },
      ctx
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe('Unknown action: notAnAction');
    expect(res.output).toBe('未知操作: notAnAction');
  });

  it('workspaceSymbol ⇒ query 回落链 query → symbol → 空串', async () => {
    const { tool, calls } = makeTool();
    await tool.execute(
      {
        action: 'workspaceSymbol',
        language: 'typescript',
        document: '',
        symbol: 'Foo',
      },
      ctx
    );
    expect(
      calls.find((c) => c.method === 'searchWorkspaceSymbols')?.args
    ).toEqual(['Foo']);

    await tool.execute(
      {
        action: 'workspaceSymbol',
        language: 'typescript',
        document: '',
        query: 'Bar',
      },
      ctx
    );
    const queries = calls
      .filter((c) => c.method === 'searchWorkspaceSymbols')
      .map((c) => c.args[0]);
    expect(queries).toEqual(['Foo', 'Bar']);
  });

  it('callHierarchy ⇒ line/character 回落 params → position → 0', async () => {
    const { tool, calls } = makeTool();
    await tool.execute(
      {
        action: 'callHierarchy',
        language: 'typescript',
        document: 'x',
        uri: 'file:///x.ts',
        position: { line: 7, character: 3 },
      },
      ctx
    );

    const prepare = calls.find((c) => c.method === 'prepareCallHierarchy');
    expect(prepare?.args).toEqual(['file:///x.ts', 7, 3]);
    // 准备与构建都走同一组坐标
    expect(calls.find((c) => c.method === 'buildCallHierarchy')?.args).toEqual([
      'file:///x.ts',
      7,
      3,
    ]);
  });

  it('执行抛错 ⇒ 失败结果 + finally 仍停 server', async () => {
    const { tool, calls } = makeTool({
      getDiagnostics: () => {
        throw new Error('lsp-crashed');
      },
    });

    const res = await tool.execute(
      { action: 'diagnostics', language: 'typescript', document: 'x' },
      ctx
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('lsp-crashed');
    expect(String(res.output)).toContain('LSP tool failed');
    expect(calls.filter((c) => c.method === 'stopServer')).toHaveLength(1);
  });
});
