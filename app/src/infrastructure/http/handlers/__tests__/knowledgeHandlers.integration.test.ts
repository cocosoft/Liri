// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * knowledge-handlers 集成测试（KB-IT，chat-export-1787871835183 #14）
 *
 * 覆盖 4 条链路（防回归）：
 * 1. 标题保存→列表同步（含 KB-P0-4 边界：正文首行非 H1 时开头插入 H1）
 * 2. trash → restore 缓存一致性（KB-P0-1）
 * 3. 长文档往返（>200 字符保存/读取后内容不丢，KB-A + getDoc）
 * 4. 路径穿越防护（../ 注入 update/delete/trash/getDoc 均被拒，KB-P0-3/KB-DOC）
 *
 * 沙箱说明：beforeAll 中 setUserDataDirOverride(临时目录) 后，registry /
 * knowledgeDocsProvider / digest / error 等所有路径解析都落到项目内临时目录
 * （沙箱可写），handler 在测试内动态 import（早于任何单例创建）。测试后清理。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { setUserDataDirOverride } from '@modules/core/paths';

const tempRoots: string[] = [];
let knowledgeRoot = '';

interface MockResponse {
  res: http.ServerResponse;
  status: number;
  body: string;
  json: unknown;
}

function makeReq(
  method: string,
  url: string,
  body?: string
): http.IncomingMessage {
  const req = new http.IncomingMessage(new net.Socket());
  req.method = method;
  req.url = url;
  req.headers = {
    host: 'localhost',
    ...(body !== undefined
      ? { 'content-length': String(Buffer.byteLength(body)) }
      : {}),
  };
  if (body !== undefined) {
    // readRequestBody 在 handler 同步段注册 data/end 监听后才会 yield，
    // nextTick 保证数据在其后送达
    process.nextTick(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  }
  return req;
}

function makeRes(): MockResponse {
  const state: { status: number; body: string } = { status: 200, body: '' };
  const res = {
    writeHead: (code: number) => {
      state.status = code;
    },
    end: (chunk?: unknown) => {
      if (chunk) state.body = String(chunk);
    },
    setHeader: () => {},
    getHeader: () => undefined,
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return state.status;
    },
    get body() {
      return state.body;
    },
    get json(): unknown {
      try {
        return JSON.parse(state.body || 'null');
      } catch {
        return null;
      }
    },
  };
}

beforeAll(async () => {
  const tempHome = await mkdtemp(join(process.cwd(), '.kb-it-home-'));
  tempRoots.push(tempHome);
  // 必须在任何 handler 动态 import 之前设置：registry/provider/digest/error
  // 的路径解析统一落到临时目录（沙箱可写）
  setUserDataDirOverride(tempHome);
  knowledgeRoot = join(tempHome, 'knowledge');
  await mkdir(knowledgeRoot, { recursive: true });
  // 隔离修复（2026-08-30）：knowledgeDocsProvider 单例与 KnowledgeBaseRegistry 单例
  // 均在模块加载时用 resolvePyappHome() 固定根路径——若其他测试文件先加载了
  // handler/provider/registry，本测试的 setUserDataDirOverride 对其不生效
  //（全量 `bun test` 时实测 KB-IT 3 fail）。显式重设根路径，不再依赖
  // "handler 第一个初始化"前提。
  const { knowledgeDocsProvider } =
    await import('@modules/docs/FileDocsProvider');
  knowledgeDocsProvider.setDocsRoots(knowledgeRoot);
  const { getDefaultKnowledgeBaseRegistry } =
    await import('@modules/knowledge');
  getDefaultKnowledgeBaseRegistry().setKnowledgeRoot(knowledgeRoot);
  // 显式放宽超时（M1，2026-09-11）：本 hook 首次动态导入整条 handler 链
  // （ConfigManager / registry / DB），冷启动实测约 8.6s，超过 bun 默认 hook 超时（5s）
  // → 默认配置下必然失败。此处局部放宽，不改全局 test timeout（避免掩盖真实挂起）。
}, 30000);

