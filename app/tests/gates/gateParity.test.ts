/**
 * 元门禁 `lint:gate-parity` 自证（2026-10-31）。
 *
 * 立论同 `hardcodeGateBlocking.test.ts`：「CI 绿」只说明当时没报，不说明门禁**真的会报**。
 * 本文件钉死四件事：
 *   ① 真实仓库：`ci` 里的门禁在 CI 中全覆盖（或已登记豁免）；
 *   ② 负向对照：`ci` 多了 CI 不执行的门禁 ⇒ **exit 1 并点名**；
 *   ③ 豁免机制：登记理由后放行，**理由为空 ⇒ exit 1**（fail-closed）；
 *   ④ 实现文件路径也算「已进 CI」（兼容 workflow 直接调 `scripts/x.ts` 的写法）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'lint-gate-parity.ts');

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      // 测试清理失败不影响断言
    }
  }
});

/** 造一棵最小工程树：app/package.json + workflows(+ 可选 allowlist) */
function fixture(opts: {
  ci: string;
  workflows: string;
  allowlist?: string;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-gate-parity-'));
  temps.push(dir);
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(dir, '.trae', 'architecture'), { recursive: true });
  writeFileSync(
    join(dir, 'app', 'package.json'),
    JSON.stringify({
      scripts: {
        ci: opts.ci,
        'lint:orphan': 'bun run scripts/orphan.ts',
      },
    })
  );
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), opts.workflows);
  if (opts.allowlist !== undefined) {
    writeFileSync(
      join(dir, '.trae', 'architecture', 'gate-parity-allowlist.json'),
      opts.allowlist
    );
  }
  return dir;
}

function run(projectDir?: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(projectDir ? { PYAPP_PROJECT_DIR: projectDir } : {}),
    },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('lint:gate-parity（元门禁）', () => {
  it('真实仓库：ci 门禁在 CI 全覆盖或已登记豁免', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out).toContain('缺失 0');
  });

  it('负向对照：ci 有、workflow 无 ⇒ exit 1 并点名', () => {
    const dir = fixture({
      ci: 'bun run lint:orphan',
      workflows: 'jobs:\n  a:\n    steps:\n      - run: bun run lint:other\n',
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('lint:orphan');
  });

  it('豁免表登记理由 ⇒ 放行并如实打印', () => {
    const dir = fixture({
      ci: 'bun run lint:orphan',
      workflows: 'jobs:\n  a:\n    steps:\n      - run: echo noop\n',
      allowlist: JSON.stringify({ 'lint:orphan': '仅本机执行，CI 无输入' }),
    });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.out).toContain('豁免');
  });

  it('豁免理由为空 ⇒ exit 1（fail-closed，不得当成"已豁免"）', () => {
    const dir = fixture({
      ci: 'bun run lint:orphan',
      workflows: 'jobs:\n  a:\n    steps:\n      - run: echo noop\n',
      allowlist: JSON.stringify({ 'lint:orphan': '  ' }),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('理由为空');
  });

  it('workflow 直接调用实现文件 ⇒ 视为已进 CI', () => {
    const dir = fixture({
      ci: 'bun run lint:orphan',
      workflows:
        'jobs:\n  a:\n    steps:\n      - run: bun run app/scripts/orphan.ts\n',
    });
    const r = run(dir);
    expect(r.status).toBe(0);
  });
});
