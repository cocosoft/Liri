// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * FileDocsProvider 扫描过滤集成测试（KB-P0-1）
 *
 * 验证 buildIndex 跳过隐藏目录（.knowledge-trash/）与 raw/ 源目录，
 * 回收站文档与上传伴侣文件不混入正式知识列表。
 * 使用项目内临时目录（沙箱可写），测试后清理。
 */
import { describe, expect, it, afterAll } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { FileDocsProvider } from '../FileDocsProvider';

const tempRoots: string[] = [];

describe('FileDocsProvider 扫描过滤（KB-P0-1）', () => {
  it('跳过隐藏目录与 raw/ 目录，只收录正常文档', async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), '.kb-scan-test-'));
    tempRoots.push(tempRoot);
    await mkdir(join(tempRoot, '.knowledge-trash'));
    await mkdir(join(tempRoot, 'raw'));
    await mkdir(join(tempRoot, 'docs'));
    await writeFile(
      join(tempRoot, '.knowledge-trash', '回收文档.md'),
      '# 回收文档'
    );
    await writeFile(join(tempRoot, 'raw', '伴侣.md'), '# 伴侣文件');
    await writeFile(join(tempRoot, 'docs', '正常文档.md'), '# 正常文档');
    await writeFile(join(tempRoot, '根文档.md'), '# 根文档');

    const provider = new FileDocsProvider(tempRoot);
    const entries = await provider.buildIndex();
    const paths = entries.map((e) => e.relativePath);

    expect(paths).toContain('根文档.md');
    expect(paths).toContain(join('docs', '正常文档.md'));
    // 回收站与 raw 不进入正式列表
    expect(paths).not.toContain(join('.knowledge-trash', '回收文档.md'));
    expect(paths).not.toContain(join('raw', '伴侣.md'));
  });

  it('frontmatter title 优先于正文 H1（KB-P1-5）', async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), '.kb-scan-test-'));
    tempRoots.push(tempRoot);
    await writeFile(
      join(tempRoot, 'fm.md'),
      ['---', 'title: "frontmatter标题"', '---', '# 正文H1标题', '内容'].join(
        '\n'
      )
    );
    await writeFile(join(tempRoot, 'h1.md'), '# 仅H1标题\n内容');

    const provider = new FileDocsProvider(tempRoot);
    const entries = await provider.buildIndex();
    const fm = entries.find((e) => e.fileName === 'fm.md');
    const h1 = entries.find((e) => e.fileName === 'h1.md');

    expect(fm?.title).toBe('frontmatter标题');
    expect(h1?.title).toBe('仅H1标题');
  });
});

afterAll(async () => {
  // 清理所有测试创建的临时目录（含失败残留）
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});
