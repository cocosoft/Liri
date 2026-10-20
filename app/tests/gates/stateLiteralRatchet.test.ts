/**
 * 状态字面量**棘轮门禁自证（负向对照）**（外部建议 ⑦「Register-or-Fail」，2026-10-20）。
 *
 * 复用纯核心（`scripts/stateLiteralRatchetCore.ts`，经根 scripts 相对导入）——
 * 不在测试里跑全仓扫描（保测试快），断言：
 * ① 词汇表含**瞬态**（`requires_approval` / `awaiting_approval` —— 建议 ⑦ 的登记主体）；
 * ② 词法扫描正确跳过注释 / 模板字面量（不把注释里的词当字面量）；
 * ③ 事实源豁免 + 棘轮 diff（新增 ⇒ 阻断 / 已报备 ⇒ 放行 / 缩小 ⇒ 提示下调）；
 * ④ 基线健康（值 ∈ 词汇表、文件真实存在 —— 防基线漂移成幽灵台账）。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectHits,
  collectSourceFileWhitelist,
  collectVocabulary,
  diffBaseline,
  extractQuotedLiterals,
  toBaselineFiles,
  type StateLiteralBaseline,
} from '../../../scripts/stateLiteralRatchetCore.js';
import { STATE_MACHINES } from '../../src/state/engine/stateMachineCatalog.js';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const BASELINE_PATH = join(
  REPO_ROOT,
  '.trae/architecture/state-literal-baseline.json'
);

describe('状态字面量棘轮 · 纯核心（负向自证）', () => {
  it('词汇表含瞬态 requires_approval / awaiting_approval（建议 ⑦ 登记主体）', () => {
    const vocab = collectVocabulary(STATE_MACHINES);
    expect(vocab.has('requires_approval')).toBe(true);
    expect(vocab.has('awaiting_approval')).toBe(true);
    // 持久化词汇也在（toolCall 4 态）
    expect(vocab.has('running')).toBe(true);
    expect(vocab.has('unknown')).toBe(true);
  });

  it('词法扫描：提取引号字面量，跳过注释 / 模板内容（含转义、未闭合鲁棒）', () => {
    const src = [
      "const a = 'running';",
      'const b = "completed";',
      "// 注释里的 'failed' 不算",
      "/* 块注释 'unknown' 也不算 */",
      'const c = `模板 ${x} 里的 idle 跳过`;',
      "const d = 'escaped \\' quote';",
      "const e = 'unterminated",
    ].join('\n');
    const lits = extractQuotedLiterals(src);
    expect(lits).toContain('running');
    expect(lits).toContain('completed');
    expect(lits).not.toContain('failed');
    expect(lits).not.toContain('unknown');
    expect(lits).not.toContain('idle');
    // 转义引号被跳过（不提前闭合），产出合并后的内容
    expect(lits).toContain('escaped  quote');
  });

  it('事实源豁免 + 棘轮：新增 ⇒ 阻断；已报备 ⇒ 放行；缩小 ⇒ 提示下调', () => {
    const vocab = new Set(['running', 'completed']);
    const whitelist = new Set(['app/src/fact.ts']);
    const files = [
      { file: 'app/src/fact.ts', text: "'running'" }, // 事实源 ⇒ 豁免
      { file: 'app/src/a.ts', text: "'running' 'running'" }, // 重复出现只记一条
      { file: 'app/src/b.ts', text: "'completed'" },
    ];
    const hits = collectHits(files, vocab, whitelist);
    expect(hits).toHaveLength(2);

    const baseline = { version: 1, files: toBaselineFiles(hits) };
    // 已报备 ⇒ 无新增
    expect(diffBaseline(hits, baseline).newHits).toHaveLength(0);
    // 新文件出现 'running' ⇒ 阻断
    const grown = [...hits, { value: 'running', file: 'app/src/new.ts' }];
    const d1 = diffBaseline(grown, baseline);
    expect(d1.newHits).toEqual([{ value: 'running', file: 'app/src/new.ts' }]);
    // 基线里 b.ts 的 'completed' 消失 ⇒ 提示下调（不阻断）
    const shrunk = hits.filter((h) => h.file !== 'app/src/b.ts');
    const d2 = diffBaseline(shrunk, baseline);
    expect(d2.newHits).toHaveLength(0);
    expect(d2.shrinkable).toEqual([
      { value: 'completed', file: 'app/src/b.ts' },
    ]);
  });

  it('基线健康：值 ∈ 词汇表、文件真实存在（防幽灵台账）', () => {
    expect(existsSync(BASELINE_PATH)).toBe(true);
    const base = JSON.parse(
      readFileSync(BASELINE_PATH, 'utf8')
    ) as StateLiteralBaseline;
    expect(base.version).toBe(1);
    const values = Object.keys(base.files);
    expect(values.length).toBeGreaterThan(0);

    const vocab = collectVocabulary(STATE_MACHINES);
    for (const value of values) {
      expect(vocab.has(value)).toBe(true);
      for (const file of base.files[value]) {
        expect(existsSync(join(REPO_ROOT, file))).toBe(true);
      }
    }
  });
});
