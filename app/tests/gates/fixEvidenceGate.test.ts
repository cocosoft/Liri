/**
 * P1-4 —— **修复证据登记门禁自证（负向对照）**。
 *
 * 证明 `scripts/lint-fix-evidence.ts` 能发现"状态与证据不一致"，尤其：
 * 「只改代码无测试却标已验收」「跳过单元直称端到端」「声明修复却无 code 证据」。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';

const SCRIPT = join(process.cwd(), '..', 'scripts', 'lint-fix-evidence.ts');

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 测试清理
    }
  }
});

const STAGES = (o: Partial<Record<string, boolean>> = {}) => ({
  discovered: true,
  fixed: true,
  testVerified: true,
  postReleaseReviewed: false,
  ...o,
});
const FLAGS = (o: Partial<Record<string, boolean>> = {}) => ({
  designed: true,
  coded: true,
  unitTested: true,
  e2eVerified: false,
  ...o,
});

function item(o: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'X-1',
    title: 't',
    source: 's',
    stages: STAGES(),
    flags: FLAGS(),
    code: ['src/impl.ts'],
    tests: ['tests/impl.test.ts'],
    changelog: [],
    reopenWhen: 'w',
    ...o,
  };
}

function makeFixture(items: unknown[]): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'liri-fix-gate-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'src/impl.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'tests/impl.test.ts'), '// t\n');
  writeFileSync(
    join(root, '.trae/architecture/修复证据登记.md'),
    '# 修复证据登记\n'
  );
  const registryPath = join(
    root,
    '.trae/architecture/fix-evidence-registry.json'
  );
  writeFileSync(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        stages: ['discovered', 'fixed', 'testVerified', 'postReleaseReviewed'],
        flags: ['designed', 'coded', 'unitTested', 'e2eVerified'],
        items,
      },
      null,
      2
    )
  );
  return {
    ...process.env,
    FIX_EVIDENCE_REPO_ROOT: root,
    FIX_EVIDENCE_REGISTRY: registryPath,
  };
}

function makeRawFixture(raw: string): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'liri-fix-gate-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  writeFileSync(
    join(root, '.trae/architecture/修复证据登记.md'),
    '# 修复证据登记\n'
  );
  const registryPath = join(
    root,
    '.trae/architecture/fix-evidence-registry.json'
  );
  writeFileSync(registryPath, raw);
  return {
    ...process.env,
    FIX_EVIDENCE_REPO_ROOT: root,
    FIX_EVIDENCE_REGISTRY: registryPath,
  };
}

function run(
  env: NodeJS.ProcessEnv,
  extra: string[] = []
): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...extra], {
    env,
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('P1-4 修复证据门禁 · 负向自证', () => {
  it('合规条目 ⇒ 通过（exit 0）', () => {
    const r = run(makeFixture([item({})]));
    expect(r.status).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('unitTested=true 但无 tests ⇒ 变红（"只改代码无测试不得称已验收"）', () => {
    const r = run(makeFixture([item({ tests: [] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 tests 证据');
  });

  it('e2eVerified=true 但 unitTested=false ⇒ 变红（不得跳过单元直称端到端）', () => {
    const r = run(
      makeFixture([
        item({ flags: FLAGS({ unitTested: false, e2eVerified: true }) }),
      ])
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('不得跳过单元直称端到端');
  });

  it('fixed=true 但无 code 证据 ⇒ 变红', () => {
    const r = run(makeFixture([item({ code: [] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 code 证据');
  });

  it('证据路径不存在 ⇒ 变红', () => {
    const r = run(makeFixture([item({ code: ['src/missing.ts'] })]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('证据路径不存在');
  });

  it('postReleaseReviewed=true 但无 changelog ⇒ 变红', () => {
    const r = run(
      makeFixture([item({ stages: STAGES({ postReleaseReviewed: true }) })])
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain('无 changelog 记录');
  });

  it('id 重复 ⇒ 变红', () => {
    const r = run(makeFixture([item({}), item({})]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('id 重复');
  });

  // 2026-10-13 防复发：登记表字符串内误用 ASCII 双引号 ⇒ JSON 提前闭合。
  // 该坑在本仓已复发三次（bun 的 JSON 错误不带位置，排障成本高）⇒ 门禁须报**精确行列**与惯例提示。
  it('字符串内未转义 ASCII 双引号 ⇒ 变红，且报出精确行列 + 中文引号提示', () => {
    const raw = [
      '{',
      '  "version": 1,',
      '  "stages": [],',
      '  "flags": [],',
      '  "items": [',
      '    {',
      '      "id": "X-1",',
      '      "title": "含未转义引号"的内层引号",',
      '    }',
      '  ]',
      '}',
    ].join('\n');
    const r = run(makeRawFixture(raw));
    expect(r.status).toBe(1);
    expect(r.out).toContain('未转义的 ASCII 双引号');
    expect(r.out).toContain(':8:'); // 元凶在第 8 行（title 行）
  });

  it('`--fix` ⇒ 就地修复 stray 引号（改「」）后复检通过（先坏后好）', () => {
    const raw = [
      '{',
      '  "version": 1,',
      '  "stages": ["discovered", "fixed", "testVerified", "postReleaseReviewed"],',
      '  "flags": ["designed", "coded", "unitTested", "e2eVerified"],',
      '  "items": [',
      '    {',
      '      "id": "X-1",',
      '      "title": "含"裸引号"的标题",',
      '      "source": "s",',
      '      "stages": {"discovered": true, "fixed": false, "testVerified": false, "postReleaseReviewed": false},',
      '      "flags": {"designed": false, "coded": false, "unitTested": false, "e2eVerified": false},',
      '      "code": [],',
      '      "tests": [],',
      '      "changelog": [],',
      '      "reopenWhen": "w"',
      '    }',
      '  ]',
      '}',
    ].join('\n');
    const env = makeRawFixture(raw);
    // 修复前：解析失败 ⇒ 红
    expect(run(env).status).toBe(1);
    // --fix：自动修复并放行
    const fixed = run(env, ['--fix']);
    expect(fixed.status).toBe(0);
    expect(fixed.out).toContain('--fix 已修复');
    expect(fixed.out).toContain('✅');
    // 落盘后的登记表确已可解析，且引号已改为中文引号
    const repaired = readFileSync(env.FIX_EVIDENCE_REGISTRY as string, 'utf8');
    expect(JSON.parse(repaired)).toBeTruthy();
    expect(repaired).toContain('「裸引号」');
  });
});

// ── HD-INFRA-1（2026-10-13 · `dev_docs/20261013/硬编码统一治理方案-20261013.md` §7.5）──
// 「格式/约定型陷阱」的**防回流守卫**。根因两层：① 规范悬空（门禁报错引用 `.trae/rules/`
// 却无对应条目）② 校验点位滞后（只在 CI 跑、pre-commit 不跑）。本组把两层都钉死：
// 规范必须真实存在且被报错文本引用；台账必须可解析；同类面必须可枚举且全部可解析。
const REPO_ROOT = join(process.cwd(), '..');
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  '.next',
  'target', // client/src-tauri 的 Rust 构建产物（内含源文件副本）
  'dev_docs', // 历史产物（eval 快照 / 日更），非源头
]);

/** TypeScript 官方配置是 JSONC（允许 `//` 注释）⇒ 不适用 `JSON.parse`，按文件名放行 */
function isJsonc(file: string): boolean {
  const base = file.split(/[\\/]/).pop() ?? '';
  return (
    /^tsconfig[^/\\]*\.json$/i.test(base) || /^jsconfig\.json$/i.test(base)
  );
}

