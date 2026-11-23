/**
 * 依赖许可证门禁「台账 + 收紧模式」守卫（2026-11-23）。
 *
 * 背景：`lint:license` 原为默认非阻断的**报告**，接进 CI 也只是空转。现升级为
 * `--fail-on=copyleft,unknown` 真门禁，并把已复核接受的依赖登记在
 * `.trae/architecture/license-allowlist.json`。本用例锁死：
 *  ① 台账每条都写了**非空复核理由**（防止「加个名字就放行」）；
 *  ② `lint:license` 脚本**仍带 --fail-on**（防止被静默降级回只报告）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');

describe('依赖许可证门禁（R12）', () => {
  it('台账：每个条目都有非空复核理由', () => {
    const raw = JSON.parse(
      readFileSync(
        join(REPO_ROOT, '.trae', 'architecture', 'license-allowlist.json'),
        'utf8'
      )
    ) as { packages?: Record<string, { reason?: string }> };

    const entries = Object.entries(raw.packages ?? {});
    expect(entries.length).toBeGreaterThan(0);

    for (const [pattern, entry] of entries) {
      expect({
        pattern,
        hasReason: (entry.reason ?? '').trim().length > 0,
      }).toEqual({ pattern, hasReason: true });
    }
  });

  it('`lint:license` 必须保持 --fail-on（防止降级回只报告的空转门禁）', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    const script = pkg.scripts['lint:license'] ?? '';
    expect(script).toContain('check-license-compliance.ts');
    expect(script).toContain('--fail-on=copyleft,unknown');
  });
});
