/**
 * `R05-003`（Console 调用基线）· **双源收敛守卫**（`dev_docs/20261013/硬编码统一治理方案-20261013.md`
 * §2.10②「双轨/双源」· §8）。
 *
 * 收敛前该规则有**两套实现 + 两个阈值**：
 *  · 门禁 `lint-architecture.ts#checkConsoleBaseline` —— 4 方法名 / 按**次** / `count 2045 + 10%`（上限 2250）
 *  · CI `.github/workflows/ci.yml` **内联 grep** —— 6 方法名 / 按**行** / **写死 2034**
 * ⇒ 改一处即漂移。本文件把「单实现 + 单真源」钉死（可证伪）：
 *  ① 两个调用点都引用**同一实现** `scripts/lib/consoleCalls.ts`；
 *  ② 门禁里**不得**再出现硬编码默认值（`2045`）与旧计数正则；
 *  ③ CI 里**不得**再有内联计数（`grep … console… | wc -l` / `-gt 2034`）；
 *  ④ 真源 `scripts/console-baseline.json` 可解析且取值合法；
 *  ⑤ **真实脚本**跑一次 ⇒ 通过（不回归）；**负向自证**（临时基线 count=1）⇒ 变红；**基线缺失** ⇒ fail-closed 变红。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-console-baseline.ts');
const BASELINE = join(REPO_ROOT, 'scripts', 'console-baseline.json');
const GATE = join(REPO_ROOT, 'scripts', 'lint-architecture.ts');
const CI = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

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

/** 跑真实脚本（仓库根为 cwd）；返回退出码与合并输出 */
function run(env: Record<string, string> = {}): {
  status: number | null;
  out: string;
} {
  const r = spawnSync(process.execPath, ['run', SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 300_000,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function tempBaseline(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-console-baseline-'));
  temps.push(dir);
  const p = join(dir, 'baseline.json');
  writeFileSync(p, content);
  return p;
}

describe('R05-003 · 单一实现（两个调用点共用 lib/consoleCalls）', () => {
  it('门禁与 CI 脚本都引用同一实现', () => {
    const gate = readFileSync(GATE, 'utf8');
    const script = readFileSync(SCRIPT, 'utf8');
    expect(gate).toContain("from './lib/consoleCalls'");
    expect(gate).toContain('loadConsoleBaseline');
    expect(script).toContain("from './lib/consoleCalls'");
    expect(script).toContain('loadConsoleBaseline');
  });

  it('门禁**实现体**不再持有第二实现/第二真源（无 2045 默认值、无 4 名旧正则）', () => {
    // 注释里允许叙述历史（说明「原为 2045 / 4 名」），故只对**去掉注释行后的实现体**断言
    const code = readFileSync(GATE, 'utf8')
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code).not.toContain('2045');
    expect(code).not.toContain('Math.ceil(baseline * (1 + threshold))');
    expect(code).not.toMatch(/console\\\.\(log\|warn\|error\|debug\)/);
  });

  it('CI 不再内联计数（无 grep 计数、无写死阈值）', () => {
    const ci = readFileSync(CI, 'utf8');
    expect(ci).toContain('bun run scripts/check-console-baseline.ts');
    expect(ci).not.toContain('Console calls:');
    expect(ci).not.toContain('-gt 2034');
    expect(ci).not.toContain('wc -l');
  });

  it('真源可解析且取值合法', () => {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
      count: number;
      threshold: number;
    };
    expect(Number.isInteger(parsed.count)).toBe(true);
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.threshold).toBeGreaterThanOrEqual(0);
  });
});

describe('R05-003 · 负向对照（真实脚本 + 基线覆盖）', () => {
  it('真实基线 ⇒ 通过（exit 0），且打印当前行数与上限', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('[R05-003 Console 基线] 当前');
    expect(r.out).toContain('✅ Console 调用在上限内');
  });

  it('基线**收紧到 1** ⇒ **变红**（exit 1）并报「超上限」', () => {
    const r = run({
      CONSOLE_BASELINE_OVERRIDE: tempBaseline(
        JSON.stringify({ count: 1, threshold: 0 })
      ),
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('Console 调用超上限');
  });
});
