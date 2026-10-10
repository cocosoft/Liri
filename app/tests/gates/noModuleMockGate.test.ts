/**
 * 「测试禁用 `mock.module`」门禁 · **负向自证（负向对照）**（2026-10-10）
 *
 * 证明 `scripts/lint-no-module-mock.ts`：
 * - 无用法 ⇒ 通过（exit 0）；
 * - **任何活跃用法 ⇒ 变红（exit 1）**（存量已迁移完毕，门禁**零豁免**）；
 * - **注释中的提及不计**（防误报，本仓多处注释解释该 API）。
 *
 * 背景（L-23 实证）：`mock.module` 进程级持久、不可撤销 ⇒ 跨文件污染（A2A 侧车 5 例全量跑失败）。
 *
 * ⚠️ 本文件**不得出现字面量 `mock.module(`** —— 门禁扫描 `app/tests/**` 的**源码文本**
 * （夹具里的字符串同样命中）⇒ 一律用下面的 `CALL` **运行时拼装**，否则本自证自身会被判违规。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), '..', 'scripts/lint-no-module-mock.ts');

/** 运行时拼装：等价于 `mock` + `.module(`（避免本文件自身命中门禁） */
const CALL = ['mock', 'module('].join('.');
/** 注释里的提及（也应被门禁忽略） */
const IN_COMMENT = `// 原实现用 ${CALL}"@modules/config", () => ({})) 替换整个模块`;
/** 成功时的输出标记 */
const OK_MARK = '全仓测试零';

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

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-nomm-'));
  roots.push(root);
  mkdirSync(join(root, 'app/tests'), { recursive: true });
  mkdirSync(join(root, 'app/src'), { recursive: true });
  return root;
}

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function run(root: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, NOMM_REPO_ROOT: root },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('测试 `mock.module` 禁用门禁 · 负向自证', () => {
  it('无用法 ⇒ 通过（exit 0）', () => {
    const root = makeRoot();
    write(root, 'app/tests/clean.test.ts', 'import {} from "bun:test";\n');
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.out).toContain(OK_MARK);
  });

  it('**任何**活跃用法 ⇒ 变红（exit 1，零豁免）', () => {
    const root = makeRoot();
    write(
      root,
      'app/tests/bad.test.ts',
      `${CALL}"@modules/ai", () => ({}));\n`
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('检出');
    expect(r.out).toContain('app/tests/bad.test.ts');
  });

  it('`src/**` 内联测试同样受检（exit 1）', () => {
    const root = makeRoot();
    write(
      root,
      'app/src/x/__tests__/y.test.ts',
      `${CALL}"@modules/config", () => ({}));\n`
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain('app/src/x/__tests__/y.test.ts');
  });

  it('仅注释提及 ⇒ 不计（exit 0，防误报）', () => {
    const root = makeRoot();
    write(
      root,
      'app/tests/comments.test.ts',
      [
        IN_COMMENT,
        ` * bun 的模块 mock 是进程级持久的 ${CALL}…)`,
        `/* ${CALL}"x", () => ({})) */`,
      ].join('\n')
    );
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.out).toContain(OK_MARK);
  });
});
