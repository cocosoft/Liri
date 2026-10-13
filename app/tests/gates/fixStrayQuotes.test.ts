/**
 * CS08 修复器自证：`scripts/fix-stray-quotes.ts`。
 *
 * 证明它能：① 把「字符串内容里的裸 ASCII 引号」改为中文引号「」并让 JSON 复归**可解析**；
 * ② 在**引号不成对**时**拒绝改写**（不制造看似合法、语义错误的文本）；
 * ③ `--dry-run` 只报告、不落盘。方向与既有 `fixEvidenceGate.test.ts` 一致：**负向自证**。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), '..', 'scripts', 'fix-stray-quotes.ts');

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

function fixture(raw: string): string {
  const root = mkdtempSync(join(tmpdir(), 'liri-stray-'));
  roots.push(root);
  const file = join(root, 'x.json');
  writeFileSync(file, raw);
  return file;
}

function run(file: string, extra: string[] = []): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...extra, file], {
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('CS08 修复器 · fix-stray-quotes', () => {
  it('干净 JSON ⇒ 退出 0 且不改动', () => {
    const file = fixture('{"a":"b"}\n');
    const r = run(file);
    expect(r.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe('{"a":"b"}\n');
  });

  it('成对 stray 引号 ⇒ 改为「」且复归可解析（先坏后好）', () => {
    const bad = '{"notes": "见 "RFC 3339" 的时区约定"}\n';
    // 负向证据：修复前解析失败
    expect(() => JSON.parse(bad)).toThrow();
    const file = fixture(bad);
    const r = run(file);
    expect(r.status).toBe(0);
    const fixed = readFileSync(file, 'utf8');
    // 修复后：可解析，且引号已落位为中文引号
    expect(JSON.parse(fixed)).toEqual({ notes: '见 「RFC 3339」 的时区约定' });
  });

  it('引号不成对 ⇒ 拒绝改写（exit 1）且文件保持原样', () => {
    const bad = '{"notes": "见 "RFC 3339 的时区约定"}\n';
    const file = fixture(bad);
    const r = run(file);
    expect(r.status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(bad);
  });

  it('--dry-run ⇒ 只报告（exit 1）且文件保持原样', () => {
    const bad = '{"notes": "见 "RFC 3339" 的时区约定"}\n';
    const file = fixture(bad);
    const r = run(file, ['--dry-run']);
    expect(r.status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe(bad);
  });
});
