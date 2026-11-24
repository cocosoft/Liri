/**
 * R09-011（治理方案 P1-3，2026-11-24）：**派生判据唯一登记**。
 *
 * 缺口：同一事实（工具结果态 / 是否待审批 / 等待态 / 编排终态）曾各有 3–4 套判据，
 * 组件各自解释 ⇒ 真机同一调用出现互相矛盾的结论（缺陷 B3/B4 根因）。
 *
 * 本测试校验 `scripts/state-derivations.json`：
 * ① `concept` 与 `implementation` 均唯一（同一概念不得登记两处）；
 * ② `implementation` 形如 `文件#符号`，文件存在且**确实导出**该符号；
 * ③ `consumers` 中的文件真实存在（防陈旧登记）。
 *
 * 说明：方案 §5 原写"新脚本 lint-state-derivations.ts"；本批以 bun test 落地
 * （零 CI 接线风险，随 `bun test` 全量执行），待 P2 再并入 lint:arch。
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const REGISTRY = join(REPO_ROOT, 'scripts', 'state-derivations.json');

interface Derivation {
  concept?: string;
  owner?: string;
  implementation?: string;
  consumers?: string[];
  note?: string;
}

const parsed = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
  version?: number;
  derivations?: Derivation[];
};
const derivations = parsed.derivations ?? [];

/** 该文件是否**导出**了 `symbol`（function / const / class） */
function isExported(file: string, symbol: string): boolean {
  const src = readFileSync(join(REPO_ROOT, file), 'utf8');
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${escaped}\\b`,
    'm'
  ).test(src);
}

describe('R09-011 派生判据唯一登记', () => {
  it('登记表合法且非空（version=1，至少 4 条）', () => {
    expect(parsed.version).toBe(1);
    expect(derivations.length).toBeGreaterThanOrEqual(4);
  });

  it('concept 唯一（同一概念不得多处实现）', () => {
    const concepts = derivations.map((d) => d.concept ?? '');
    expect(new Set(concepts).size).toBe(concepts.length);
    for (const c of concepts) expect(c.trim().length).toBeGreaterThan(0);
  });

  it('implementation 唯一，且锚点真实导出（不登记幽灵实现）', () => {
    const impls = derivations.map((d) => d.implementation ?? '');
    expect(new Set(impls).size).toBe(impls.length);

    for (const d of derivations) {
      const [file, symbol] = (d.implementation ?? '').split('#');
      expect(file?.length ?? 0, `${d.concept} 缺实现文件`).toBeGreaterThan(0);
      expect(symbol?.length ?? 0, `${d.concept} 缺导出符号`).toBeGreaterThan(0);
      const abs = join(REPO_ROOT, file);
      expect(existsSync(abs), `${d.concept} 实现文件不存在：${file}`).toBe(
        true
      );
      expect(
        isExported(file, symbol),
        `${d.concept} 的符号未导出：${file}#${symbol}`
      ).toBe(true);
    }
  });

  it('consumers 文件真实存在（防陈旧登记）', () => {
    for (const d of derivations) {
      for (const rel of d.consumers ?? []) {
        expect(existsSync(join(REPO_ROOT, rel)), `消费方不存在：${rel}`).toBe(
          true
        );
      }
    }
  });
});
