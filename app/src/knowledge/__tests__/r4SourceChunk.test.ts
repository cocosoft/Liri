// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// R4 原文分块页码索引：buildSourceChunks 页码/表格定位、SourceChunkStore 落库检索、
// refreshSourceChunksForRaw sidecar 回填与清理 测试。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ExtractedDocument } from '../ingestion/extractors/types';
import { buildSourceChunks } from '../source/sourceChunker';
import {
  SourceChunkStore,
  refreshSourceChunksForRaw,
} from '../source/SourceChunkStore';

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'k4-r4-test-'));
  dbPath = join(dir, 'test.db');
});

afterAll(() => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      // Windows 句柄释放延迟时重试
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 残留时忽略
  }
});

/** 构造 PDF 风格 IR：pagesText 以 \n\n 连接，locators 为页级行区间 */
function pdfIr(pagesText: string[]): ExtractedDocument {
  const text = pagesText.join('\n\n');
  const locators: ExtractedDocument['locators'] = [];
  let lineAcc = 1;
  for (let i = 0; i < pagesText.length; i++) {
    const pageLineCount = pagesText[i].length
      ? pagesText[i].split('\n').length
      : 0;
    locators.push({
      lineStart: lineAcc,
      lineEnd: pageLineCount > 0 ? lineAcc + pageLineCount - 1 : lineAcc,
      page: i + 1,
    });
    lineAcc += pageLineCount + (i < pagesText.length - 1 ? 2 : 0);
  }
  return {
    path: '/tmp/doc.pdf',
    ext: '.pdf',
    text,
    pagesText,
    locators,
    meta: { pageCount: pagesText.length, charCount: text.length },
  };
}

describe('R4 buildSourceChunks（locators → 页码块）', () => {
  it('PDF 逐页切块：块文本不跨页且页码正确', () => {
    const ir = pdfIr(['alpha\nbeta', 'gamma\ndelta\nepsilon']);
    const chunks = buildSourceChunks(ir);

    expect(chunks.length).toBe(2);
    expect(chunks[0].page).toBe(1);
    expect(chunks[0].text).toContain('alpha');
    expect(chunks[0].text).toContain('beta');
    expect(chunks[0].text).not.toContain('gamma');
    expect(chunks[1].page).toBe(2);
    expect(chunks[1].text).toContain('epsilon');
    expect(chunks[1].seq).toBe(1);
  });

  it('超长页按行窗口切多块（全部保留同页）', () => {
    const manyLines: string[] = [];
    for (let i = 0; i < 40; i++) manyLines.push(`行 ${i} 内容`);
    const ir = pdfIr([manyLines.join('\n')]);
    const chunks = buildSourceChunks(ir, {
      windowLines: 10,
      overlap: 2,
      maxChunkChars: 2000,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.page).toBe(1);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.text.length).toBeLessThanOrEqual(2000 + 1);
    }
    // 相邻块序号连续
    const seqs = chunks.map((c) => c.seq);
    expect(seqs).toEqual([...Array(chunks.length).keys()]);
  });

  it('XLSX 风格 locators（tableId、无 page）→ 块带 tableId', () => {
    const ir: ExtractedDocument = {
      path: '/tmp/台账.xlsx',
      ext: '.xlsx',
      text: '## 工作表：台账\n表头: 编号 | 金额\n编号: 1，金额: 100',
      locators: [{ lineStart: 3, lineEnd: 3, tableId: '台账' }],
      meta: { charCount: 30 },
    };
    const chunks = buildSourceChunks(ir);
    expect(chunks.length).toBe(1);
    expect(chunks[0].tableId).toBe('台账');
    expect(chunks[0].page).toBeUndefined();
    expect(chunks[0].text).toContain('编号');
  });

  it('无 locators（文本类/DOCX）→ 返回空数组', () => {
    const ir: ExtractedDocument = {
      path: '/tmp/a.docx',
      ext: '.docx',
      text: '正文',
      locators: [],
      meta: { charCount: 2 },
    };
    expect(buildSourceChunks(ir)).toEqual([]);
  });
});

describe('R4 SourceChunkStore（落库/检索/清理）', () => {
  it('replaceForRaw / search / deleteByRaw', async () => {
    const store = new SourceChunkStore(dbPath);
    const raw = '/tmp/doc.pdf';
    const n = await store.replaceForRaw(raw, [
      {
        rawPath: raw,
        seq: 0,
        page: 1,
        text: '预付款条款：合同生效后 10 个工作日。',
      },
      { rawPath: raw, seq: 1, page: 2, text: '验收通过后结清尾款。' },
    ]);
    expect(n).toBe(2);

    const hits = await store.search('尾款', { limit: 5 });
    expect(hits.length).toBe(1);
    expect(hits[0].page).toBe(2);
    expect(hits[0].rawPath).toBe(raw);

    // 重放（重编译防残留：先清后插）
    await store.replaceForRaw(raw, [
      { rawPath: raw, seq: 0, page: 1, text: '新版正文 A' },
    ]);
    const after = await store.search('新版', { limit: 5 });
    expect(after.length).toBe(1);
    expect((await store.search('尾款', { limit: 5 })).length).toBe(0);

    const removed = await store.deleteByRaw(raw);
    expect(removed).toBe(1);
    expect((await store.search('新版', { limit: 5 })).length).toBe(0);

    await store.close();
  });
});

describe('R4 refreshSourceChunksForRaw（sidecar 回填）', () => {
  it('PDF sidecar（pagesText+locators）→ 落库可检索', async () => {
    const rawPath = join(dir, 'doc.pdf');
    writeFileSync(rawPath, 'dummy pdf bytes', 'utf-8');
    writeFileSync(
      `${rawPath}.locators.json`,
      JSON.stringify({
        path: rawPath,
        ext: '.pdf',
        pageCount: 2,
        locators: [
          { lineStart: 1, lineEnd: 2, page: 1 },
          { lineStart: 5, lineEnd: 7, page: 2 },
        ],
        pagesText: ['alpha\nbeta', 'gamma\ndelta\nepsilon'],
      }),
      'utf-8'
    );

    const n = await refreshSourceChunksForRaw(rawPath, dbPath);
    expect(n).toBe(2);

    const store = new SourceChunkStore(dbPath);
    try {
      const hits = await store.search('delta', { limit: 5 });
      expect(hits.length).toBe(1);
      expect(hits[0].page).toBe(2);
    } finally {
      await store.close();
    }

    // 清理本用例行，避免影响后续用例
    const cleanupStore = new SourceChunkStore(dbPath);
    try {
      await cleanupStore.deleteByRaw(rawPath);
    } finally {
      await cleanupStore.close();
    }
  });

  it('无定位的文本类 raw → 清空旧块并返回 0', async () => {
    const rawPath = join(dir, 'blank.md');
    writeFileSync(rawPath, '纯文本无页码', 'utf-8');

    const n = await refreshSourceChunksForRaw(rawPath, dbPath);
    expect(n).toBe(0);

    const store = new SourceChunkStore(dbPath);
    try {
      expect((await store.search('纯文本无页码', { limit: 5 })).length).toBe(0);
    } finally {
      await store.close();
    }
  });
});
