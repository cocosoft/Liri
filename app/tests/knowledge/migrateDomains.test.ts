// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `migrate-knowledge-domains`（S3 / issue #11，2026-10-29）
 *
 * 验收（issue 正文）：
 *  - 在 `mkdtemp` 造的临时 `LIRI_HOME` 上跑 **dry-run → apply → 再 apply**，断言最后一步 **0 变更**；
 *  - 迁移是「复制到 `domains/default/` + 原项移动到 `knowledge/legacy/<时间戳>/`」，**不删除**；
 *  - 默认 dry-run **零副作用**。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  applyKnowledgeDomainMigration,
  formatMigrationPlan,
  planKnowledgeDomainMigration,
} from '../../scripts/migrate-knowledge-domains';

const HOME_KEY = 'LIRI_HOME';

let originalHome: string | undefined;
let tmpHome = '';
let knowledgeRoot = '';

beforeEach(() => {
  originalHome = process.env[HOME_KEY];
  tmpHome = mkdtempSync(join(tmpdir(), 'liri-s3-'));
  process.env[HOME_KEY] = tmpHome;
  knowledgeRoot = join(tmpHome, 'knowledge');

  // 造「全局知识库」：wiki / index.md / log.md / .schema
  mkdirSync(join(knowledgeRoot, 'wiki'), { recursive: true });
  mkdirSync(join(knowledgeRoot, '.schema'), { recursive: true });
  writeFileSync(join(knowledgeRoot, 'wiki', 'a.md'), '# a\n内容 A', 'utf-8');
  writeFileSync(join(knowledgeRoot, 'index.md'), '# index', 'utf-8');
  writeFileSync(join(knowledgeRoot, 'log.md'), '# log', 'utf-8');
  writeFileSync(
    join(knowledgeRoot, '.schema', 'entities.yaml'),
    'entities: []',
    'utf-8'
  );
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env[HOME_KEY];
  } else {
    process.env[HOME_KEY] = originalHome;
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
});

describe('migrate-knowledge-domains（S3）', () => {
  test('dry-run 只算计划，磁盘零变更', () => {
    const plan = planKnowledgeDomainMigration();

    expect(plan.items.map((i) => i.name).sort()).toEqual(
      ['.schema', 'index.md', 'log.md', 'wiki'].sort()
    );
    expect(plan.skipped).toEqual([]);
    // 计划阶段不得创建任何东西
    expect(existsSync(plan.defaultDomainDir)).toBe(false);
    expect(existsSync(join(knowledgeRoot, 'wiki', 'a.md'))).toBe(true);
    expect(formatMigrationPlan(plan).join('\n')).toContain('待迁移项：4');
  });

  test('apply：域目录拿到副本，原项移到 legacy（不删除）', () => {
    const plan = planKnowledgeDomainMigration();
    const result = applyKnowledgeDomainMigration(plan, '2026-10-29T00-00-00');

    expect(result.moved.sort()).toEqual([
      '.schema',
      'index.md',
      'log.md',
      'wiki',
    ]);
    expect(result.legacyDir).toBe(
      join(knowledgeRoot, 'legacy', '2026-10-29T00-00-00')
    );

    // 域目录：内容一致
    const domainWiki = join(plan.defaultDomainDir, 'wiki', 'a.md');
    expect(readFileSync(domainWiki, 'utf-8')).toContain('内容 A');
    expect(existsSync(join(plan.defaultDomainDir, 'index.md'))).toBe(true);
    expect(
      existsSync(join(plan.defaultDomainDir, '.schema', 'entities.yaml'))
    ).toBe(true);

    // 原全局项已移走（不是删除：legacy 里有）
    expect(existsSync(join(knowledgeRoot, 'wiki'))).toBe(false);
    expect(existsSync(join(knowledgeRoot, 'index.md'))).toBe(false);
    expect(existsSync(join(result.legacyDir!, 'wiki', 'a.md'))).toBe(true);
    expect(existsSync(join(result.legacyDir!, 'log.md'))).toBe(true);
  });

  test('再 apply ⇒ 0 变更且不新建 legacy 目录（幂等）', () => {
    const first = applyKnowledgeDomainMigration(
      planKnowledgeDomainMigration(),
      '2026-10-29T00-00-01'
    );
    expect(first.moved).toHaveLength(4);

    const plan2 = planKnowledgeDomainMigration();
    expect(plan2.items).toEqual([]);

    const second = applyKnowledgeDomainMigration(plan2, '2026-10-29T00-00-02');
    expect(second.moved).toEqual([]);
    expect(second.legacyDir).toBeNull();
    expect(
      existsSync(join(knowledgeRoot, 'legacy', '2026-10-29T00-00-02'))
    ).toBe(false);
    expect(formatMigrationPlan(plan2).join('\n')).toContain('待迁移项：0');
  });

  test('目标已存在但源仍在 ⇒ 该项跳过并在计划里说明（不覆盖域内内容）', () => {
    // 预置 domains/default/index.md，模拟「已迁移过 index」但全局还留着一份
    const domainDir = join(knowledgeRoot, 'domains', 'default');
    mkdirSync(domainDir, { recursive: true });
    writeFileSync(join(domainDir, 'index.md'), '# 域内既有', 'utf-8');

    const plan = planKnowledgeDomainMigration();

    expect(plan.items.map((i) => i.name)).not.toContain('index.md');
    expect(plan.skipped).toContain('index.md');
    expect(formatMigrationPlan(plan).join('\n')).toContain('已跳过');
  });
});
