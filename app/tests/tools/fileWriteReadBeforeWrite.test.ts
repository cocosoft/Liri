/**
 * file_write 覆盖前 read-before-write（2026-11-05）
 *
 * 背景：`file_edit` 已有写前快照校验，但 `file_write` 覆盖既有文件时没有任何前置校验
 * —— 模型在没见过当前内容的情况下整文件覆盖，会把用户/其它进程刚写入的内容冲掉。
 *
 * 本片锁住五条契约：
 *  ① 新文件：无需先读；
 *  ② 既有文件 + 没读过 ⇒ 拒绝，并提示先 file_read（追加可用 append）；
 *  ③ 既有文件 + 读过且 mtime 一致 ⇒ 允许覆盖；
 *  ④ 读过但磁盘 mtime 已变 ⇒ 拒绝并要求重读；
 *  ⑤ append 既有文件 ⇒ 不需先读。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileWriteTool } from '../../src/tools/FileWriteTool/FileWriteTool';
import { FileStateCache } from '@openliri/infra/utils/fileStateCache';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';

const dir = mkdtempSync(join(tmpdir(), 'file-write-read-before-'));
const tool = new FileWriteTool();
let seq = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(content: string): string {
  seq += 1;
  const name = `case-${seq}.txt`;
  writeFileSync(join(dir, name), content, 'utf-8');
  return name;
}

function newCache(): FileStateCache {
  return new FileStateCache(100, 25 * 1024 * 1024);
}

function ctx(cache?: FileStateCache): ToolUseContext {
  return {
    options: { cwd: dir },
    readFileState: cache,
  } as unknown as ToolUseContext;
}

/** 模拟 file_read 落快照（记录当前 mtime） */
function markRead(cache: FileStateCache, name: string): void {
  const abs = join(dir, name);
  cache.set(abs, {
    content: readFileSync(abs, 'utf-8'),
    timestamp: Date.now(),
    offset: undefined,
    limit: undefined,
    mtimeMs: statSync(abs).mtimeMs,
  });
}

describe('file_write：覆盖既有文件的 read-before-write', () => {
  it('新文件无需先读', async () => {
    const name = `fresh-${++seq}.txt`;
    const result = await tool.execute(
      { file_path: name, content: 'hello' },
      ctx(newCache())
    );
    expect(result.success).not.toBe(false);
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('hello');
  });

  it('既有文件未读过 ⇒ 拒绝并提示先 file_read', async () => {
    const name = seed('original');
    const result = await tool.execute(
      { file_path: name, content: 'overwrite' },
      ctx(newCache())
    );
    expect(result.success).toBe(false);
    expect(String(result.data)).toContain('尚未读取');
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('original');
  });

  it('读过且 mtime 一致 ⇒ 允许覆盖；第二轮覆盖仍通过（快照已刷新）', async () => {
    const name = seed('v1');
    const cache = newCache();
    markRead(cache, name);

    const first = await tool.execute(
      { file_path: name, content: 'v2' },
      ctx(cache)
    );
    expect(first.success).not.toBe(false);

    const second = await tool.execute(
      { file_path: name, content: 'v3' },
      ctx(cache)
    );
    expect(second.success).not.toBe(false);
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('v3');
  });

  it('读过但磁盘 mtime 已变 ⇒ 拒绝并要求重读', async () => {
    const name = seed('before');
    const cache = newCache();
    markRead(cache, name);

    // 模拟外部进程改写（mtime 变化）
    writeFileSync(join(dir, name), 'changed-externally', 'utf-8');
    const future = new Date(Date.now() + 5000);
    utimesSync(join(dir, name), future, future);

    const result = await tool.execute(
      { file_path: name, content: 'overwrite' },
      ctx(cache)
    );
    expect(result.success).toBe(false);
    expect(String(result.data)).toContain('已被修改');
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('changed-externally');
  });

  it('append 既有文件无需先读', async () => {
    const name = seed('base\n');
    const result = await tool.execute(
      { file_path: name, content: 'tail\n', append: true },
      ctx(newCache())
    );
    expect(result.success).not.toBe(false);
    expect(readFileSync(join(dir, name), 'utf-8')).toBe('base\ntail\n');
  });
});