function collectSourceJsonYaml(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      collectSourceJsonYaml(join(dir, e.name), out);
    } else if (/\.(json|ya?ml)$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

describe('HD-INFRA-1 格式/约定型陷阱 · 防回流守卫', () => {
  it('① 规范不悬空：coding-standards.md 含 CS08，且门禁报错文本引用 CS08', () => {
    const rules = readFileSync(
      join(REPO_ROOT, '.trae/rules/coding-standards.md'),
      'utf8'
    );
    expect(rules).toContain('## CS08');
    expect(rules).toContain('中文引号');
    const gate = readFileSync(
      join(REPO_ROOT, 'scripts/lint-fix-evidence.ts'),
      'utf8'
    );
    expect(gate).toContain('CS08');
  });

  it('② 真台账可 JSON.parse（未转义 ASCII 引号必然使其失败 ⇒ 等价于"无 stray quote"）', () => {
    const raw = readFileSync(
      join(REPO_ROOT, '.trae/architecture/fix-evidence-registry.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as { items: unknown[] };
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items.length).toBeGreaterThan(0);
  });

  it('③ 同类面可枚举且全部可解析：含中文的源头 JSON/YAML（防新增未纳管文件）', () => {
    const all: string[] = [];
    collectSourceJsonYaml(REPO_ROOT, all);
    const cjk = all.filter((f) =>
      /[\u4e00-\u9fff]/.test(readFileSync(f, 'utf8'))
    );
    const jsonFiles = cjk.filter((f) => f.endsWith('.json') && !isJsonc(f));
    const yamlFiles = cjk.filter((f) => !f.endsWith('.json'));

    // 面必须非空（否则"枚举"退化为"什么都没查"）
    expect(jsonFiles.length).toBeGreaterThan(0);
    expect(yamlFiles.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const f of jsonFiles) {
      // @ignore-catch — 收集全部失败后统一断言，避免首个文件中断扫描
      try {
        JSON.parse(readFileSync(f, 'utf8'));
      } catch (err) {
        failures.push(`${f} :: ${String(err)}`);
      }
    }
    for (const f of yamlFiles) {
      // @ignore-catch — 同上
      try {
        loadYaml(readFileSync(f, 'utf8'));
      } catch (err) {
        failures.push(`${f} :: ${String(err)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('④ 前置不退化：pre-commit 生成器含 fix-evidence 检查（HD-INFRA-1c / Q-H6）', () => {
    const gen = readFileSync(
      join(process.cwd(), 'scripts', 'setup-git-hooks.ts'),
      'utf8'
    );
    expect(gen).toContain('lint-fix-evidence.ts');
    expect(gen).toContain('CS08');
  });
});
