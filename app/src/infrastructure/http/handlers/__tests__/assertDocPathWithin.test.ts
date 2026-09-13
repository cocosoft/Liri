// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * assertDocPathWithin 单元测试（KB-DOC 发现 C 路径穿越加固）
 *
 * 纯路径逻辑（不落盘），沙箱可运行。覆盖：
 * - 根内合法路径（含深层子目录）→ 接受并返回解析后的绝对路径
 * - 根内目录名以 `..` 开头（如 `..evil/`）→ 接受（回归 KB-DOC-FIX：
 *   旧 `rel.startsWith('..')` 会把 relative 返回的 `..evil\x.md` 误判为逃逸）
 * - `../` 逃逸、多层逃逸、裸 `..` → 拒绝
 * - 根目录之外的绝对路径 → 拒绝（跨盘/绝对路径注入）
 */
import { describe, expect, it } from 'bun:test';
import { resolve, join } from 'path';
import { assertDocPathWithin } from '../knowledge-handlers';

const ROOT = resolve(join('tmp', 'kb-root'));

async function expectReject(docPath: string, label: string) {
  await expect(assertDocPathWithin(ROOT, docPath), label).rejects.toThrow(
    '非法文档路径'
  );
}

describe('assertDocPathWithin（KB-DOC 路径穿越防护）', () => {
  it('根内普通相对路径：接受', async () => {
    const resolved = await assertDocPathWithin(ROOT, 'kb1/file.md');
    expect(resolved).toBe(resolve(ROOT, 'kb1/file.md'));
  });

  it('根内深层子目录：接受', async () => {
    const resolved = await assertDocPathWithin(ROOT, 'sub/dir/deep.md');
    expect(resolved).toBe(resolve(ROOT, 'sub/dir/deep.md'));
  });

  it('根内目录名以 .. 开头（..evil/）不逃逸：接受（回归 KB-DOC-FIX）', async () => {
    const resolved = await assertDocPathWithin(ROOT, '..evil/doc.md');
    expect(resolved).toBe(resolve(ROOT, '..evil/doc.md'));
  });

  it('根内目录名 ...（三个点）不逃逸：接受', async () => {
    const resolved = await assertDocPathWithin(ROOT, '.../doc.md');
    expect(resolved).toBe(resolve(ROOT, '.../doc.md'));
  });

  it('../ 一级逃逸：拒绝', async () => {
    await expectReject('../escape.md', '一级逃逸');
  });

  it('多层 ../ 逃逸：拒绝', async () => {
    await expectReject('kb1/../../escape.md', '多层逃逸');
  });

  it('裸 .. 指向父目录：拒绝', async () => {
    await expectReject('..', '裸 ..');
  });

  it('根目录之外的绝对路径：拒绝', async () => {
    await expectReject(resolve('elsewhere/secret.md'), '绝对路径注入');
  });
});
