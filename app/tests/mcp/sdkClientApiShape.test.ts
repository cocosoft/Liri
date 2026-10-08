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
 * SDK 客户端「API 形状」守卫（2026-10-08，MCP 双轨收敛 C-1 的配套）。
 *
 * 背景：本仓多处把 SDK `Client` 当作"有 `.tools` / `.prompts` / `.resources` 子对象"来用
 * （`(client as any).tools.list()` / `.tools.call()` / `.prompts.list()` / `.resources.list()`）。
 * 但**已装** SDK（`@modelcontextprotocol/sdk@^1.29.0`）的 `Client` **只有顶层方法** ——
 * `listTools` / `callTool` / `listPrompts` / `getPrompt` / `listResources` / `readResource`
 * （证据：`node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts:207,292,322,387,431,539`
 *  与编译产物 `dist/esm/client/index.js:464,467,476,490,565`）。
 *
 * ⇒ 那些子对象访问**每次都抛 `TypeError`**，又都被上层 `catch` 吞成 `[]` / `success:false`
 * ⇒ **静默降级**：MCP 工具注册不上（`fetchToolsForClient` 返回 `[]`）、`mcp__*` 工具每次调用都失败
 * —— 而**没有任何机制察觉**（无编译错误、无运行时报错冒泡、测试也覆盖不到真实 SDK）。
 *
 * 守卫方式（对齐本仓"扫描真实代码而非手写清单"的思路）：扫源码，**禁止**再出现
 * "把 SDK 客户端当子对象"的成员访问形态。
 */
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

/** 受检目录（MCP 相关源码面） */
const SCAN_DIRS = ['services/mcp', 'mcp', 'tools/MCPResourceTool'];

/**
 * 禁止形态（判据限定为"**SDK 客户端接收者**或 **`as any/unknown` cast**" —— 避免误伤
 * 本仓既有的同名内部集合，如 `MCPToolRegistry.this.tools` / `ResourceManager.this.resources`）：
 * SDK 顶层方法名是 `listTools` / `callTool` / `listPrompts` / `getPrompt` / `listResources` /
 * `readResource` —— 形态与下面的"子对象访问"完全不同。
 */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /as\s+(any|unknown)[^)]*\)\s*\.\s*(tools|prompts|resources)\s*\.\s*(list|call|get|read|execute)\s*\(/,
    why: '以 `as any/unknown` 断言出 SDK 客户端后访问不存在的子对象；应用顶层方法',
  },
  {
    re: /\b(client|mcpClient|sdkClient)\w*\s*\.\s*(tools|prompts|resources)\s*\.\s*(list|call|get|read|execute)\s*\(/,
    why: 'SDK `Client` 无 `.tools`/`.prompts`/`.resources` 子对象；应用顶层方法',
  },
  {
    re: /\b(client|mcpClient|sdkClient)\w*\s*\.\s*(tools|prompts|resources)\s+as\s+\{/,
    why: '把 SDK 客户端的子对象以 `as { ... }` 断言出来，等于绕过类型检查去调用不存在的成员',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // @ignore-catch 目录不存在 ⇒ 交由下面的规模断言暴露（不静默通过）
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(abs, out);
      continue;
    }
    if (entry.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

describe('SDK 客户端 API 形状守卫（C-1 防回流）', () => {
  const srcDir = join(import.meta.dir, '../../src');
  const files = SCAN_DIRS.flatMap((d) => walk(join(srcDir, d)));

  it('受检规模符合预期（防止扫描路径写错导致空集通过）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('源码中不存在"把 SDK 客户端当子对象"的成员访问', () => {
    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        // 注释行不参与判定（本文档与说明性注释会提到这些形态）
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { re, why } of FORBIDDEN_PATTERNS) {
          if (re.test(line)) {
            violations.push(
              `${file.replace(srcDir, 'src')}:${i + 1} → ${line.trim()}  【${why}】`
            );
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
