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
 * PR #14（2026-11-19 复核合入）：`KnowledgeCompiler.compile({ domain })` —— 域内编译的读写根切换。
 *
 * 契约（可证伪）：
 *  ① 传 `domain` ⇒ `raw/` 读域目录、产物写域目录，全局目录**不受影响**；
 *  ② 不传 `domain` ⇒ 回到全局目录（**不粘**上一次的域，防状态泄漏）；
 *  ③ 编译后 lint 的目标目录 = **本次实际写入根**（否则会去 lint 一个空目录而"静默通过"）。
 *
 * 不触网：`compileFile` 用桩替换（只验证路径选择），模型解析传显式 `model`。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KnowledgeCompiler,
  resolveSchemaDirForDomain,
} from '../../src/knowledge/KnowledgeCompiler';
import { WikiLinter } from '../../src/knowledge/lint/WikiLinter';

const home = mkdtempSync(join(tmpdir(), 'knowledge-domain-'));
const previousHome = process.env['LIRI_HOME'];

afterAll(() => {
  if (previousHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = previousHome;
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄未释放时留给 OS 清理，不影响断言
  }
});

describe('KnowledgeCompiler：domain 目标切换（PR #14）', () => {
  it('域内编译写域目录；不传 domain 回到全局；lint 始终跟随本次写入根', async () => {
    process.env['LIRI_HOME'] = home;
    const globalRoot = join(home, 'knowledge');
    const domainRoot = join(globalRoot, 'domains', 'finance');
    mkdirSync(join(domainRoot, 'raw'), { recursive: true });
    mkdirSync(join(globalRoot, 'raw'), { recursive: true });
    writeFileSync(join(domainRoot, 'raw', 'source.md'), 'domain source');
    writeFileSync(join(globalRoot, 'raw', 'source.md'), 'global source');

    const compiler = new KnowledgeCompiler({} as never);

    // 记录本次写到哪里 / lint 看的是哪个目录
    const outputs: string[] = [];
    const lintTargets: Array<string | undefined> = [];
    const originalLintRun = WikiLinter.prototype.run;
    WikiLinter.prototype.run = async function (wikiDir?: string) {
      lintTargets.push(wikiDir);
      return { results: [], summary: { error: 0, warning: 0, info: 0 } };
    };
    const rootOf = (): string =>
      (compiler as unknown as { knowledgeRoot: string }).knowledgeRoot;
    (
      compiler as unknown as {
        compileFile: (rawFile: string) => Promise<string[]>;
      }
    ).compileFile = async (rawFile: string) => {
      const output = join(
        rootOf(),
        `${rawFile.split(/[\\/]/).pop()}.compiled.md`
      );
      writeFileSync(output, 'compiled artifact');
      outputs.push(output);
      return [output];
    };

    try {
      // ① 域内编译
      await compiler.compile({ domain: 'finance', model: 'test' });
      expect(existsSync(join(domainRoot, 'source.md.compiled.md'))).toBe(true);
      expect(existsSync(join(globalRoot, 'source.md.compiled.md'))).toBe(false);
      expect(outputs[0]).toBe(join(domainRoot, 'source.md.compiled.md'));
      // ③ lint 目标 = 实际写入根（域根），不是 `domains/finance/wiki`
      expect(lintTargets[0]).toBe(domainRoot);

      // ② 不传 domain ⇒ 全局（不粘上一次的域）
      await compiler.compile({ model: 'test' });
      expect(existsSync(join(globalRoot, 'source.md.compiled.md'))).toBe(true);
      expect(outputs[1]).toBe(join(globalRoot, 'source.md.compiled.md'));
      expect(lintTargets[1]).toBe(globalRoot);
    } finally {
      WikiLinter.prototype.run = originalLintRun;
    }
  });
});

describe('resolveSchemaDirForDomain：域 schema 缺失时退回全局（PR #14 补全）', () => {
  it('域内有 entities/edges ⇒ 域目录；没有 ⇒ 全局目录；无 domain ⇒ 全局', () => {
    const schemaHome = mkdtempSync(join(tmpdir(), 'knowledge-schema-'));
    const prev = process.env['LIRI_HOME'];
    process.env['LIRI_HOME'] = schemaHome;
    try {
      const globalSchema = join(schemaHome, 'knowledge', '.schema');
      mkdirSync(globalSchema, { recursive: true });
      writeFileSync(join(globalSchema, 'entities.yaml'), 'entities: []\n');

      // 域内没有 schema 文件 ⇒ 退回全局（否则会丢全局本体约束）
      expect(resolveSchemaDirForDomain('finance')).toBe(globalSchema);

      const domainSchema = join(
        schemaHome,
        'knowledge',
        'domains',
        'finance',
        '.schema'
      );
      mkdirSync(domainSchema, { recursive: true });
      writeFileSync(join(domainSchema, 'edges.yaml'), 'edges: []\n');
      // 域内有 ⇒ 用域目录
      expect(resolveSchemaDirForDomain('finance')).toBe(domainSchema);
      // 无 domain ⇒ 全局
      expect(resolveSchemaDirForDomain()).toBe(globalSchema);
    } finally {
      if (prev === undefined) delete process.env['LIRI_HOME'];
      else process.env['LIRI_HOME'] = prev;
      try {
        rmSync(schemaHome, { recursive: true, force: true });
      } catch {
        // @ignore-catch — Windows 句柄未释放时留给 OS 清理
      }
    }
  });
});
