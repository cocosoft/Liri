// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// K3 规则类知识：rules.yaml 白名单加载、规则候选校验、conflictOf 配对、RuleStore 落库测试。

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RuleSchema } from '../schema/SchemaLoader';
import { SchemaLoader } from '../schema/SchemaLoader';
import type { RuleCandidate } from '../rule/RuleExtractor';
import {
  validateRuleCandidate,
  buildRuleId,
  detectRuleConflicts,
} from '../rule/RuleExtractor';
import type { RuleRecord } from '../rule/types';
import { RuleStore } from '../rule/RuleStore';

let dir: string;
let store: RuleStore | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'k3-rule-test-'));
});

afterAll(async () => {
  await store?.close();
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

const ruleSchemas: Map<string, RuleSchema> = new Map([
  [
    'policy',
    {
      kind: 'policy',
      displayName: '强制性要求',
      description: '',
      strengths: ['mandatory'],
    },
  ],
  [
    'guideline',
    {
      kind: 'guideline',
      displayName: '推荐做法',
      description: '',
      strengths: ['should', 'may'],
    },
  ],
  ['tip', { kind: 'tip', displayName: '提示', description: '', strengths: [] }],
]);

describe('K3 loadRules（rules.yaml 白名单）', () => {
  it('解析白名单：过滤非法强度与缺 kind 项', async () => {
    writeFileSync(
      join(dir, 'rules.yaml'),
      [
        'rules:',
        '  - kind: policy',
        '    displayName: 强制性要求',
        '    description: 必须遵守',
        '    strengths: [mandatory]',
        '  - kind: badkind',
        '    displayName: 未声明强度',
        '    strengths: [superstrict]',
        '  - displayName: 缺 kind 定义',
        '    description: 非法示例',
        '    strengths: [should]',
      ].join('\n'),
      'utf-8'
    );
    const loader = new SchemaLoader(dir);
    const rules = await loader.loadRules();
    expect(rules.has('policy')).toBe(true);
    expect(rules.get('policy')?.strengths).toEqual(['mandatory']);
    // 非法强度项被过滤为空集，但 kind 合法仍保留（白名单"不限强度"语义）
    expect(rules.has('badkind')).toBe(true);
    expect(rules.get('badkind')?.strengths).toEqual([]);
    // 缺 kind 项整体跳过
    expect(rules.has('no-name')).toBe(false);
  });
});

describe('K3 validateRuleCandidate', () => {
  const base: RuleCandidate = {
    kind: 'policy',
    statement: '严禁在项目中硬编码密钥',
    triggers: ['编码'],
    constraintStrength: 'mandatory',
    evidence: { statement: '严禁在项目中硬编码密钥。' },
  };

  it('合法候选通过', () => {
    expect(validateRuleCandidate(base, ruleSchemas.get('policy'))).toBeNull();
  });

  it('未声明 kind → 拒绝', () => {
    const r = validateRuleCandidate(base, undefined);
    expect(r).toContain('未在 rules.yaml 中声明的 kind');
  });

  it('强度非法 → 拒绝', () => {
    const r = validateRuleCandidate(
      { ...base, constraintStrength: 'sometimes' },
      ruleSchemas.get('policy')
    );
    expect(r).toContain('非法强度');
  });

  it('强度不在类别白名单 → 拒绝', () => {
    // policy 仅允许 mandatory；should 应拒绝
    const r = validateRuleCandidate(
      { ...base, kind: 'policy', constraintStrength: 'should' },
      ruleSchemas.get('policy')
    );
    expect(r).toContain('不在');
  });

  it('statement 为空 → 拒绝', () => {
    const r = validateRuleCandidate(
      { ...base, statement: '   ' },
      ruleSchemas.get('policy')
    );
    expect(r).toContain('statement');
  });

  it('缺 evidence.statement → 拒绝', () => {
    const r = validateRuleCandidate(
      { ...base, evidence: {} },
      ruleSchemas.get('policy')
    );
    expect(r).toContain('evidence');
  });
});

describe('K3 detectRuleConflicts / buildRuleId', () => {
  it('冲突指向不存在规则 → warning', () => {
    const rules: Array<Pick<RuleRecord, 'id' | 'statement' | 'conflictOf'>> = [
      { id: 'a', statement: 'A', conflictOf: ['ghost'] },
    ];
    const warnings = detectRuleConflicts(rules);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('ghost');
  });

  it('不对称冲突声明 → warning', () => {
    const rules = [
      { id: 'a', statement: 'A', conflictOf: ['b'] },
      { id: 'b', statement: 'B', conflictOf: [] },
    ];
    const warnings = detectRuleConflicts(rules);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('不对称');
  });

  it('成对互指冲突 → 无 warning', () => {
    const rules = [
      { id: 'a', statement: 'A', conflictOf: ['b'] },
      { id: 'b', statement: 'B', conflictOf: ['a'] },
    ];
    expect(detectRuleConflicts(rules)).toEqual([]);
  });

  it('规则 id 确定性（同陈述同 id）', () => {
    expect(buildRuleId('policy', '严禁硬编码密钥')).toBe(
      buildRuleId('policy', '严禁硬编码密钥')
    );
    expect(buildRuleId('policy', 'A')).not.toBe(buildRuleId('guideline', 'A'));
  });
});

describe('K3 RuleStore（落库/去重/检索）', () => {
  beforeAll(() => {
    store = new RuleStore(join(dir, 'rules.db'));
  });

  it('同 id upsert 去重并更新', async () => {
    await store!.init();
    await store!.upsert({
      id: 'policy:abc',
      kind: 'policy',
      statement: '严禁硬编码密钥',
      triggers: ['开发'],
      constraintStrength: 'mandatory',
      evidence: { statement: '严禁在代码中硬编码密钥。' },
      sourceFile: 'a.md',
    });
    await store!.upsert({
      id: 'policy:abc',
      kind: 'policy',
      statement: '严禁硬编码密钥（修订）',
      constraintStrength: 'mandatory',
      sourceFile: 'a.md',
    });
    expect(await store!.count('policy')).toBe(1);
    const found = await store!.search('密钥', { kind: 'policy' });
    expect(found.length).toBe(1);
    expect(found[0].statement).toContain('修订');
    expect(found[0].constraintStrength).toBe('mandatory');
  });

  it('按强度检索 + deleteBySource 清理', async () => {
    await store!.upsert({
      id: 'guideline:d1',
      kind: 'guideline',
      statement: '建议每日备份',
      constraintStrength: 'should',
      sourceFile: 'b.md',
    });
    const should = await store!.search('备份', { strength: 'should' });
    expect(should.length).toBe(1);
    const deleted = await store!.deleteBySource('b.md');
    expect(deleted).toBe(1);
    expect(await store!.count()).toBe(1); // 仅剩 policy:abc
  });
});
