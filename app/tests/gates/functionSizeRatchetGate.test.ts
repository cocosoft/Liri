/**
 * P2-1a —— **棘轮门禁自证（负向对照）**。
 *
 * 证明 `scripts/lint-function-size-ratchet.ts`：**增长 ⇒ 变红**；持平/缩小 ⇒ 通过；
 * 基线条目失效（文件/函数不存在）⇒ 变红。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(
  process.cwd(),
  '..',
  'scripts/lint-function-size-ratchet.ts'
);

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

/** 生成含 `runStreamMessage` 的源文件（函数体 `bodyLines` 行） */
function makeSource(bodyLines: number): string {
  const body = Array.from(
    { length: bodyLines },
    (_, i) => `  const v${i} = ${i};`
  ).join('\n');
  return `export async function* runStreamMessage(\n  a: string\n): AsyncGenerator<string> {\n${body}\n}\n`;
}

/** 与门禁脚本**同算法**计算函数行数/文件行数 */
function measure(text: string): { functionLines: number; fileLines: number } {
  const lines = text.split(/\r?\n/);
  const fileLines = lines.length - (text.endsWith('\n') ? 1 : 0);
  const startIdx = lines.findIndex((l) =>
    l.startsWith('export async function* runStreamMessage(')
  );
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i] === '}') {
      endIdx = i;
      break;
    }
  }
  return { functionLines: endIdx - startIdx + 1, fileLines };
}

function makeFixture(opts: { bodyLines: number }): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'liri-fn-ratchet-'));
  roots.push(root);
  mkdirSync(join(root, '.trae/architecture'), { recursive: true });
  mkdirSync(join(root, 'app/src'), { recursive: true });

  const text = makeSource(opts.bodyLines);
  writeFileSync(join(root, 'app/src/x.ts'), text);
  const m = measure(text);

  const baselinePath = join(
    root,
    '.trae/architecture/function-size-baseline.json'
  );
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        version: 1,
        entries: [
          {
            file: 'app/src/x.ts',
            function: 'runStreamMessage',
            functionLines: m.functionLines,
            fileLines: m.fileLines,
          },
        ],
      },
      null,
      2
    )
  );
  return {
    ...process.env,
    FN_SIZE_REPO_ROOT: root,
    FN_SIZE_BASELINE: baselinePath,
  };
}

function run(env: NodeJS.ProcessEnv): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('P2-1a 棘轮门禁 · 负向自证', () => {
  it('与基线持平 ⇒ 通过（exit 0）', () => {
    const r = run(makeFixture({ bodyLines: 10 }));
    expect(r.status).toBe(0);
    expect(r.out).toContain('未增长');
  });

  it('函数行数**增长** ⇒ 变红（exit 1）', () => {
    // 基线故意设小 5 行 ⇒ 视为"增长"
    const env = makeFixture({ bodyLines: 10 });
    const blPath = env.FN_SIZE_BASELINE as string;
    const bl = JSON.parse(readFileSync(blPath, 'utf8')) as {
      entries: Array<{ functionLines: number }>;
    };
    bl.entries[0].functionLines -= 5;
    writeFileSync(blPath, JSON.stringify(bl, null, 2));
    const r = run(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain('增长');
  });

  it('缩小 ⇒ 通过并提示下调基线（exit 0）', () => {
    const env = makeFixture({ bodyLines: 5 });
    const blPath = env.FN_SIZE_BASELINE as string;
    const big = {
      version: 1,
      entries: [
        {
          file: 'app/src/x.ts',
          function: 'runStreamMessage',
          functionLines: 999,
          fileLines: 999,
        },
      ],
    };
    writeFileSync(blPath, JSON.stringify(big, null, 2));
    const r = run(env);
    expect(r.status).toBe(0);
    expect(r.out).toContain('已缩小');
  });

  it('基线条目失效（文件不存在）⇒ 变红（exit 1）', () => {
    const root = mkdtempSync(join(tmpdir(), 'liri-fn-ratchet-'));
    roots.push(root);
    mkdirSync(join(root, '.trae/architecture'), { recursive: true });
    const baselinePath = join(
      root,
      '.trae/architecture/function-size-baseline.json'
    );
    writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 1,
        entries: [
          {
            file: 'app/src/ghost.ts',
            function: 'runStreamMessage',
            functionLines: 1,
            fileLines: 1,
          },
        ],
      })
    );
    const r = run({
      ...process.env,
      FN_SIZE_REPO_ROOT: root,
      FN_SIZE_BASELINE: baselinePath,
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain('基线条目失效');
  });
});
