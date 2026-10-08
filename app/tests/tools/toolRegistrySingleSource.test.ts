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
 * 守卫：工具注册表**单一写入口**（2026-10-08 架构治理 P1 · D1 防复发）
 *
 * 背景（§1.16「唯一写入口」）：工具注册统一走全局单例 `getToolRegistry()`；
 * 自建第二注册表会**分裂注册目标**（历史上曾致 MCP / 插件注册进不存在的表）。
 * 2026-10-08 P1 漂移审计实测发现 **3 处**"创建注册表"，现已**全部收敛**：
 *   - `commands/builtin/chat/Chat.ts` —— 已修：改用 `getToolManager()`（其 registry 缺省即全局单例）；
 *   - `governance/managers/GovernanceManager.ts` —— 已修（D6）：改用 `getToolRegistry()`
 *     （原 `createToolRegistry()` 造空表 ⇒ `getGovernedTools()` / `executeGovernanceCheck()`
 *     的 feature-flag 过滤恒为空集）；
 *   - `tools/search/ToolDiscoveryService.ts` —— 已删（D7）：空注册表 + 零消费者，且与活的
 *     `tool_search`（`ToolSearchTool` 走 `getToolRegistry()` + `isDeferredTool`）**能力重复**。
 *
 * ⇒ 现在**唯一**允许出现"创建注册表"的文件只有单例工厂本身。判据（来自**真实源码**，非手写清单）：
 * 全 `src/**` 扫描 `new ToolRegistry(` / `createToolRegistry(`，**跳过注释行**（避免文档/注释里的
 * 字面量误判）；命中文件必须 ⊆ `ALLOWED`。
 */

import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'bun:test';

const SRC_DIR = join(import.meta.dir, '../../src');

/** 允许"创建注册表"的文件 + **理由**（其余一律视为第二注册表 ⇒ 漂移） */
const ALLOWED: Record<string, string> = {
  'tools/ToolRegistry.ts':
    '唯一单例工厂（`getToolRegistry()` 内部 + `createToolRegistry()` 工厂）',
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // @ignore-catch — 目录不存在 ⇒ 交由下面的规模断言暴露（不静默通过）
    return out;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(abs, out);
      continue;
    }
    if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

/** 扫描"创建注册表"的源文件（行级；跳过注释行） */
function findRegistrySites(): string[] {
  const hits: string[] = [];
  for (const abs of walk(SRC_DIR)) {
    const rel = relative(SRC_DIR, abs).replace(/\\/g, '/');
    for (const line of readFileSync(abs, 'utf-8').split('\n')) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
        continue;
      if (
        /new\s+ToolRegistry\s*\(/.test(line) ||
        /createToolRegistry\s*\(/.test(line)
      ) {
        hits.push(rel);
        break;
      }
    }
  }
  return hits.sort();
}

describe('守卫：工具注册表单一写入口（§1.16 防复发）', () => {
  it('"创建注册表"只允许出现在唯一单例工厂内（D1/D6/D7 已全部收敛）', () => {
    const offenders = findRegistrySites().filter((f) => !(f in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it('扫描面非空（防止 walk 失效导致守卫静默通过）', () => {
    // 收敛后仅剩单例工厂 1 个文件命中 ⇒ 下界为 1（>=1 已足以暴露 walk 失效）
    expect(findRegistrySites().length).toBeGreaterThanOrEqual(1);
  });

  it('显式允许清单不得含已不存在该写法的文件（防止清单腐化）', () => {
    const present = new Set(findRegistrySites());
    const stale = Object.keys(ALLOWED).filter((f) => !present.has(f));
    expect(stale).toEqual([]);
  });
});
