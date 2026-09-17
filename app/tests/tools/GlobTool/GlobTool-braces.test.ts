/**
 * GlobTool G1 — 花括号展开回归测试（2026-09-17）
 *
 * G1（高）：`glob("{A,B}")` 此前花括号不展开、当成字面量 → 永远匹配不上 → 静默返回 []，
 * 调用方无法区分「文件不存在」与「模式不支持」。修复后应真实展开为 `(A|B)` 交替匹配。
 */
import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { glob } from '../../../src/tools/GlobTool/GlobTool.js';

const sandbox = mkdtempSync(join(tmpdir(), 'glob-braces-test-'));
const dir = join(sandbox, 'src');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'a.ts'), '');
writeFileSync(join(dir, 'b.ts'), '');
writeFileSync(join(dir, 'b.js'), '');
writeFileSync(join(dir, 'c.md'), '');

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe('GlobTool G1 — 花括号展开（不再静默返回 []）', () => {
  test('*.{ts,js} 展开匹配 a.ts/b.ts 与 b.js，排除 c.md', () => {
    const r = glob('*.{ts,js}', dir);
    const names = r.filenames.map((f) => f.replace(/\\/g, '/').split('/').pop());
    expect(r.numFiles).toBe(3);
    expect(names).toContain('a.ts');
    expect(names).toContain('b.ts');
    expect(names).toContain('b.js');
    expect(names).not.toContain('c.md');
  });

  test('{a,b}.ts 展开匹配 a.ts 与 b.ts', () => {
    const r = glob('{a,b}.ts', dir);
    const names = r.filenames.map((f) => f.replace(/\\/g, '/').split('/').pop());
    expect(names).toContain('a.ts');
    expect(names).toContain('b.ts');
  });

  test('花括号不在模式中时行为不变（普通 *.md 匹配）', () => {
    const r = glob('*.md', dir);
    const names = r.filenames.map((f) => f.replace(/\\/g, '/').split('/').pop());
    expect(names).toContain('c.md');
  });
});