/**
 * `lint:orphan-gates` 门禁自证（2026-11-23）。
 *
 * 背景：连续两轮发现"只定义、从未执行"的孤儿门禁（lint:tool-risk / lint:acceptance /
 * lint:shadow-tools）⇒ 新增元门禁。本用例锁死两件事：
 *  ① 判据**非恒真**：无执行面且未登记 ⇒ 必报；已接线却仍登记 ⇒ 必报；台账陈旧 ⇒ 必报；
 *  ② 真实台账**自洽**：每条都有非空理由、且对应脚本仍存在。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  executableLines,
  findOrphanGates,
} from '../../scripts/lint-orphan-gates';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

function run(
  scripts: Record<string, string>,
  surfaces: Partial<{
    ciBody: string;
    workflowText: string;
    hookText: string;
    allowlist: Record<string, string>;
  }> = {}
) {
  return findOrphanGates({
    scripts: { ci: '', ...scripts },
    ciBody: surfaces.ciBody ?? '',
    workflowText: surfaces.workflowText ?? '',
    hookText: surfaces.hookText ?? '',
    allowlist: surfaces.allowlist ?? {},
  });
}

describe('lint:orphan-gates 判据（门禁自证）', () => {
  it('负向夹具：门禁类脚本无执行面且未登记 ⇒ missing', () => {
    const report = run({ 'lint:ghost': 'x' });
    expect(report.missing).toEqual(['lint:ghost']);
  });

  it('负向夹具：登记了非空理由 ⇒ 不再 missing，计入手动工具', () => {
    const report = run(
      { 'lint:ghost': 'x' },
      { allowlist: { 'lint:ghost': '一次性' } }
    );
    expect(report.missing).toEqual([]);
    expect(report.allowlistedCount).toBe(1);
  });

  it('负向夹具：已接线却仍登记 ⇒ wiredButAllowlisted（防台账腐化）', () => {
    const report = run(
      { 'lint:live': 'x' },
      { ciBody: 'bun run lint:live', allowlist: { 'lint:live': '理由' } }
    );
    expect(report.wiredButAllowlisted).toEqual(['lint:live']);
  });

  it('负向夹具：台账含已不存在的脚本 ⇒ staleAllowlistEntries', () => {
    const report = run({}, { allowlist: { 'lint:deleted': '理由' } });
    expect(report.staleAllowlistEntries).toEqual(['lint:deleted']);
  });

  it('负向夹具：workflow / pre-commit 模板里的 bun run 同样算执行面', () => {
    expect(
      run({ 'lint:w': 'x' }, { workflowText: 'bun run lint:w' }).missing
    ).toEqual([]);
    expect(
      run({ 'lint:h': 'x' }, { hookText: 'for GATE in lint:a lint:h; do' })
        .missing
    ).toEqual([]);
  });

  it('注释与 echo 提示文案中的名字**不算**执行面（防假绿）', () => {
    expect(
      executableLines(
        'echo "修复: bun run gen:thing"\n# bun run lint:commented\nbun run lint:real'
      )
    ).toBe('bun run lint:real');
  });

  it('真实台账：每条理由非空，且登记的脚本仍存在于 package.json', () => {
    const allowlist = JSON.parse(
      readFileSync(
        join(REPO_ROOT, '.trae', 'architecture', 'orphan-gate-allowlist.json'),
        'utf8'
      )
    ) as { scripts?: Record<string, string> };
    const scripts = Object.entries(allowlist.scripts ?? {});
    expect(scripts.length).toBeGreaterThan(0);

    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };

    for (const [name, reason] of scripts) {
      expect({ name, hasReason: String(reason).trim().length > 0 }).toEqual({
        name,
        hasReason: true,
      });
      expect({ name, exists: name in pkg.scripts }).toEqual({
        name,
        exists: true,
      });
    }
  });
});
