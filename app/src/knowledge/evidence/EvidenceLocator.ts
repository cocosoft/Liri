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
 * K4 证据回链 — EvidenceLocator
 *
 * 依赖 K1 抽取器产出的 .locators.json sidecar（pagesText + locators），
 * 检索/问答期把"原文摘句(quote)"反查为页码/章节，并构建统一引用格式：
 *   doc.pdf#p.12          （页码）
 *   doc.xlsx#p.1§台账      （页码 + 章节/sheet）
 *   doc.md                （无定位时仅文件名）
 *
 * 纯函数集中于此便于单测；text 类（md/txt）走既有 #L 行号引用不在此服务。
 */

import { readdir, readFile } from 'fs/promises';
import { basename, join } from 'path';

/** locators.json sidecar 内容结构 */
export interface EvidenceSidecar {
  path: string;
  ext: string;
  pageCount?: number;
  charCount?: number;
  locators: Array<{
    lineStart: number;
    lineEnd: number;
    page?: number;
    section?: string;
    tableId?: string;
  }>;
  pagesText?: string[];
}

/** quote 反查结果 */
export interface LocatedEvidence {
  page?: number;
  section?: string;
}

/** 规范化文本用于匹配（去空白差异） */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 在逐页文本中定位引用摘句 → 页码（1-based）。
 * 无 pagesText 或未命中返回 undefined。
 */
export function locateQuoteInPages(
  pagesText: string[] | undefined,
  quote: string
): number | undefined {
  if (!pagesText || pagesText.length === 0) return undefined;
  const needle = normalize(quote);
  if (!needle) return undefined;
  for (let i = 0; i < pagesText.length; i++) {
    const pageText = pagesText[i] ?? '';
    if (normalize(pageText).includes(needle)) {
      return i + 1;
    }
  }
  return undefined;
}

/**
 * quote → {page?, section?}：
 * 先按 pagesText 命中页码；再尝试从同页 locators 中推断章节
 * （locators 命中该页且整页只有唯一 section 时带回）。
 */
export function locateQuote(
  sidecar: Pick<EvidenceSidecar, 'pagesText' | 'locators'> | null | undefined,
  quote: string
): LocatedEvidence | null {
  if (!sidecar) return null;
  const page = locateQuoteInPages(sidecar.pagesText, quote);
  if (page === undefined) return null;

  const locators = sidecar.locators ?? [];
  const pageLocators = locators.filter((l) => l.page === page && l.section);
  let section: string | undefined;
  if (pageLocators.length === 1) {
    section = pageLocators[0].section;
  }
  return section ? { page, section } : { page };
}

/** 构造统一引用：{basename}#p.{page}[§{section}] */
export function buildDocCitation(
  docPath: string,
  loc: LocatedEvidence | null | undefined
): string {
  const base = basename(docPath);
  if (!loc) return base;
  if (loc.page !== undefined) {
    const suffix = loc.section ? `§${loc.section}` : '';
    return `${base}#p.${loc.page}${suffix}`;
  }
  return base;
}

/** 读取 raw 文件旁的 .locators.json */
export async function loadSidecar(
  rawFile: string
): Promise<EvidenceSidecar | null> {
  try {
    const raw = await readFile(`${rawFile}.locators.json`, 'utf-8');
    return JSON.parse(raw) as EvidenceSidecar;
  } catch {
    return null;
  }
}

/**
 * 由编译页面（md 产物）反查其源 raw 文件：
 * 扫描 rawDir 下各 {file}.meta.json，取 pages 含 pageFile 的对应 raw。
 * @param indexCache 可选缓存（调用方按会话持有，避免重复全目录扫描）
 */
export async function findRawForPage(
  pageFile: string,
  rawDir: string,
  indexCache?: Map<string, string>
): Promise<string | null> {
  if (indexCache) {
    const cached = indexCache.get(pageFile);
    if (cached !== undefined) return cached || null;
  }

  const target = pageFile.replace(/\\/g, '/');
  let rawFound: string | null = null;

  try {
    const entries = await readdir(rawDir);
    for (const name of entries) {
      if (!name.endsWith('.meta.json')) continue;
      const rawBase = name.slice(0, -'.meta.json'.length);
      try {
        const metaRaw = await readFile(join(rawDir, name), 'utf-8');
        const meta = JSON.parse(metaRaw) as { pages?: string[] };
        if (Array.isArray(meta.pages)) {
          const hit = meta.pages.some(
            (p) => p.replace(/\\/g, '/').toLowerCase() === target.toLowerCase()
          );
          if (hit) {
            rawFound = join(rawDir, rawBase);
            break;
          }
        }
      } catch {
        // @ignore-catch 单个 meta 损坏不影响扫描
      }
    }
  } catch {
    // @ignore-catch rawDir 不存在/不可读
  }

  indexCache?.set(pageFile, rawFound ?? '');
  return rawFound;
}
