// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * files registry 查询接口响应形态契约测试（P0-1，2026-09-07）
 *
 * 验证 BUG-2 修复：detail/search/stats 返回**裸对象**（无 {success,data} 包装），
 * 与前端 fileService/fileStore/GlobalSearchModal 直取裸字段的消费方式一致；
 * 错误分支维持 {error:{message}} + 状态码（不引入 success 包装不对称）。
 * 通过 mock.module 替换 FileRegistry（不触真实 DB）。
 */
import { describe, expect, test, beforeAll, mock } from 'bun:test';
import type http from 'http';

const fakeRegistry = {
  initDatabase: async () => {},
  searchFiles: async () => [FAKE_RECORD],
  listFiles: async () => ({ files: [FAKE_RECORD], total: 20 }),
  getStats: async () => ({
    totalFiles: 3,
    totalSize: 1024,
    todayCount: 1,
    dedupSaved: 2,
    dedupSavedSize: 512,
  }),
  getFileDetail: async (fileId: string) =>
    fileId === 'f1' ? FAKE_RECORD : null,
};

const FAKE_RECORD = {
  fileId: 'f1',
  originalName: 'sample.txt',
  mimeType: 'text/plain',
  size: 10,
  createdAt: 1788740000,
};

mock.module('@modules/services/file/FileRegistry', () => ({
  FileRegistry: { getInstance: () => fakeRegistry },
}));

import { handleFileRegistryDetail } from '../../src/infrastructure/http/handlers/files-handlers.js';
import { handleFileRegistrySearch } from '../../src/infrastructure/http/handlers/files-handlers.js';
import { handleFileRegistryStats } from '../../src/infrastructure/http/handlers/files-handlers.js';
import { buildEntryRelPath } from '../../src/infrastructure/http/handlers/files-handlers.js';

/** 捕获响应的 res stub */
function makeRes() {
  const chunks: string[] = [];
  const res = {
    statusCode: 200,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(body?: string) {
      if (body) chunks.push(body);
    },
  };
  return {
    res,
    body: () => {
      if (chunks.length === 0) return null;
      return JSON.parse(chunks.join(''));
    },
  };
}

function makeReq(url: string) {
  return {
    method: 'GET',
    url,
    headers: { host: 'localhost' },
  } as http.IncomingMessage;
}

const ctx = {} as never;

describe('files registry 查询响应形态（P0-1 去 data 包装）', () => {
  test('search（FTS q 分支）返回裸 { items, total }', async () => {
    const { res, body } = makeRes();
    await handleFileRegistrySearch(ctx, makeReq('/v1/files/registry/search?q=test&limit=10'), res as never);
    expect(res.statusCode).toBe(200);
    const b = body()!;
    expect(Array.isArray(b.items)).toBe(true);
    expect(b.items[0].fileId).toBe('f1');
    expect(b.total).toBe(1);
    expect('success' in b).toBe(false);
    expect('data' in b).toBe(false);
  });

  test('search（无 q 列表分支）返回裸 { items, total, hasMore }（P2-1 offset 分页）', async () => {
    const { res, body } = makeRes();
    await handleFileRegistrySearch(
      ctx,
      makeReq('/v1/files/registry/search?source=upload&cursor=0&limit=20'),
      res as never
    );
    expect(res.statusCode).toBe(200);
    const b = body()!;
    expect(b.items.length).toBe(1);
    expect(b.total).toBe(20);
    expect(b.hasMore).toBe(true); // 1 + 0 < 20
    expect('success' in b).toBe(false);
  });

  test('search（cursor 近末尾）hasMore=false（P2-1）', async () => {
    const { res, body } = makeRes();
    await handleFileRegistrySearch(
      ctx,
      makeReq('/v1/files/registry/search?cursor=19&limit=20'),
      res as never
    );
    expect(res.statusCode).toBe(200);
    const b = body()!;
    expect(b.hasMore).toBe(false); // 1 + 19 < 20 不成立
  });

  test('stats 返回裸 stats 对象（无 data 包装；L3 字段映射 todayInbound/dedupSize）', async () => {
    const { res, body } = makeRes();
    await handleFileRegistryStats(ctx, makeReq('/v1/files/registry/stats'), res as never);
    expect(res.statusCode).toBe(200);
    const b = body()!;
    expect(b.totalFiles).toBe(3);
    expect(b.dedupSaved).toBe(2);
    expect(b.todayInbound).toBe(1); // todayCount → todayInbound
    expect(b.dedupSize).toBe(512); // dedupSavedSize → dedupSize
    expect('success' in b).toBe(false);
    expect('data' in b).toBe(false);
  });

  test('detail 返回裸 record（无 success/data 键）', async () => {
    const { res, body } = makeRes();
    await handleFileRegistryDetail(
      ctx,
      makeReq('/v1/files/registry/detail?fileId=f1'),
      res as never
    );
    expect(res.statusCode).toBe(200);
    const b = body()!;
    expect(b.fileId).toBe('f1');
    expect('success' in b).toBe(false);
    expect('data' in b).toBe(false);
  });

  test('detail 缺 fileId → 400 { error:{message} }（错误分支不进 success 包装）', async () => {
    const { res, body } = makeRes();
    await handleFileRegistryDetail(ctx, makeReq('/v1/files/registry/detail'), res as never);
    expect(res.statusCode).toBe(400);
    const b = body()!;
    expect(b.error.message).toBe('fileId is required');
    expect('success' in b).toBe(false);
  });
});

describe('buildEntryRelPath（P1-1 逻辑相对路径构造）', () => {
  test('根视图（rawPath 空/点）→ 直接返回 name', () => {
    expect(buildEntryRelPath('', 'attachments')).toBe('attachments');
    expect(buildEntryRelPath('.', 'output')).toBe('output');
  });

  test('相对分区路径 → posix 延续拼接', () => {
    expect(buildEntryRelPath('attachments', 'sub')).toBe('attachments/sub');
    expect(buildEntryRelPath('attachments/sub', 'file.txt')).toBe(
      'attachments/sub/file.txt'
    );
  });

  test('rawPath 首尾分隔符剥离（兼容 / 与 \）', () => {
    expect(buildEntryRelPath('attachments/', 'x')).toBe('attachments/x');
    expect(buildEntryRelPath('\\attachments\\', 'y')).toBe('attachments/y');
  });
});
