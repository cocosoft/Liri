// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// K4 证据回链：quote→page/§ 反查、引用格式、sidecar 落盘、raw↔页面解析。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ExtractedDocument } from '../ingestion/extractors/types';
import { persistExtractionSidecar } from '../ingestion/extractors/TextExtractor';
import {
  locateQuoteInPages,
  locateQuote,
  buildDocCitation,
  loadSidecar,
  findRawForPage,
  type EvidenceSidecar,
} from '../evidence/EvidenceLocator';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'k4-evidence-test-'));
});

afterAll(async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放延迟导致残留时忽略
  }
});

const pages = [
  '御数坊 AiDGAtlas 知识工厂简介。第 1 页内容。',
  '合同编号 HT-2026001，签约方为  甲方御数坊。严禁在项目中硬编码密钥。',
  '第 3 页：附录与声明。',
];

describe('K4 locateQuote（quote → page/§）', () => {
  it('命中跨空白差异的原文 → 返回页码', () => {
    const page = locateQuoteInPages(pages, '签约方为 甲方御数坊。');
    expect(page).toBe(2);
  });

  it('未命中 → undefined / null', () => {
    expect(locateQuoteInPages(pages, '不存在的句子')).toBeUndefined();
    expect(
      locateQuote({ pagesText: pages, locators: [] }, '不存在')
    ).toBeNull();
  });

  it('无 pagesText → null', () => {
    expect(locateQuote({ pagesText: undefined, locators: [] }, 'A')).toBeNull();
  });

  it('同页唯一 section → 带回 §', () => {
    const sidecar: EvidenceSidecar = {
      path: 'x.pdf',
      ext: '.xlsx',
      pagesText: ['表一内容…'],
      locators: [{ lineStart: 1, lineEnd: 20, page: 1, section: '合同台账' }],
    };
    const loc = locateQuote(sidecar, '表一内容');
    expect(loc).toEqual({ page: 1, section: '合同台账' });
  });
});

describe('K4 buildDocCitation', () => {
  it('页码引用格式 doc.pdf#p.12', () => {
    expect(buildDocCitation('C:/a/合同.pdf', { page: 12 })).toBe(
      '合同.pdf#p.12'
    );
  });

  it('页码+章节 doc.xlsx#p.1§台账', () => {
    expect(buildDocCitation('台账.xlsx', { page: 1, section: '台账' })).toBe(
      '台账.xlsx#p.1§台账'
    );
  });

  it('无定位仅文件名', () => {
    expect(buildDocCitation('方案.md', null)).toBe('方案.md');
  });
});

describe('K4 persistExtractionSidecar / loadSidecar', () => {
  it('抽取时持久化 pagesText/locators → 可反读', async () => {
    const rawFile = join(dir, 'doc.pdf');
    const extracted: ExtractedDocument = {
      path: rawFile,
      ext: '.pdf',
      text: pages.join('\n\n'),
      pagesText: pages,
      locators: [
        { lineStart: 1, lineEnd: 10, page: 1 },
        { lineStart: 11, lineEnd: 20, page: 2 },
      ],
      meta: { pageCount: 3, charCount: 100 },
    };
    await persistExtractionSidecar(rawFile, extracted);
    const sidecar = await loadSidecar(rawFile);
    expect(sidecar).not.toBeNull();
    expect(sidecar?.pageCount).toBe(3);
    expect(sidecar?.pagesText?.length).toBe(3);
    // 跨文件反查命中（验证 sidecar 存留可服务证据回链）
    const loc = locateQuote(sidecar, 'HT-2026001');
    expect(loc?.page).toBe(2);
  });

  it('sidecar 不存在 → null', async () => {
    expect(await loadSidecar(join(dir, 'missing.pdf'))).toBeNull();
  });
});

describe('K4 findRawForPage（编译页 → raw 反查）', () => {
  it('按 .meta.json pages 命中源 raw，并缓存结果', async () => {
    const rawDir = join(dir, 'raw');
    const pageFile = join(rawDir, 'doc.pdf'); // raw base（含 .meta.json）
    // 模拟 raw/doc.pdf + raw/doc.pdf.meta.json {pages:[编译页]}
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(pageFile, 'PDF 二进制占位', 'utf-8');
    writeFileSync(
      `${pageFile}.meta.json`,
      JSON.stringify({
        pages: ['C:/knowledge/御数坊-AiDGAtlas知识工厂-v1.0.md'],
        updatedAt: Date.now(),
      }),
      'utf-8'
    );

    const cache = new Map<string, string>();
    const raw = await findRawForPage(
      'C:\\knowledge\\御数坊-AiDGAtlas知识工厂-v1.0.md',
      rawDir,
      cache
    );
    expect(raw).toBe(pageFile);
    // 缓存命中
    const again = await findRawForPage(
      'C:\\knowledge\\御数坊-AiDGAtlas知识工厂-v1.0.md',
      rawDir,
      cache
    );
    expect(again).toBe(pageFile);
    // 未收录页面 → null（负缓存）
    const miss = await findRawForPage('C:/knowledge/other.md', rawDir, cache);
    expect(miss).toBeNull();
  });
});
