// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `writeFileAtomic` —— 并发安全的原子写原语（2026-10-31）。
 *
 * 背景：记忆索引（`save_index`）与记忆关系图（`save_relation_graph`）各自用**固定**
 * `.tmp` 做「写→rename」，并发时后到者 rename 的 tmp 已被先到者消费 ⇒
 * `ENOENT: rename '…json.tmp' -> '…json'`（真机 `app.log` 实证）。本原语以
 * **每次唯一**临时名消除该竞态，并对 Windows rename 的瞬时占用（EPERM/EBUSY/EACCES）
 * 做有界重试（3 次）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from '../../src/utils/atomicFileWrite';

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atomic-write-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeFileAtomic', () => {
  it('并发 8 次写同一目标 ⇒ 不抛错、落盘内容为其中一次的完整快照、无残留 .tmp', async () => {
    const dir = makeDir();
    const target = join(dir, 'nested', 'index.json');
    const payloads = Array.from({ length: 8 }, (_, i) => `{"n":${i}}`);

    await Promise.all(
      payloads.map((payload) => writeFileAtomic(target, payload))
    );

    expect(existsSync(target)).toBe(true);
    expect(payloads).toContain(readFileSync(target, 'utf8'));
    expect(readdirSync(join(dir, 'nested'))).toEqual(['index.json']);
  });

  it('目标目录不存在 ⇒ 自动创建', async () => {
    const dir = makeDir();
    const target = join(dir, 'a', 'b', 'c.json');
    await writeFileAtomic(target, 'ok');
    expect(readFileSync(target, 'utf8')).toBe('ok');
  });
});
