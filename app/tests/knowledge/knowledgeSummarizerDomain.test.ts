// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `KnowledgeSummarizer` 的知识域限缩（S5 剩余部分，2026-10-29，issue #15）
 *
 * 契约（issue #15 原定验收）：「传入 domain ⇒ 检索根变成 `domains/{name}`」。
 * 实现分两条链，本文件分别锁住：
 *  1. **搜索链**：域名进入 `KnowledgeRouterOptions.domain`（内核 `filterByDomain` 生效）；
 *  2. **digest 链**：`DocDigest` 无 domain 字段 ⇒ 按 `resolveDomainDir(domain)` **路径前缀**过滤。
 * 负向：未传域 ⇒ options 里**不出现** domain（默认行为不变）；域内无命中 ⇒ 返回空、**不回落全局**。
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { KnowledgeRouterOptions } from '../../src/docs/knowledge-types';
import {
  resolveDomainDir,
  resolveKnowledgeDir,
} from '../../src/environment/paths';
import { KnowledgeSummarizer } from '../../src/knowledge/KnowledgeSummarizer';
import { KnowledgeDigestService } from '../../src/knowledge/KnowledgeDigestService';
import type { IKnowledgeSearch } from '../../src/docs/knowledge-types';

const HOME_KEY = 'LIRI_HOME';

let originalHome: string | undefined;
let tmpHome = '';
let searchCalls: Array<KnowledgeRouterOptions | undefined> = [];
let routes: Array<Record<string, unknown>> = [];

function makeRouter(): IKnowledgeSearch {
  return {
    search: async (
      _query: string,
      options?: KnowledgeRouterOptions
    ): Promise<never> => {
      searchCalls.push(options);
      const scoped = options?.domain
        ? routes.filter((r) =>
            String(r.docPath).includes(`/domains/${options.domain}/`)
          )
        : routes;
      return scoped as never;
    },
  } as unknown as IKnowledgeSearch;
}

function route(name: string, docPath: string) {
  return {
    title: name,
    snippet: `${name} 摘要`,
    category: 'cat',
    score: 0.9,
    docPath,
    matchType: 'keyword',
    matchField: 'content',
    isKnowledgeDoc: true,
  };
}

beforeAll(() => {
  originalHome = process.env[HOME_KEY];
  tmpHome = mkdtempSync(join(tmpdir(), 'liri-s5-summarizer-'));
  process.env[HOME_KEY] = tmpHome;

  // `getDefaultDigestService()` 是**模块级单例**，首次调用就绑定当时的 `LIRI_HOME`
  // ⇒ 整个文件必须共用同一个临时 home（否则单例还指向上一个用例的目录）。
  const knowledgeDir = resolveKnowledgeDir();
  const domainWiki = join(resolveDomainDir('botany'), 'wiki');
  const cacheDir = join(knowledgeDir, '.knowledge-cache');
  mkdirSync(domainWiki, { recursive: true });
  mkdirSync(join(knowledgeDir, 'wiki'), { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  // 让 digest 的「陈旧检查」有真实文件可比（否则会触发重建、丢掉我们写入的缓存）
  writeFileSync(join(domainWiki, 'a.md'), '# 域内文档\n光合作用', 'utf-8');
  writeFileSync(
    join(knowledgeDir, 'wiki', 'b.md'),
    '# 全局文档\n光合作用',
    'utf-8'
  );

  const digestDoc = (title: string, relPath: string, absPath: string) => ({
    // DocDigest.path 是**相对 knowledgeRoot** 的路径（checkStaleness 会 join 还原）
    path: relPath,
    title,
    summary: '光合作用 相关摘要',
    tags: [] as string[],
    category: 'cat',
    wordCount: 10,
    // 必须与真实 mtime 一致，否则 checkStaleness 判定陈旧 → 重建缓存
    lastModified: statSync(absPath).mtime.toISOString(),
    lineCount: 1,
  });
  writeFileSync(
    join(cacheDir, 'digest.json'),
    JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      docs: [
        digestDoc(
          '域内文档',
          'domains/botany/wiki/a.md',
          join(domainWiki, 'a.md')
        ),
        digestDoc('全局文档', 'wiki/b.md', join(knowledgeDir, 'wiki', 'b.md')),
      ],
    }),
    'utf-8'
  );
});

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env[HOME_KEY];
  } else {
    process.env[HOME_KEY] = originalHome;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  searchCalls = [];
  routes = [
    route(
      '域内',
      join(resolveDomainDir('botany'), 'wiki', 'a.md').replaceAll('\\', '/')
    ),
    route(
      '域外',
      join(resolveKnowledgeDir(), 'wiki', 'b.md').replaceAll('\\', '/')
    ),
  ];
});

describe('KnowledgeSummarizer 域限缩（S5）', () => {
  test('未传域 ⇒ 全局：options 不含 domain，结果不过滤', async () => {
    const summarizer = new KnowledgeSummarizer(makeRouter());

    const result = await summarizer.getKnowledgeSummaries('量子', 3);

    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]?.domain).toBeUndefined();
    expect(result.summaries).toHaveLength(2);
    expect(result.source).toBe('search');
  });

  test('传域 ⇒ 域名进入 options.domain（搜索根限缩到 domains/{name}）', async () => {
    const summarizer = new KnowledgeSummarizer(makeRouter());

    const result = await summarizer.getKnowledgeSummaries('量子', 3, 'botany');

    expect(searchCalls[0]?.domain).toBe('botany');
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.docPath).toContain('/domains/botany/');
  });

  test('域内无命中 ⇒ 返回空、**不回落全局**', async () => {
    const summarizer = new KnowledgeSummarizer(makeRouter());

    const result = await summarizer.getKnowledgeSummaries(
      '光合作用',
      3,
      'ghost'
    );

    expect(result.summaries).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  test('空白域名 ⇒ 视为未设置（options 不含 domain）', async () => {
    const summarizer = new KnowledgeSummarizer(makeRouter());

    await summarizer.getKnowledgeSummaries('量子', 3, '   ');

    expect(searchCalls[0]?.domain).toBeUndefined();
  });

  test('digest 链：searchDigest(query, domain) 按域目录前缀过滤', async () => {
    // 直接构造服务实例（构造时按当前 LIRI_HOME 解析路径），避免依赖模块级单例的绑定时机
    const digestService = new KnowledgeDigestService();
    const scoped = await digestService.searchDigest('光合作用', 'botany');

    expect(scoped).toHaveLength(1);
    // digest 的 path 是**相对 knowledgeRoot** 的路径
    const scopedPath = (scoped[0]?.path ?? '').replaceAll('\\', '/');
    expect(scopedPath.startsWith('domains/botany/')).toBe(true);
  });
});
