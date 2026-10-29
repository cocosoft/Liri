// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `knowledgeContext` 段的知识域透传（S5，2026-10-29，issue #15）
 *
 * 口径（用户 2026-10-29 裁定 + 本轮最小可交付）：
 *  - 域来源 = 会话 `metadata.domain`（由 `MessageContextPipeline` 每轮覆盖式注入
 *    `setCurrentKnowledgeDomain`）；
 *  - 合法性在**消费侧**（本段）统一校验：域不存在 ⇒ warn 并**回全局**；
 *  - **未设置 ⇒ 传 `undefined`**（默认行为不变，不允许静默改默认）；
 *  - 检索侧真正的「按域限缩」尚未接线（`KnowledgeSummarizer` 有 TODO），
 *    本文件只锁「参数是否按上述规则传到 provider」。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveDomainsRoot } from '../../src/environment/paths';
import { DomainManager } from '../../src/knowledge/domain';
import {
  setCurrentKnowledgeQuery,
  setCurrentKnowledgeDomain,
  setKnowledgeQueryProvider,
} from '../../src/services/prompt/KnowledgePromptProvider';
import { BUILTIN_SECTIONS } from '../../src/context/promptSections/builtinSections';

const HOME_KEY = 'LIRI_HOME';

let originalHome: string | undefined;
let tmpHome = '';
let domainsRoot = '';

/** 记录 provider 实际收到的参数 */
let calls: Array<[string, number | undefined, string | undefined]> = [];
let summaries: Array<Record<string, unknown>> = [];

const section = BUILTIN_SECTIONS.knowledgeContext;

beforeEach(() => {
  originalHome = process.env[HOME_KEY];
  tmpHome = mkdtempSync(join(tmpdir(), 'liri-s5-domain-'));
  process.env[HOME_KEY] = tmpHome;
  domainsRoot = resolveDomainsRoot();
  if (!domainsRoot.startsWith(tmpHome)) {
    throw new Error(
      `LIRI_HOME 覆盖未生效，拒绝在真实目录上运行：${domainsRoot}`
    );
  }

  calls = [];
  summaries = [
    {
      title: 't',
      content: 'c',
      category: 'cat',
      score: 1,
      docPath: 'p.md',
    },
  ];
  setKnowledgeQueryProvider({
    getKnowledgeSummaries: async (query, limit, domain) => {
      calls.push([query, limit, domain]);
      return { summaries, totalCount: summaries.length } as never;
    },
  });
  setCurrentKnowledgeQuery('光合作用是什么');
  setCurrentKnowledgeDomain(undefined);
});

afterEach(() => {
  setCurrentKnowledgeDomain(undefined);
  if (originalHome === undefined) {
    delete process.env[HOME_KEY];
  } else {
    process.env[HOME_KEY] = originalHome;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('knowledgeContext 段的域透传（S5）', () => {
  test('未设置域 ⇒ provider 第 3 参为 undefined（默认行为不变）', async () => {
    const rendered = await section.compute();

    expect(calls).toEqual([['光合作用是什么', 3, undefined]]);
    expect(rendered).toContain('## 相关知识');
  });

  test('域存在 ⇒ 原样透传域名', async () => {
    await new DomainManager().create('botany', { label: '植物学' });
    setCurrentKnowledgeDomain('botany');

    await section.compute();

    expect(calls).toEqual([['光合作用是什么', 3, 'botany']]);
  });

  test('域不存在 ⇒ 回落全局（provider 收到 undefined），仍返回结果', async () => {
    setCurrentKnowledgeDomain('ghost-domain');

    const rendered = await section.compute();

    expect(calls).toEqual([['光合作用是什么', 3, undefined]]);
    expect(rendered).toContain('## 相关知识');
  });

  test('空白域串 ⇒ 视为未设置（不触发校验、不传参）', async () => {
    setCurrentKnowledgeDomain('   ');

    await section.compute();

    expect(calls).toEqual([['光合作用是什么', 3, undefined]]);
  });

  test('provider 无结果 ⇒ 段落返回 null（既有行为不变）', async () => {
    summaries = [];

    const rendered = await section.compute();

    expect(rendered).toBeNull();
  });
});
