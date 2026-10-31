/**
 * STATUS.md「文档语料」口径自证（2026-10-31）。
 *
 * 背景：README 曾把「143 篇真实文档」写死在两处，而语料实为 145 篇（新增文档后静默漂移）。
 * 现在篇数统一由 `gen-status.ts` 现算并写入 STATUS.md，本用例守住**两套实现同口径**：
 *   `gen-status.countDocCorpus`（静态计数） ⇔ `FileDocsProvider.buildIndex`（生产扫描）。
 * 任一侧的扫描规则（跳过隐藏目录 / raw/、只认 `.md`）漂移即失败。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileDocsProvider } from '../../src/docs/FileDocsProvider';

const APP_DIR = process.cwd();
const STATUS_FILE = join(APP_DIR, '..', 'STATUS.md');

describe('STATUS.md「文档语料」与 FileDocsProvider 同口径', () => {
  it('STATUS.md 的篇数 == 生产扫描结果', async () => {
    const corpus = await new FileDocsProvider(
      join(APP_DIR, 'docs')
    ).buildIndex();
    const status = readFileSync(STATUS_FILE, 'utf-8');
    const row = /\| 文档语料 \| \*\*(\d+)\*\* \|/.exec(status);

    expect(row).not.toBeNull();
    expect(Number(row![1])).toBe(corpus.length);
  });
});
