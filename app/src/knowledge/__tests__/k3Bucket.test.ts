// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// R3：规则全表列出 / 强度标签 / 跨批冲突语义（纯 store + 工具函数，无 LLM）

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RuleStore } from '../rule/RuleStore';
import { detectRuleConflicts, buildRuleId } from '../rule/RuleExtractor';
import { strengthLabel } from '../search/UnifiedSearchService';

let dir: string;
let store: RuleStore | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'r3-rule-test-'));
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
    // Windows 句柄释放延迟，忽略
  }
});

describe('R3 strengthLabel（强度徽标语义）', () => {
  it('三档强度映射中文标签', () => {
    expect(strengthLabel('mandatory')).toBe('必须');
    expect(strengthLabel('should')).toBe('应');
    expect(strengthLabel('may')).toBe('可');
    expect(strengthLabel('unknown')).toBe('unknown');
  });
});

describe('R3 RuleStore.listAll（跨批全表扫描输入）', () => {
  beforeAll(async () => {
    store = new RuleStore(join(dir, 'rules.db'));
    await store!.init();
    // 两个"批次"：A 声明与 B 冲突（跨批语义即全表传入 detectRuleConflicts）
    const a = buildRuleId('policy', '严禁未验收先行付款');
    const b = buildRuleId('guideline', '建议允许分期付款');
    await store!.upsert({
      id: a,
      kind: 'policy',
      statement: '严禁未验收先行付款',
      triggers: ['付款'],
      constraintStrength: 'mandatory',
      appliesTo: [],
      conflictOf: [b],
      evidence: { statement: '严禁在未完成验收的情况下支付全部尾款。' },
      domain: 'knowledge',
      sourceFile: 'A.md',
    });
    await store!.upsert({
      id: b,
      kind: 'guideline',
      statement: '建议允许分期付款',
      triggers: ['付款'],
      constraintStrength: 'should',
      appliesTo: [],
      conflictOf: [],
      evidence: { statement: '建议允许双方协商调整付款计划。' },
      domain: 'knowledge',
      sourceFile: 'B.md',
    });
  });

  it('listAll 返回全部跨批规则', async () => {
    const all = await store!.listAll();
    expect(all.length).toBe(2);
    const kinds = all.map((r) => r.kind).sort();
    expect(kinds).toEqual(['guideline', 'policy']);
  });

  it('跨批 conflictOf：A→B 不对称被检出', async () => {
    const all = await store!.listAll();
    const warnings = detectRuleConflicts(
      all.map((r) => ({
        id: r.id,
        statement: r.statement,
        conflictOf: r.conflictOf,
      }))
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('不对称'))).toBe(true);
  });
});
