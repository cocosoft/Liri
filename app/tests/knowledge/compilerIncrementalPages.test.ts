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
 *
 * K9（2026-11-26）追加：内容摘要（sha1）改为按需复检 —— 先用已免费的 `stat.size` 判，
 * 大小未变则只在复检周期到期后读内容；真机 16 个有 digest 的文件共 38.5 MB（42.6 ms/轮），
 * 铺满 593 个将 ≈233 ms/轮。本测试锁定三条：未到期不读、到期读一次、大小变直接重编译。
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

import {
  KnowledgeCompiler,
  decideDigestCheck,
} from '../../src/knowledge/KnowledgeCompiler';
import type { AIService } from '@modules/ai';

/** 被测私有方法的最小结构（只声明本测试用到的签名） */
interface CompilerInternals {
  needsRecompile(
    rawFile: string,
    rawStat: Stats,
    cachedPages?: string[]
  ): Promise<{ needsCompile: boolean; pages?: string[] }>;
  processRawFileForCompile(rawFile: string, ctx: unknown): Promise<void>;
  compileFile(rawFile: string, model?: string): Promise<string[]>;
}

interface DocEntry {
  mtime: number;
  compiledAt: number;
  digest?: string;
  size?: number;
  digestCheckedAt?: number;
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

describe('KnowledgeCompiler.needsRecompile：多页面并发判定（K10）', () => {
  /** 一条 raw → 两个页面（many-to-many 的典型形态） */
  function makeMultiPageFixture(): {
    rawFile: string;
    pages: string[];
    rawStat: Stats;
  } {
    const knowledgeRoot = join(home, 'knowledge');
    const rawDir = join(knowledgeRoot, 'raw');
    mkdirSync(rawDir, { recursive: true });
    mkdirSync(join(knowledgeRoot, 'entities'), { recursive: true });
    const rawFile = join(rawDir, 'note.md');
    const pages = [
      join(knowledgeRoot, 'note.md'),
      join(knowledgeRoot, 'entities', 'concept.md'),
    ];
    writeFileSync(rawFile, 'raw content');
    for (const p of pages) writeFileSync(p, '# page');
    const older = new Date(Date.now() - 60_000);
    utimesSync(rawFile, older, older);
    return { rawFile, pages, rawStat: statSync(rawFile) };
  }

  it('① 两个页面都存在且都比源新 ⇒ 不重编译', async () => {
    const { rawFile, pages, rawStat } = makeMultiPageFixture();
    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, rawStat, pages);
    expect(verdict).toEqual({ needsCompile: false, pages });
  });

  it('② 只有一个页面缺失（其余正常）⇒ 仍必须重编译', async () => {
    const { rawFile, pages, rawStat } = makeMultiPageFixture();
    rmSync(pages[1]);

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, rawStat, pages);
    expect(verdict).toEqual({ needsCompile: true, pages });
  });

  it('③ 只有一个页面比源旧 ⇒ 仍必须重编译', async () => {
    const { rawFile, pages } = makeMultiPageFixture();
    const olderThanRaw = new Date(Date.now() - 120_000);
    utimesSync(pages[1], olderThanRaw, olderThanRaw);

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const { needsRecompile } = compiler as unknown as CompilerInternals;

    const verdict = await needsRecompile(rawFile, statSync(rawFile), pages);
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

describe('decideDigestCheck — 内容摘要按需复检（K9）', () => {
  const HOUR = 3600_000;

  it('① 旧快照无 size（迁移期）⇒ reverify（读一次确认并补 size）', () => {
    expect(
      decideDigestCheck({ currentSize: 10, now: 1_000, intervalMs: HOUR })
    ).toBe('reverify');
  });

  it('② 字节数变了 ⇒ size-changed（判定依据是 stat，不读内容）', () => {
    expect(
      decideDigestCheck({
        prevSize: 10,
        currentSize: 11,
        digestCheckedAt: 1_000,
        now: 1_000,
        intervalMs: HOUR,
      })
    ).toBe('size-changed');
  });

  it('③ 大小未变且复检未到期 ⇒ defer（本轮不读内容）', () => {
    expect(
      decideDigestCheck({
        prevSize: 10,
        currentSize: 10,
        digestCheckedAt: 1_000,
        now: 1_000 + HOUR - 1,
        intervalMs: HOUR,
      })
    ).toBe('defer');
  });

  it('④ 大小未变但复检到期 ⇒ reverify', () => {
    expect(
      decideDigestCheck({
        prevSize: 10,
        currentSize: 10,
        digestCheckedAt: 1_000,
        now: 1_000 + HOUR,
        intervalMs: HOUR,
      })
    ).toBe('reverify');
  });
});

describe('KnowledgeCompiler.processRawFileForCompile：摘要读取按需化（K9）', () => {
  function makeResult() {
    return {
      compiled: 0,
      skipped: 0,
      errors: [] as string[],
      totalFound: 1,
      pagesCreated: 0,
      compiledFiles: [] as string[],
      compiledRaws: [] as string[],
    };
  }

  async function run(
    prevPatch: Partial<DocEntry>,
    options: { digestImpl?: () => Promise<string> } = {}
  ) {
    const { rawFile, pageFile, rawStat } = makeFixture();
    const prev: DocEntry = {
      mtime: rawStat.mtimeMs,
      compiledAt: 1,
      digest: 'stored-digest',
      size: rawStat.size,
      pages: [pageFile],
      ...prevPatch,
    };
    const newState = {
      lastCompileAt: 0,
      docs: {} as Record<string, DocEntry>,
    };
    const result = makeResult();
    let digestCalls = 0;

    const compiler = new KnowledgeCompiler({} as unknown as AIService);
    const internals = compiler as unknown as CompilerInternals;
    // 不触 AI：需要走编译分支时用桩
    internals.compileFile = async () => [];

    await internals.processRawFileForCompile.call(compiler, rawFile, {
      force: false,
      resolvedModel: 'stub-model',
      compileState: { lastCompileAt: 0, docs: { [rawFile]: prev } },
      newState,
      digestFor: async () => {
        digestCalls++;
        return options.digestImpl ? options.digestImpl() : 'stored-digest';
      },
      result,
    });

    return { result, newState, rawFile, digestCalls, rawStat };
  }

  it('① 复检未到期 ⇒ 不读内容（digestFor 0 次调用），沿用旧的复检时间', async () => {
    const checkedAt = Date.now();
    const { result, newState, rawFile, digestCalls, rawStat } = await run({
      digestCheckedAt: checkedAt,
    });

    expect(digestCalls).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.compiled).toBe(0);
    expect(newState.docs[rawFile]?.digestCheckedAt).toBe(checkedAt);
    expect(newState.docs[rawFile]?.size).toBe(rawStat.size);
  });

  it('② 复检到期且指纹一致 ⇒ 读一次内容并刷新复检时间', async () => {
    const { result, newState, rawFile, digestCalls } = await run({
      digestCheckedAt: 1, // 早已到期
    });

    expect(digestCalls).toBe(1);
    expect(result.skipped).toBe(1);
    expect(newState.docs[rawFile]?.digestCheckedAt).toBeGreaterThan(1);
  });

  it('③ 大小变化 ⇒ 直接重编译（判定不读摘要；仅编译成功后补指纹时读一次）', async () => {
    const { result, digestCalls } = await run({
      size: 1, // 与真实大小不符
      digestCheckedAt: Date.now(),
    });

    expect(result.compiled).toBe(1);
    expect(result.skipped).toBe(0);
    // 1 次 = 编译成功写快照时算新指纹；判定阶段（mtime 相同）没有读内容
    expect(digestCalls).toBe(1);
  });
});
