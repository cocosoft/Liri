/**
 * `KnowledgeCompiler.compile` 的**早退路径**特征化测试（T3 复杂度清理前置，2026-11-17）。
 *
 * 目的：在拆分 `compile`（圈复杂度 70）之前，把不依赖真实 LLM / 图谱提取的可观测行为钉住：
 *  ① raw 目录不存在 ⇒ 直接返回空结果（不启动进度、不读编译状态快照）；
 *  ② raw 目录存在但无「可编译文件」（仅 `.meta.json` 伴侣与未知扩展名）⇒ 同样返回空结果；
 *  ③ 两条路径都返回**完整的零值结构**（compiled/skipped/totalFound/pagesCreated 为 0，
 *     errors/compiledFiles/compiledRaws 为空数组），调用方据此判断「本轮无事可做」。
 *
 * 隔离手法：显式传 `model`（绕过 `modelRouter` 的 DB 解析），并用 `LIRI_HOME` 指向临时目录
 * ⇒ `knowledgeRoot` 落在临时区，**不触碰**用户真实 `~/.pyapp/knowledge`。
 *
 * 边界（如实）：逐文件编译、lint 棘轮、图谱提取段落依赖真实 LLM 与状态文件，
 * 不在本测试覆盖范围（等价性由拆分提交的逐字搬出佐证；lint 棘轮已有
 * `tests/knowledge/lintRatchet.test.ts` 锁定纯判定函数）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KnowledgeCompiler } from '../../src/knowledge/KnowledgeCompiler';
import type { AIService } from '@modules/ai';

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'liri-kc-'));
  originalHome = process.env['LIRI_HOME'];
  process.env['LIRI_HOME'] = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function makeCompiler(): KnowledgeCompiler {
  // compile 的早退路径不触 AI：仅需满足构造签名
  return new KnowledgeCompiler({} as unknown as AIService);
}

const ZEROES = {
  compiled: 0,
  skipped: 0,
  totalFound: 0,
  pagesCreated: 0,
};

describe('KnowledgeCompiler.compile：早退路径（特征化）', () => {
  it('① raw 目录不存在 ⇒ 返回完整零值结果', async () => {
    const compiler = makeCompiler();

    const result = await compiler.compile({ model: 'stub-model' });

    expect(result).toMatchObject(ZEROES);
    expect(result.errors).toEqual([]);
    expect(result.compiledFiles).toEqual([]);
    expect(result.compiledRaws).toEqual([]);
  });

  it('② raw 目录只有 .meta.json 伴侣与未知扩展名 ⇒ 可编译文件为 0，返回零值结果', async () => {
    const rawDir = join(home, 'knowledge', 'raw');
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, 'notes.md.meta.json'), '{"pages":[]}');
    writeFileSync(join(rawDir, 'ignore.xyz'), 'x');

    const compiler = makeCompiler();

    const result = await compiler.compile({ model: 'stub-model' });

    expect(result).toMatchObject(ZEROES);
    expect(result.errors).toEqual([]);
    expect(result.compiledFiles).toEqual([]);
    expect(result.compiledRaws).toEqual([]);
  });

  it('③ 早退结果结构稳定：不携带 version（未进入编译轮次）', async () => {
    const compiler = makeCompiler();

    const result = await compiler.compile({ model: 'stub-model' });

    expect(result.version).toBeUndefined();
  });
});
