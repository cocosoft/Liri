// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * KnowledgeBaseWriter 单元测试
 *
 * 覆盖：写入、快照、恢复、去重
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import {
  KnowledgeBaseWriter,
  KnowledgeBaseEntry,
} from '../KnowledgeBaseWriter';
import { KnowledgeDedupStrategy } from '../KnowledgeDedupStrategy';
import { mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), 'kb_writer_test_' + Date.now());

function makeEntry(
  title: string,
  content: string,
  tags: string[] = [],
  category: string = 'test'
): KnowledgeBaseEntry {
  return { title, content, tags, category };
}

describe('KnowledgeBaseWriter', () => {
  let writer: KnowledgeBaseWriter;

  beforeAll(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
    writer = new KnowledgeBaseWriter(TEST_DIR);
  });

  afterAll(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  describe('writeEntry', () => {
    it('should create a new document', async () => {
      const result = await writer.writeEntry(
        makeEntry('测试文档', '这是测试内容')
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe('created');
      expect(existsSync(result.filePath)).toBe(true);
    });

    it('should skip when content is unchanged', async () => {
      const entry = makeEntry('不变文档', '不变的内容');
      const r1 = await writer.writeEntry(entry);
      const r2 = await writer.writeEntry(entry);
      expect(r1.action).toBe('created');
      expect(r2.action).toBe('skipped');
    });

    it('should update when content changes', async () => {
      const r1 = await writer.writeEntry(makeEntry('变更文档', '原始内容'));
      const r2 = await writer.writeEntry(makeEntry('变更文档', '更新后的内容'));
      expect(r1.action).toBe('created');
      expect(r2.action).toBe('updated');
    });

    it('should accept content with special characters', async () => {
      const result = await writer.writeEntry(
        makeEntry('TypeScript: 类型 & 接口', '特殊字符测试')
      );
      expect(result.success).toBe(true);
    });

    it('should create document with empty content', async () => {
      const result = await writer.writeEntry(makeEntry('空文档', ''));
      expect(result.success).toBe(true);
      expect(result.action).toBe('created');
    });
  });

  describe('snapshots', () => {
    it('should create snapshot on update', async () => {
      const title = '快照测试文档';
      await writer.writeEntry(makeEntry(title, '第一版'));
      await writer.writeEntry(makeEntry(title, '第二版'));

      const snapshots = await writer.listSnapshots(title);
      expect(snapshots.length).toBeGreaterThan(0);
    });

    it('should return empty for non-existent snapshots', async () => {
      const snapshots = await writer.listSnapshots('不存在的文档');
      expect(snapshots).toEqual([]);
    });
  });

  describe('dedup strategy', () => {
    it('should detect exact duplicate via SHA-256', async () => {
      const dedup = new KnowledgeDedupStrategy(TEST_DIR);

      // Register a document
      const content = '这是独一无二的测试内容XXXX';
      dedup.register('原文档', '原文档.md', content);

      // Check same content → duplicate
      const result = await dedup.check('另一个标题', content);
      expect(result.isDuplicate).toBe(true);
      expect(result.similarity).toBe(1.0);
      expect(result.existingTitle).toBe('原文档');
    });

    it('should not flag different content as duplicate', async () => {
      const dedup = new KnowledgeDedupStrategy(TEST_DIR);

      dedup.register('文档A', 'doc_a.md', '内容AAA');
      const result = await dedup.check('文档B', '内容BBB');
      expect(result.isDuplicate).toBe(false);
    });
  });
});
