// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `knowledgeDomains` 段落（S6，2026-10-29，issue #13）
 *
 * 验收来自 issue 正文：
 *  (a) 有域时含域名与描述；
 *  (b) **不含**任何 wiki 正文（只列元数据）；
 *  (c) 零域时不出现段标题（`compute()` 返回 null ⇒ 整段省略）。
 *
 * 隔离：与 S2 同法，把 `LIRI_HOME` 指向 `mkdtemp`，并带「覆盖未生效即抛错」护栏，
 * 保证不读写真实 `~/.pyapp`。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveDomainsRoot } from '../../src/environment/paths';
import { DomainManager } from '../../src/knowledge/domain';
import { BUILTIN_SECTIONS } from '../../src/context/promptSections/builtinSections';

const HOME_KEY = 'LIRI_HOME';

let originalHome: string | undefined;
let tmpHome = '';
let domainsRoot = '';

/** 被验收的段落（实现体在 builtinSections） */
const section = BUILTIN_SECTIONS.knowledgeDomains;

beforeEach(() => {
  originalHome = process.env[HOME_KEY];
  tmpHome = mkdtempSync(join(tmpdir(), 'liri-domains-prompt-'));
  process.env[HOME_KEY] = tmpHome;
  domainsRoot = resolveDomainsRoot();

  if (!domainsRoot.startsWith(tmpHome)) {
    throw new Error(
      `LIRI_HOME 覆盖未生效，拒绝在真实目录上运行：${domainsRoot}`
    );
  }
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env[HOME_KEY];
  } else {
    process.env[HOME_KEY] = originalHome;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('knowledgeDomains 段落（S6）', () => {
  test('零域 ⇒ 返回 null（整段省略，不产生空标题）', async () => {
    const rendered = await section.compute();

    expect(rendered).toBeNull();
  });

  test('有域 ⇒ 含 name / label / description，且不含任何 wiki 正文', async () => {
    const manager = new DomainManager();
    await manager.create('botany', {
      label: '植物学',
      description: '植物分类、光合作用与生态学',
      queryHints: { keywords: ['植物', '光合作用'] },
    });
    // 域内塞一篇 wiki 正文：断言它**不会**被注入提示词
    writeFileSync(
      join(domainsRoot, 'botany', 'wiki', 'venus_flytrap.md'),
      '# 捕蝇草\nWIKI_BODY_SENTINEL 这段正文不该出现在提示词里',
      'utf-8'
    );

    const rendered = await section.compute();

    expect(typeof rendered).toBe('string');
    // (a) 元数据在
    expect(rendered).toContain('botany');
    expect(rendered).toContain('植物学');
    expect(rendered).toContain('植物分类、光合作用与生态学');
    // (b) 正文不在
    expect(rendered).not.toContain('WIKI_BODY_SENTINEL');
    expect(rendered).not.toContain('捕蝇草');
  });

  test('label 与 name 相同 ⇒ 只显示 name（不出现 name（name） 的重复形态）', async () => {
    await new DomainManager().create('bare');

    const rendered = await section.compute();

    expect(rendered).toContain('- bare');
    expect(rendered).not.toContain('bare（bare）');
  });

  test('多个域 ⇒ 一行一域（行数 = 域数 + 段头两行 + 引导语一行之外的条目行）', async () => {
    const manager = new DomainManager();
    await manager.create('botany', { label: '植物学' });
    await manager.create('dist', { label: '分布式系统' });

    const rendered = (await section.compute()) ?? '';
    const bulletLines = rendered
      .split('\n')
      .filter((line) => line.startsWith('- '));

    expect(bulletLines.length).toBe(2);
    expect(bulletLines.join('\n')).toContain('植物学（botany）');
    expect(bulletLines.join('\n')).toContain('分布式系统（dist）');
  });
});
