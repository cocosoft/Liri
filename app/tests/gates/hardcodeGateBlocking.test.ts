/**
 * 硬编码治理 §8 门禁 · **阶段③（转 error 级 / CI 必绿）** 自证。
 *
 * 方案：`dev_docs/20261013/硬编码统一治理方案-20261013.md` §8 表第 ③ 行
 *   「上述转 error 级（CI 必绿）」。
 *
 * 为什么需要（同 `gateSelfProof.test.ts` 的立论）："CI 绿"只说明**当时没报**，
 * 不说明门禁真的会报、也不说明门禁**真的在跑**。本文件把三件事钉死：
 *   ① **接线**（否则"阻断"只是纸面承诺）：4 门禁已进 `app/package.json` 的 `ci`
 *      聚合脚本 **且** 进了 `.github/workflows/ci.yml` 的 `static-check` 作业；
 *   ② **口径**：明细由「⚠️ 仅上报」升级为 **error 级**（`❌ 违规`）；
 *   ③ **负向对照**（跑**真实**脚本 + env 覆盖基线）：
 *      基线**削减** ⇒ 精确报「新增键」并 `exit 1`；真实基线 ⇒ `exit 0`；
 *      基线**缺失** ⇒ fail-closed `exit 1`（不得静默当作"0 违规"）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const BASELINE = join(
  REPO_ROOT,
  '.trae/architecture/hardcode-gate-baseline.json'
);
const GATES = ['consts', 'endpoints', 'locale', 'failmsg-refs'] as const;

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 测试清理
    }
  }
});

function tempBaseline(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-hardcode-baseline-'));
  temps.push(dir);
  const p = join(dir, 'baseline.json');
  writeFileSync(p, content);
  return p;
}

/** 跑真实门禁脚本（bun 直接执行 .ts）；返回退出码与合并输出 */
function runGate(
  gate: string,
  baselinePath: string
): { status: number | null; out: string } {
  const r = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', `lint-${gate}.ts`)],
    {
      env: { ...process.env, HARDCODE_GATE_BASELINE: baselinePath },
      encoding: 'utf8',
      timeout: 300_000,
    }
  );
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('§8 阶段③ · 接线（"CI 必绿"不是纸面承诺）', () => {
  it('4 门禁已进 `app/package.json` 的 `ci` 聚合脚本', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    const ci = pkg.scripts.ci ?? '';
    expect(ci.length).toBeGreaterThan(0);
    for (const g of GATES) {
      expect(pkg.scripts[`lint:${g}`]).toBeDefined();
      expect(ci).toContain(`bun run lint:${g}`);
    }
  });

  it('4 门禁已进 `.github/workflows/ci.yml`（CI 真实执行）', () => {
    const wf = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    for (const g of GATES) {
      expect(wf).toContain(`scripts/lint-${g}.ts`);
    }
  });

  it('明细口径为 error 级（`❌ 违规`，不再是「⚠️ 上报」）', () => {
    const lib = readFileSync(
      join(REPO_ROOT, 'scripts', 'lib', 'hardcodeScan.ts'),
      'utf8'
    );
    expect(lib).toContain('❌ 违规 ${findings.length} 条');
    expect(lib).not.toContain('⚠️ 上报 ${findings.length} 条');
  });
});

describe('§8 阶段③ · 基线（棘轮不得退化为"什么都不比"）', () => {
  it('基线可 JSON.parse，四节齐备且非空', () => {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<
      string,
      Record<string, number>
    >;
    for (const g of GATES) {
      const section = parsed[`lint:${g}`];
      expect(section).toBeDefined();
      expect(Object.keys(section).length).toBeGreaterThan(0);
    }
  });
});

describe('§8 阶段③ · 负向对照（真实脚本 + env 覆盖基线）', () => {
  it('真实基线 ⇒ 通过（exit 0），且明细为 error 级口径', () => {
    const r = runGate('consts', BASELINE);
    expect(r.status).toBe(0);
    expect(r.out).toContain('PASS（基线只减不增）');
    // 阶段③ 实证：不再打印「上报」，而是「违规」+ 豁免口径
    expect(r.out).toContain('❌ 违规');
    expect(r.out).toContain('基线内为豁免存量');
  });

  it('基线**削减**（模拟"新引入重复事实源"）⇒ **变红**（exit 1）并报出精确键', () => {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<
      string,
      Record<string, number>
    >;
    const section = parsed['lint:consts'];
    const keys = Object.keys(section);
    expect(keys.length).toBeGreaterThan(0);
    const removed = keys[0];
    delete section[removed];

    const r = runGate('consts', tempBaseline(JSON.stringify(parsed, null, 2)));
    expect(r.status).toBe(1);
    expect(r.out).toContain('新增/扩大违规');
    expect(r.out).toContain(removed);
  });

  it('基线**缺失** ⇒ fail-closed 变红（exit 1），不得当作"0 违规"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liri-hardcode-nobase-'));
    temps.push(dir);
    const r = runGate('consts', join(dir, 'does-not-exist.json'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('基线不存在');
  });
});