afterAll(async () => {
  setUserDataDirOverride(null);
  for (const root of tempRoots) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Windows EBUSY：ConfigManager watchFile / attachments 句柄未及时释放。
      // 清理为 best-effort——延迟重试一次后放弃（残留临时目录无害，不影响测试结果）。
      await new Promise((r) => setTimeout(r, 200));
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        // 仍失败则忽略
      }
    }
  }
});

async function clearProviderCache(): Promise<void> {
  const { knowledgeDocsProvider } =
    await import('@modules/docs/FileDocsProvider');
  knowledgeDocsProvider.clearCache();
}

async function listItems(): Promise<{ title: string; docPath: string }[]> {
  const { handleListKnowledge } = await import('../knowledge-handlers');
  const mock = makeRes();
  await handleListKnowledge(makeReq('GET', '/v1/knowledge'), mock.res);
  expect(mock.status).toBe(200);
  const data = mock.json as { items: { title: string; docPath: string }[] };
  return data.items ?? [];
}

describe('KB-IT：knowledge-handlers 集成（4 条链路）', () => {
  it('1. 标题保存→列表同步（KB-P0-4 边界：正文首行非 H1 时开头插入 H1）', async () => {
    const { handleUpdateKnowledgeDoc } = await import('../knowledge-handlers');
    // 1a. 无 frontmatter 文档改标题 → 列表 title 更新（frontmatter title 优先，KB-P1-5）
    await writeFile(
      join(knowledgeRoot, '无fm.md'),
      '## 二级标题\n正文',
      'utf-8'
    );
    const put1 = makeRes();
    await handleUpdateKnowledgeDoc(
      makeReq(
        'PUT',
        '/v1/knowledge/docs',
        JSON.stringify({
          docPath: '无fm.md',
          title: '无FM新标题',
          content: '## 二级标题\n正文',
        })
      ),
      put1.res
    );
    expect(put1.status).toBe(200);
    expect(
      (await listItems()).find((i) => i.docPath === '无fm.md')?.title
    ).toBe('无FM新标题');

    // 1b. 有 frontmatter + 正文首行是 ## 二级 → 主分支开头插入 # 新标题（KB-P0-4）
    await writeFile(
      join(knowledgeRoot, '有fm.md'),
      ['---', 'title: "旧标题"', '---', '', '## 二级标题', '正文'].join('\n'),
      'utf-8'
    );
    const put2 = makeRes();
    await handleUpdateKnowledgeDoc(
      makeReq(
        'PUT',
        '/v1/knowledge/docs',
        JSON.stringify({
          docPath: '有fm.md',
          title: 'FM新标题',
          content: '## 二级标题\n正文',
        })
      ),
      put2.res
    );
    expect(put2.status).toBe(200);
    const fileContent = await readFile(join(knowledgeRoot, '有fm.md'), 'utf-8');
    expect(fileContent).toContain('# FM新标题'); // KB-P0-4 插入 H1
    expect(
      (await listItems()).find((i) => i.docPath === '有fm.md')?.title
    ).toBe('FM新标题');
  }, 30_000); // 集成测试：首次动态 import + ConfigManager/attachments 初始化开销大，默认 5s 超时不足

  it('2. trash → restore 缓存一致性（KB-P0-1）', async () => {
    await writeFile(
      join(knowledgeRoot, 'trash-往返.md'),
      '# 回收往返\n内容',
      'utf-8'
    );
    // 直接写盘绕过了 handler 的 clearCache，先失效缓存再断言列表
    await clearProviderCache();
    const { handleTrashKnowledge, handleRestoreTrash } =
      await import('../knowledge-handlers');

    // 初始在列表
    expect((await listItems()).some((i) => i.docPath === 'trash-往返.md')).toBe(
      true
    );

    // trash 后不在列表（clearCache + 扫描器跳过 .knowledge-trash）
    const trash = makeRes();
    await handleTrashKnowledge(
      makeReq(
        'POST',
        '/v1/knowledge/trash',
        JSON.stringify({ docPath: 'trash-往返.md' })
      ),
      trash.res
    );
    expect(trash.status).toBe(200);
    expect((await listItems()).some((i) => i.docPath === 'trash-往返.md')).toBe(
      false
    );

    // restore 后立即可见
    const restore = makeRes();
    await handleRestoreTrash(
      makeReq(
        'POST',
        '/v1/knowledge/restore-trash',
        JSON.stringify({ docPath: 'trash-往返.md' })
      ),
      restore.res
    );
    expect(restore.status).toBe(200);
    expect((await listItems()).some((i) => i.docPath === 'trash-往返.md')).toBe(
      true
    );
  });

  it('3. 长文档往返（>200 字符保存/读取不丢，KB-A + getDoc）', async () => {
    const longBody = '正文内容片段。'.repeat(60); // > 200 字符
    await writeFile(
      join(knowledgeRoot, '长文档.md'),
      `# 长文档\n${longBody}`,
      'utf-8'
    );

    const { handleGetKnowledgeDoc, handleUpdateKnowledgeDoc } =
      await import('../knowledge-handlers');

    // getDoc 返回完整 content（不被 200 字符裁剪）
    const doc = makeRes();
    await handleGetKnowledgeDoc(
      makeReq(
        'GET',
        `/v1/knowledge/doc?docPath=${encodeURIComponent('长文档.md')}`
      ),
      doc.res
    );
    expect(doc.status).toBe(200);
    const data = doc.json as { content: string };
    expect(data.content).toContain(longBody);
    expect(data.content.length).toBeGreaterThan(200);

    // 保存长内容 → 文件完整落盘
    const put = makeRes();
    await handleUpdateKnowledgeDoc(
      makeReq(
        'PUT',
        '/v1/knowledge/docs',
        JSON.stringify({
          docPath: '长文档.md',
          title: '长文档',
          content: `# 长文档\n${longBody}`,
        })
      ),
      put.res
    );
    expect(put.status).toBe(200);
    const fileContent = await readFile(
      join(knowledgeRoot, '长文档.md'),
      'utf-8'
    );
    expect(fileContent).toContain(longBody);
    expect(fileContent.length).toBeGreaterThan(200);
  });

  it('4. 路径穿越防护（../ 注入 update/delete/trash/getDoc 均被拒）', async () => {
    const {
      handleUpdateKnowledgeDoc,
      handleDeleteKnowledge,
      handleTrashKnowledge,
      handleGetKnowledgeDoc,
    } = await import('../knowledge-handlers');

    // update ../ 逃逸
    const put = makeRes();
    await handleUpdateKnowledgeDoc(
      makeReq(
        'PUT',
        '/v1/knowledge/docs',
        JSON.stringify({ docPath: '../escape.md', content: 'x' })
      ),
      put.res
    );
    expect(put.status).toBe(500);

    // delete ../ 逃逸（knowledgeId 来自 URL）
    const del = makeRes();
    await handleDeleteKnowledge(
      makeReq('DELETE', '/v1/knowledge/../escape.md'),
      del.res,
      '../escape.md'
    );
    expect(del.status).toBe(500);

    // trash ../ 逃逸
    const trash = makeRes();
    await handleTrashKnowledge(
      makeReq(
        'POST',
        '/v1/knowledge/trash',
        JSON.stringify({ docPath: '../escape.md' })
      ),
      trash.res
    );
    expect(trash.status).toBe(500);

    // getDoc ../ 逃逸
    const doc = makeRes();
    await handleGetKnowledgeDoc(
      makeReq('GET', '/v1/knowledge/doc?docPath=../escape.md'),
      doc.res
    );
    expect(doc.status).toBe(500);
  });
});
