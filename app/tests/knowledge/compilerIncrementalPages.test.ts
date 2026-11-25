/**
 * K7（2026-11-26）：知识编译增量判定的 I/O 收敛 —— 页面列表缓存。
 *
 * 背景（真机实测，`~/.pyapp/knowledge/raw` 11,022 文件 / 实际纳入 591）：
 * 每轮编译约 1.1s，其中 ~950ms 花在「逐文件读 `.meta.json` + 页面 `existsSync`+`stat`」
 * （1,534 次读 / 3,556 次页面 stat），而 LLM 调用 0 次（591 全跳过）。
 *
 * 本次改动两条契约（用本测试钉住）：
 *  ① `needsRecompile` 优先用编译状态快照里缓存的 `pages`（与 `.meta.json` 同源）
 *     ⇒ 快照齐全时**即使 `.meta.json` 不存在**也能判定「无需重编译」；
 *  ② 判定出的页面列表会回写新快照（`docs[raw].pages`）⇒ 下轮继续免读 `.meta.json`。
 *
 * 页面缺失仍必须触发重编译（自愈语义不变），同样在此锁定。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KnowledgeCompiler } from '../../src/knowledge/KnowledgeCompiler';
import type { AIService } from '@modules/ai';

/** 被测私有方法的最小结构（只声明本测试用到的签名） */
interface CompilerInternals {
  needsRecompile(
    rawFile: string,
    rawStat: Stats,
    cachedPages?: string[]
  ): Promise<{ needsCompile: boolean; pages?: string[] }>;
  processRawFileForCompile(rawFile: string, ctx: unknown): Promise<void>;
}

interface DocEntry {
  mtime: number;
  compiledAt: number;
  digest?: string;
  pages?: string[];
}

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'liri-kc-pages-'));
  originalHome = process.env['LIRI_HOME'];
  process.env['LIRI_HOME'] = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = originalHome;
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // @ignore-catch — Windows 句柄未释放时留给 OS 清理，不影响断言
  }
});

/** 造一组 fixture：raw（mtime 较早）+ 页面（mtime 较晚，即"产物比源新"） */
function makeFixture(): {
  rawFile: string;
  pageFile: string;
  rawStat: Stats;
} {
  const knowledgeRoot = join(home, 'knowledge');
  const rawDir = join(knowledgeRoot, 'raw');
  mkdirSync(rawDir, { recursive: true });
  const rawFile = join(rawDir, 'note.md');
  const pageFile = join(knowledgeRoot, 'note.md');
  writeFileSync(rawFile, 'raw content');
  writeFileSync(pageFile, 'compiled page');

  // 显式钉住 mtime：raw 早于页面（否则同一毫秒写入时"源比产物新"判定不确定）
  const older = new Date(Date.now() - 60_000);
  utimesSync(rawFile, older, older);

  return { rawFile, pageFile, rawStat: statSync(rawFile) };
}

describe('KnowledgeCompiler.needsRecompile：页面列表走快照缓存（K7）', () => {
  it('① 快照有 pages ⇒ 不读 .meta.json 也能判定「无需重编译」', async () => {
    const { rawFile, pageFile, rawStat } = makeFixture();
    expect(existsSync(`${rawFile}.meta.json`)).toBe(false);

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, rawStat, [pageFile]);
    expect(verdict).toEqual({ needsCompile: false, pages: [pageFile] });
  });

  it('② 快照无 pages 且无 .meta.json ⇒ 仍需重编译（回到原语义）', async () => {
    const { rawFile, rawStat } = makeFixture();

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, rawStat, undefined);
    expect(verdict.needsCompile).toBe(true);
  });

  it('③ 页面被删 ⇒ 即使快照有 pages 也必须重编译（自愈语义不变）', async () => {
    const { rawFile, pageFile, rawStat } = makeFixture();
    rmSync(pageFile);

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, rawStat, [pageFile]);
    expect(verdict).toEqual({ needsCompile: true, pages: [pageFile] });
  });

  it('④ 源比产物新 ⇒ 重编译', async () => {
    const { rawFile, pageFile } = makeFixture();
    const newer = new Date(Date.now() + 60_000);
    utimesSync(rawFile, newer, newer);

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, statSync(rawFile), [
      pageFile,
    ]);
    expect(verdict.needsCompile).toBe(true);
  });
});

describe('KnowledgeCompiler.processRawFileForCompile：跳过时回写页面列表（K7）', () => {
  it('旧快照缺 pages ⇒ 本轮从 .meta.json 补出并写入新快照，且计入跳过', async () => {
    const { rawFile, pageFile, rawStat } = makeFixture();
    writeFileSync(
      `${rawFile}.meta.json`,
      JSON.stringify({ pages: [pageFile], updatedAt: Date.now() })
    );

    const prev: DocEntry = { mtime: rawStat.mtimeMs, compiledAt: 1 };
    const newState: { lastCompileAt: number; docs: Record<string, DocEntry> } =
      {
        lastCompileAt: 0,
        docs: {},
      };
    const result = {
      compiled: 0,
      skipped: 0,
      errors: [] as string[],
      totalFound: 1,
      pagesCreated: 0,
      compiledFiles: [] as string[],
      compiledRaws: [] as string[],
    };

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { processRawFileForCompile } =
      compiler as unknown as CompilerInternals;

    await processRawFileForCompile.call(compiler, rawFile, {
      force: false,
      resolvedModel: 'stub-model',
      compileState: { lastCompileAt: 0, docs: { [rawFile]: prev } },
      newState,
      digestFor: async () => 'unused-digest',
      result,
    });

    expect(result.skipped).toBe(1);
    expect(result.compiled).toBe(0);
    expect(newState.docs[rawFile]?.pages).toEqual([pageFile]);
    // mtime 沿用本轮 stat 结果（原实现此处会再 stat 一次）
    expect(newState.docs[rawFile]?.mtime).toBe(rawStat.mtimeMs);
  });
});
