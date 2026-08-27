/**
 * knowledge-handlers.ts — 知识库相关 HTTP 处理器（从 LocalHTTPService 提取）
 */

import type http from 'http';
import {
  sendError,
  readRequestBody,
  broadcastEvent,
  checkFilePathPermission,
  notifyFileChanged,
} from './handler-utils';
import { SandboxPermission } from '@modules/sandbox/SandboxTypes';
import { sanitizeFileName } from '@modules/services/file/fileNaming';

import { handleError } from '@modules/error';

/**
 * B-D1 修复：知识库 baseName 防路径穿越。
 * base 输入框为自由文本（SaveKnowledgeModal 可手动输入），若直接
 * `join(knowledgeRoot, baseName)`，注入 `../../xxx` 可逃逸知识库根目录
 * 写任意位置文件。清洗规则：去掉路径分隔符与 `..`，空值回退 default。
 */
function sanitizeBaseName(name: string | undefined | null): string {
  const cleaned = (name ?? '')
    .replace(/[\\/]/g, '')
    .replace(/\.\./g, '')
    .trim();
  return cleaned || 'default';
}

// KB-P2-13（2026-08-27）：digest 全量重建 debounce——原每次保存串行 await 全量重建，
// 文档多时保存变慢；合并 500ms 内多次写操作（连续保存/标签/移动）为一次重建
let digestTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDigestRebuild(): void {
  if (digestTimer) clearTimeout(digestTimer);
  digestTimer = setTimeout(async () => {
    digestTimer = null;
    try {
      const { getDefaultDigestService } =
        await import('@modules/knowledge/KnowledgeDigestService');
      await getDefaultDigestService().buildDigest();
    } catch (err) {
      handleError(err, {
        module: 'infrastructure:http:handlers:knowledge-handlers',
        action: 'digestRebuildFailed',
      });
    }
  }, 500);
}

export async function handleListKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { parseFrontmatter } = await import('@modules/knowledge/frontmatter');
    const { stat } = await import('fs/promises');
    const { join } = await import('path');

    const parsedUrl = new URL(req.url || '', 'http://localhost');
    const baseFilter = parsedUrl.searchParams.get('base');
    const offset = Math.max(
      0,
      parseInt(parsedUrl.searchParams.get('offset') || '0', 10) || 0
    );
    const limit = Math.min(
      100,
      Math.max(
        1,
        parseInt(parsedUrl.searchParams.get('limit') || '50', 10) || 50
      )
    );

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();

    const docs = await knowledgeDocsProvider.buildIndex();
    // KB-P1-7（2026-08-27）：stat 并行化——原 for 内串行 await stat，
    // 文档多时列表延迟显著；先 Promise.all 并行采集元数据再组装
    const statResults = await Promise.all(
      docs.map(async (doc) => {
        const docPath = doc.relativePath || '';
        const fullPath = join(knowledgeRoot, docPath);
        try {
          const fileStat = await stat(fullPath);
          return {
            docPath,
            size: fileStat.size,
            updatedAt: fileStat.mtimeMs,
            createdAt: fileStat.birthtimeMs,
          };
        } catch (err) {
          // 文件可能已被移动，使用默认值

          handleError(err, {
            module: 'infrastructure:http:handlers:knowledge-handlers',
            action: 'fileMovedFallback',
          });
          return { docPath, size: 0, updatedAt: 0, createdAt: 0 };
        }
      })
    );
    const statMap = new Map(statResults.map((r) => [r.docPath, r]));
    const result = [];

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const docPath = doc.relativePath || '';
      const baseName = docPath.split(/[/\\]/)[0];

      if (baseFilter && baseName !== baseFilter) continue;

      const meta = statMap.get(docPath) ?? {
        size: 0,
        updatedAt: 0,
        createdAt: 0,
      };
      const size = meta.size;
      const updatedAt = meta.updatedAt;
      const createdAt = meta.createdAt;
      let source = 'manual';

      const content = doc.content || '';
      // KB-P1-8（2026-08-27）：使用公共 frontmatter parser，收敛重复手写解析
      const parsed = parseFrontmatter(content);
      let category = doc.category || '根目录';
      let tags: string[] = [];
      if (parsed) {
        if (parsed.source) source = parsed.source;
        if (parsed.category) category = parsed.category;
        if (parsed.tags.length > 0) tags = parsed.tags;
      }

      result.push({
        id: docPath,
        title: doc.title || '',
        // KB-A（2026-08-27）：返回完整内容——原 slice(0,500) 截断版被编辑器/详情直接使用，
        // 保存会把长文档截断丢数据；完整返回仅增大响应体，后端 buildIndex 本就已读全文
        content,
        category,
        tags,
        docPath,
        size,
        updated_at: updatedAt,
        created_at: createdAt,
        source,
        base: baseName,
      });
    }

    const total = result.length;
    const paged = result.slice(offset, offset + limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        items: paged,
        total,
        offset,
        limit,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理搜索知识请求
 * 使用 HybridKnowledgeRouter 进行混合搜索
 */
export async function handleSearchKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { query, tags } = JSON.parse(body);
    if (!query) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

    // 解析 URL 查询参数（base, domain, tags 等）
    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const _base = url.searchParams.get('base') ?? undefined;
    const domain = url.searchParams.get('domain') ?? undefined;
    const urlTags = url.searchParams
      .get('tags')
      ?.split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const filterTags = tags ?? urlTags;

    const { KnowledgeRouter } =
      await import('@modules/knowledge/KnowledgeRouter');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { stat, open } = await import('fs/promises');
    const { join } = await import('path');
    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();

    const router = new KnowledgeRouter(knowledgeDocsProvider);
    const routes = await router.search(query, {
      maxResults: 20,
      ...(domain ? ({ domain } as any) : {}),
    });

    // P2-2: 按标签过滤（大小写不敏感）
    const filtered = filterTags?.length
      ? routes.filter((route: any) =>
          filterTags.some((t: string) =>
            (route.tags ?? []).some(
              (tag: string) => tag.toLowerCase() === t.toLowerCase()
            )
          )
        )
      : routes;

    // P2-7: 补充 size/updated_at/source（stat + frontmatter 头部解析）
    const result = await Promise.all(
      filtered.map(async (route: any) => {
        let size = 0;
        let updatedAt = 0;
        let source = 'manual';
        try {
          const fullPath = join(knowledgeRoot, route.docPath);
          const fileStat = await stat(fullPath);
          size = fileStat.size;
          updatedAt = fileStat.mtimeMs;
          // 仅读取文件头部（frontmatter 所在区域）解析 source
          const fileHandle = await open(fullPath, 'r');
          try {
            const head = Buffer.alloc(2048);
            const { bytesRead } = await fileHandle.read(
              head,
              0,
              head.length,
              0
            );
            const fmMatch = head
              .toString('utf-8', 0, bytesRead)
              .match(/^---\n([\s\S]*?)\n---/);
            const sourceLine = fmMatch?.[1]
              .split('\n')
              .find((l: string) => l.trim().startsWith('source:'));
            if (sourceLine) {
              const val =
                sourceLine.split(':')[1]?.trim().replace(/"/g, '') || '';
              if (val) source = val;
            }
          } finally {
            await fileHandle.close();
          }
        } catch {
          // 文件不存在等异常时保持默认值
        }
        return {
          id: `knowledge-${route.docPath}`,
          title: route.title,
          content: route.snippet || '',
          category: route.category || '根目录',
          score: route.score,
          matchType: route.matchType,
          docPath: route.docPath,
          tags: route.tags ?? [],
          size,
          updated_at: updatedAt,
          source,
        };
      })
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理创建知识条目请求
 * 将新知识写入用户知识库目录（~/.pyapp/knowledge/）
 */
export async function handleCreateKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { title, content, category } = JSON.parse(body);
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'title is required' } }));
      return;
    }
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    const { writeFile, mkdir } = await import('fs/promises');
    const { join, relative } = await import('path');

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();
    // P2-3: 与列表 docPath 语义统一（相对路径）；"根目录"不建子目录
    // KB-P0-3（2026-08-27）：category 为自由文本（前端可手动输入），
    // 直接 join(knowledgeRoot, category) 可注入 ../../xxx 逃逸根目录——统一走 sanitizeBaseName
    const useRootDir = !category || category === '根目录';
    const targetDir = useRootDir
      ? knowledgeRoot
      : join(knowledgeRoot, sanitizeBaseName(category));
    await mkdir(targetDir, { recursive: true });
    const fileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    const filePath = join(targetDir, fileName);
    const fileContent = content
      ? `# ${title}\n\n${content}\n`
      : `# ${title}\n\n`;
    await writeFile(filePath, fileContent, 'utf-8');
    // KB-P0-2（2026-08-27）：创建后清缓存，否则新建文档要等其它操作触发清缓存才出现在列表
    knowledgeDocsProvider.clearCache();
    const docPath = relative(knowledgeRoot, filePath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: docPath,
        title,
        content: content || '',
        category: category || '根目录',
        docPath,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    );
    broadcastEvent('knowledge:created', { id: docPath, title });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理更新知识条目请求
 * knowledgeId 为 docPath（相对路径），从知识库根目录查找文件
 */
export async function handleUpdateKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  knowledgeId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { title, content } = JSON.parse(body);
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { writeFile } = await import('fs/promises');
    const { join } = await import('path');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const filePath = join(registry.getKnowledgeRoot(), knowledgeId);

    let fileContent: string;
    if (title && content) {
      fileContent = `---\ntitle: "${title}"\nupdated_at: ${Date.now()}\n---\n\n${content}\n`;
    } else if (content) {
      fileContent = content;
    } else {
      fileContent = `# ${title}\n\n`;
    }

    await writeFile(filePath, fileContent, 'utf-8');
    knowledgeDocsProvider.clearCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: knowledgeId,
        title: title || '',
        content: content || '',
        updated_at: Date.now(),
      })
    );
    broadcastEvent('knowledge:updated', { id: knowledgeId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理删除知识条目请求
 * knowledgeId 为 docPath（相对路径），从知识库根目录删除文件
 */
export async function handleDeleteKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  knowledgeId: string
): Promise<void> {
  try {
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const filePath = join(registry.getKnowledgeRoot(), knowledgeId);

    if (existsSync(filePath)) {
      await unlink(filePath);
      knowledgeDocsProvider.clearCache();
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    broadcastEvent('knowledge:deleted', { id: knowledgeId });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理列出知识库请求 GET /v1/knowledge/bases
 */
export async function handleListKnowledgeBases(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    const bases = await registry.listBases();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(bases));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理创建知识库请求 POST /v1/knowledge/bases
 */
export async function handleCreateKnowledgeBase(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { name, label, icon } = JSON.parse(body);

    if (!name || !label) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'name and label are required' } })
      );
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    const base = await registry.createBase(name, label, icon);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(base));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('已存在')) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message } }));
      return;
    }
    sendError(res, err);
  }
}

/**
 * 处理更新知识库请求 PUT /v1/knowledge/bases/:name
 */
export async function handleUpdateKnowledgeBase(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseName: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { label, enabled, icon } = JSON.parse(body);

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    const base = await registry.updateBase(baseName, {
      label,
      enabled,
      icon,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(base));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('不存在')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message } }));
      return;
    }
    sendError(res, err);
  }
}

/**
 * 处理删除知识库请求 DELETE /v1/knowledge/bases/:name
 */
export async function handleDeleteKnowledgeBase(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseName: string
): Promise<void> {
  try {
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    await registry.deleteBase(baseName);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('不存在')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message } }));
      return;
    }
    sendError(res, err);
  }
}

/**
 * 克隆知识库（含所有文件） POST /v1/knowledge/bases/:name/clone
 */
export async function handleCloneKnowledgeBase(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseName: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { target } = JSON.parse(body);

    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '缺少 target 名称' } }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    const result = await registry.cloneBase(baseName, target);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(message.includes('不存在') ? 404 : 409, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: { message } }));
  }
}

/**
 * 复制知识库配置 POST /v1/knowledge/bases/:name/duplicate
 */
export async function handleDuplicateKnowledgeBase(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseName: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { target } = JSON.parse(body);

    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '缺少 target 名称' } }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const registry = getDefaultKnowledgeBaseRegistry();
    const result = await registry.duplicateConfig(baseName, target);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(message.includes('不存在') ? 404 : 409, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ error: { message } }));
  }
}

/**
 * 处理聊天保存到知识库请求 POST /v1/knowledge/save-from-chat
 */
export async function handleSaveFromChat(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { base, title, content, sessionId } = JSON.parse(body);

    if (!title || !content) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'title and content are required' },
        })
      );
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    // B-D1 修复：baseName 必须经路径穿越清洗（base 为自由文本，可注入 ../../xxx）
    const baseName = sanitizeBaseName(base);
    const baseDir = join(registry.getKnowledgeRoot(), baseName);

    await mkdir(baseDir, { recursive: true });

    const fileName = `${title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
    const filePath = join(baseDir, fileName);

    const now = new Date().toISOString();
    const frontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `source: "chat-save"`,
      sessionId ? `savedFrom: "${sessionId}"` : '',
      `savedAt: "${now}"`,
      '---',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    // KB-SMOKE（2026-08-27）：filter(Boolean) 会剔除末尾空串，frontmatter join 后
    // 以 `---` 结尾无换行，content 直接粘连成 `---## 二级开头`——frontmatter 闭合
    // 行与正文同行导致后续 indexOf('---') 匹配失败、PUT 走主分支产生重复 frontmatter。
    // 显式补两个换行保证 frontmatter 与正文分行。
    const fileContent = `${frontmatter}\n\n${content}\n`;
    await writeFile(filePath, fileContent, 'utf-8');
    knowledgeDocsProvider.clearCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: true,
        docPath: join(baseName, fileName),
        title,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

// ========== Knowledge Upload & Compile Handlers ==========

/**
 * 处理知识库文件上传请求 POST /v1/knowledge/upload
 *
 * 请求体: { baseName, filename, data (base64), tags?, category? }
 * 处理逻辑:
 *   - .md 文件直接写入目标知识库目录，补充 YAML frontmatter
 *   - 可转换的二进制文件（.docx/.xlsx/.pdf 等）使用 ConverterEngine 提取文本，
 *     保存原始文件 + 提取的 Markdown，并写入 knowledge/raw/ 供编译器消费
 *   - 其他文本类非 .md 文件写入 raw/ 子目录，以触发后续 LLM 编译
 */
export async function handleKnowledgeUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const {
      baseName: rawBaseName,
      filename,
      data,
      tags,
      category,
    } = JSON.parse(body);

    if (!rawBaseName || !filename || !data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'baseName, filename and data are required' },
        })
      );
      return;
    }

    // KB-P0-3（2026-08-27）：baseName 为自由文本，直接 join 可注入 ../../xxx 逃逸
    // 知识库根目录写任意位置——解构后统一清洗，后续所有 baseName 引用均为安全值
    const baseName = sanitizeBaseName(rawBaseName);

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { writeFile, mkdir } = await import('fs/promises');
    const { join, extname, basename } = await import('path');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();

    const safeName = sanitizeFileName(filename);
    const ext = extname(filename).toLowerCase();

    const baseDir = join(knowledgeRoot, baseName);
    const now = new Date().toISOString();
    const tagList = Array.isArray(tags) ? tags : [];

    /**
     * 需要 ConverterEngine 转换的二进制文件扩展名
     */
    const BINARY_EXTENSIONS = new Set([
      '.docx',
      '.xlsx',
      '.xls',
      '.pptx',
      '.pdf',
      '.epub',
      '.ipynb',
      '.zip',
      '.msg',
      '.rss',
      '.atom',
    ]);

    let docRelativePath: string;
    const rawBuffer = Buffer.from(data, 'base64');

    if (ext === '.md') {
      docRelativePath = join(baseName, safeName);
      const fullPath = join(knowledgeRoot, docRelativePath);

      await mkdir(baseDir, { recursive: true });

      const rawContent = rawBuffer.toString('utf-8');
      const frontmatter = [
        '---',
        `title: "${safeName.replace(/\.md$/i, '')}"`,
        `source: "upload"`,
        `uploadedAt: "${now}"`,
        category ? `category: "${category}"` : '',
        tagList.length > 0
          ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
          : '',
        '---',
        '',
      ]
        .filter(Boolean)
        .join('\n');

      // KB-SMOKE（2026-08-27）：frontmatter join 后以 --- 结尾无换行，直接拼 rawContent
      // 会粘连成 `---## 正文`（frontmatter 闭合行与正文同行）——显式补两个换行
      const fileContent = rawContent.startsWith('---')
        ? rawContent
        : `${frontmatter}\n\n${rawContent}\n`;

      await writeFile(fullPath, fileContent, 'utf-8');
    } else if (BINARY_EXTENSIONS.has(ext)) {
      const nameStem = basename(safeName, ext);
      const rawDir = join(baseDir, 'raw');
      await mkdir(rawDir, { recursive: true });

      // 1. 保存原始二进制文件到 {baseDir}/raw/original_*
      const originalRawName = `original_${safeName}`;
      await writeFile(join(rawDir, originalRawName), rawBuffer);

      // 2. 使用 ConverterEngine 提取文本
      const { getConverterEngine } =
        await import('@modules/tools/converter/engine/ConverterEngine');
      const engine = getConverterEngine();
      const fileInfo = engine.getDetector().detect(filename, rawBuffer.length);
      const result = await engine.convertContent(fileInfo, rawBuffer);
      const extractedContent = result.markdown;

      // 3. 保存提取的 Markdown 到 {baseDir}/raw/{stem}.md（伴侣文件）
      const companionName = `${nameStem}.md`;
      await writeFile(join(rawDir, companionName), extractedContent, 'utf-8');

      // 4. 同时写入 knowledge/raw/ 顶层目录供编译器消费
      const topRawDir = join(knowledgeRoot, 'raw');
      await mkdir(topRawDir, { recursive: true });
      const compilerFileName = `${baseName}_${nameStem}.txt`;
      await writeFile(
        join(topRawDir, compilerFileName),
        extractedContent,
        'utf-8'
      );

      // 5. 写 companion meta.json，记录原始文件路径
      const metaPath = join(topRawDir, `${compilerFileName}.meta.json`);
      await writeFile(
        metaPath,
        JSON.stringify({
          originalFile: `${baseName}/raw/${originalRawName}`,
          originalFormat: ext,
          source: 'upload-extracted',
          uploadedAt: now,
          category: category || null,
        }),
        'utf-8'
      );

      // 6. 创建知识文档，frontmatter 包含 originalFile 追溯信息
      docRelativePath = join(baseName, `${nameStem}.md`);
      const fullPath = join(knowledgeRoot, docRelativePath);
      const docContent = [
        '---',
        `title: "${nameStem}"`,
        `source: "upload-extracted"`,
        `uploadedAt: "${now}"`,
        category ? `category: "${category}"` : '',
        tagList.length > 0
          ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
          : '',
        `originalFile: "${baseName}/raw/${originalRawName}"`,
        `originalFormat: "${ext}"`,
        '---',
        '',
        extractedContent,
      ]
        .filter(Boolean)
        .join('\n');
      await writeFile(fullPath, docContent, 'utf-8');
    } else {
      // 其他文本类非 .md 文件（.txt/.json/.csv/.yaml 等）
      const rawContent = rawBuffer.toString('utf-8');
      const rawDir = join(baseDir, 'raw');
      await mkdir(rawDir, { recursive: true });

      const rawRelativePath = join(baseName, 'raw', safeName);
      const fullRawPath = join(knowledgeRoot, rawRelativePath);
      await writeFile(fullRawPath, rawContent, 'utf-8');

      // 也写入 knowledge/raw/ 顶层，供编译器消费
      const topRawDir = join(knowledgeRoot, 'raw');
      await mkdir(topRawDir, { recursive: true });
      const compilerFileName = `${baseName}_${safeName}.txt`;
      await writeFile(join(topRawDir, compilerFileName), rawContent, 'utf-8');

      docRelativePath = join(baseName, `${safeName}.md`);
      const fullPath = join(knowledgeRoot, docRelativePath);

      const frontmatter = [
        '---',
        `title: "${safeName}"`,
        `source: "upload"`,
        `uploadedAt: "${now}"`,
        category ? `category: "${category}"` : '',
        tagList.length > 0
          ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
          : '',
        `originalFormat: "${ext}"`,
        `needsCompile: true`,
        '---',
        '',
        `> 此文件来自 ${ext} 格式上传，尚未经过 LLM 编译。请触发「编译 raw」操作以生成结构化文档。`,
        '',
        '```',
        rawContent.slice(0, 1000),
        rawContent.length > 1000 ? '\n...（内容已截断）' : '',
        '```',
        '',
      ].join('\n');

      await writeFile(fullPath, frontmatter, 'utf-8');
    }

    knowledgeDocsProvider.clearCache();

    if (ext !== '.md') {
      notifyFileChanged();
    }

    const size = rawBuffer.length;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        docPath: docRelativePath,
        title: safeName.replace(/\.\w+$/, ''),
        size,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理知识库编译请求 POST /v1/knowledge/compile
 *
 * 触发 KnowledgeCompiler 对 raw/ 目录中的原始文件进行 LLM 编译
 */
export async function handleKnowledgeCompile(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { force } = JSON.parse(body);

    const { aiService } = await import('@modules/ai/services/aiService');
    const { runKnowledgeCompile } =
      await import('@modules/knowledge/KnowledgeCompiler');

    const result = await runKnowledgeCompile(aiService, { force: !!force });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * W9: 获取编译进度 GET /v1/knowledge/compile-status
 *
 * 返回 KnowledgeCompiler.compile() 的实时进度
 */
export async function handleKnowledgeCompileStatus(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getCompileProgress } =
      await import('@modules/knowledge/CompileProgressTracker');
    const progress = getCompileProgress();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(progress));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取待编译的 raw 文件列表 GET /v1/knowledge/raw-files
 *
 * 返回 raw/ 目录中所有未编译文件的详细信息（文件名、大小、修改时间、元数据）
 */
export async function handleGetRawFiles(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { readdir, stat } = await import('fs/promises');
    const { join, extname } = await import('path');
    const { readFileSync, existsSync } = await import('fs');
    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');

    const registry = getDefaultKnowledgeBaseRegistry();
    const rawDir = join(registry.getKnowledgeRoot(), 'raw');

    if (!existsSync(rawDir)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files: [], totalCount: 0 }));
      return;
    }

    const entries = await readdir(rawDir);
    const metaFiles = entries.filter((f) => f.endsWith('.meta.json'));
    const dataFiles = entries.filter((f) => !f.endsWith('.meta.json'));

    const files = [];
    for (const file of dataFiles) {
      const filePath = join(rawDir, file);
      const fileStat = await stat(filePath);
      const metaFile = `${file}.meta.json`;
      let meta = null;

      if (metaFiles.includes(metaFile)) {
        try {
          const metaContent = readFileSync(join(rawDir, metaFile), 'utf-8');
          meta = JSON.parse(metaContent);
        } catch (err) {
          // 元数据文件损坏，忽略

          handleError(err, {
            module: 'infrastructure:http:handlers:knowledge-handlers',
            action: 'metaFileCorrupted',
          });
        }
      }

      files.push({
        fileName: file,
        ext: extname(file).toLowerCase(),
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
        createdAt: fileStat.birthtimeMs || fileStat.ctimeMs,
        category: meta?.category || null,
        source: meta?.source || null,
      });
    }

    files.sort((a, b) => b.modifiedAt - a.modifiedAt);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        files,
        totalCount: files.length,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 导出知识文档到 Notebook 兼容格式
 * POST /v1/knowledge/export-to-notebook
 *
 * 将知识文档内容导出为 .md 文件，存放在 ~/.pyapp/output/notebooks/ 目录
 */
export async function handleExportToNotebook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { docPath, title } = JSON.parse(body);

    if (!docPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'docPath is required' } }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');
    const { resolveOutputDir } = await import('@modules/core/paths');

    const registry = getDefaultKnowledgeBaseRegistry();
    const sourcePath = join(registry.getKnowledgeRoot(), docPath);

    const content = await readFile(sourcePath, 'utf-8');

    const notebooksDir = join(resolveOutputDir(), 'notebooks');
    await mkdir(notebooksDir, { recursive: true });

    const safeName = (title || docPath.replace(/\.md$/i, '')).replace(
      /[\\/:*?"<>|]/g,
      '_'
    );
    const exportPath = join(notebooksDir, `${safeName}_${Date.now()}.md`);

    await writeFile(exportPath, content, 'utf-8');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        exportPath,
        fileName: `${safeName}_${Date.now()}.md`,
        size: content.length,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 从外部文件导入知识文档
 * POST /v1/knowledge/import-from-file
 *
 * 读取指定路径的 .md 文件，将其内容导入到知识库
 */
export async function handleImportFromFile(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { filePath, baseName, tags } = JSON.parse(body);

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'filePath is required' } }));
      return;
    }

    // 沙箱权限检查
    if (!checkFilePathPermission(filePath, SandboxPermission.READ_FILE)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Access denied: file path not in whitelist' },
        })
      );
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const { join, basename, extname } = await import('path');
    const { existsSync } = await import('fs');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: `File not found: ${filePath}` } })
      );
      return;
    }

    const originalName = basename(filePath);
    const ext = extname(originalName).toLowerCase();

    /**
     * 需要 ConverterEngine 转换的二进制文件扩展名
     */
    const BINARY_EXTENSIONS = new Set([
      '.docx',
      '.xlsx',
      '.xls',
      '.pptx',
      '.pdf',
      '.epub',
      '.ipynb',
      '.zip',
      '.msg',
      '.rss',
      '.atom',
    ]);

    let rawContent: string;

    if (BINARY_EXTENSIONS.has(ext)) {
      const { getConverterEngine } =
        await import('@modules/tools/converter/engine/ConverterEngine');
      const engine = getConverterEngine();
      const result = await engine.convertFile(filePath);
      rawContent = result.markdown;
    } else {
      rawContent = await readFile(filePath, 'utf-8');
    }

    const targetBase = baseName || 'default';
    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();
    const baseDir = join(knowledgeRoot, targetBase);

    await mkdir(baseDir, { recursive: true });

    const docPath = join(targetBase, originalName);
    const fullPath = join(knowledgeRoot, docPath);

    const tagList = Array.isArray(tags) ? tags : [];
    const now = new Date().toISOString();

    if (!rawContent.startsWith('---')) {
      const frontmatter = [
        '---',
        `title: "${originalName.replace(/\.md$/i, '')}"`,
        `source: "import"`,
        `importedAt: "${now}"`,
        tagList.length > 0
          ? `tags: [${tagList.map((t: string) => `"${t}"`).join(', ')}]`
          : '',
        BINARY_EXTENSIONS.has(ext) ? `originalFormat: "${ext}"` : '',
        BINARY_EXTENSIONS.has(ext) ? `originalFile: "${filePath}"` : '',
        '---',
        '',
      ]
        .filter(Boolean)
        .join('\n');
      // KB-SMOKE（2026-08-27）：frontmatter 与正文之间显式补换行，避免粘连成 `---## 正文`
      await writeFile(fullPath, `${frontmatter}\n\n${rawContent}\n`, 'utf-8');
    } else {
      await writeFile(fullPath, rawContent, 'utf-8');
    }

    knowledgeDocsProvider.clearCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        docPath,
        title: originalName.replace(/\.\w+$/, ''),
        size: rawContent.length,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理知识库文档内容更新请求 PUT /v1/knowledge/docs
 *
 * 请求体: { docPath, content, title? }
 * 处理逻辑:
 *   1. 读取原文件，解析 frontmatter
 *   2. 保留或更新 frontmatter
 *   3. 将新内容写入文件
 *   4. 重建 DigestService 缓存
 */
export async function handleUpdateKnowledgeDoc(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { docPath, content, title, tags, category, base } = JSON.parse(body);

    // P2-4: 移动场景允许 content 为空（仅提供 base）
    if (!docPath || (!content && !base)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'docPath and content are required' },
        })
      );
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { readFile, writeFile, mkdir, rename } = await import('fs/promises');
    const { join, relative, basename, dirname } = await import('path');
    const { existsSync } = await import('fs');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();
    let effectiveDocPath = docPath;
    const filePath = join(knowledgeRoot, docPath);

    // P2-4: 移动文档到目标知识库（base 语义与 list 的 baseName 一致）
    if (base !== undefined) {
      const sepIdx = Math.max(
        docPath.lastIndexOf('/'),
        docPath.lastIndexOf('\\')
      );
      const currentBase = sepIdx === -1 ? '' : docPath.slice(0, sepIdx);
      // KB-P0-3（2026-08-27）：base 移动目标为自由文本，防路径穿越逃逸根目录
      const targetBase =
        !base || base === '根目录' ? '' : sanitizeBaseName(base);
      if (targetBase !== currentBase && existsSync(filePath)) {
        const fileName = basename(docPath);
        const newPath = targetBase
          ? join(knowledgeRoot, targetBase, fileName)
          : join(knowledgeRoot, fileName);
        await mkdir(dirname(newPath), { recursive: true });
        await rename(filePath, newPath);
        effectiveDocPath = relative(knowledgeRoot, newPath);
      }
    }

    // P2-4: 移动后使用新路径继续处理
    const effectiveFilePath = join(knowledgeRoot, effectiveDocPath);
    let frontmatterLines: string[] = [];

    if (existsSync(effectiveFilePath)) {
      const existingContent = await readFile(effectiveFilePath, 'utf-8');
      const lines = existingContent.split('\n');

      if (lines[0]?.trim() === '---') {
        const endIdx = lines.indexOf('---', 1);
        if (endIdx !== -1) {
          const fmLines = lines.slice(1, endIdx);

          const hasTags = Array.isArray(tags);
          const hasCategory = category !== undefined;

          for (const line of fmLines) {
            if (title && line.startsWith('title:')) {
              const escapedTitle = title.replace(/"/g, '\\"');
              frontmatterLines.push(`title: "${escapedTitle}"`);
            } else if (hasTags && line.startsWith('tags:')) {
              continue;
            } else if (hasCategory && line.startsWith('category:')) {
              continue;
            } else if (
              line.startsWith('updated_at:') ||
              line.startsWith('updatedAt:')
            ) {
              // KB-P1-6（2026-08-27）：跳过旧时间戳行，末尾统一写入新值
              continue;
            } else {
              frontmatterLines.push(line);
            }
          }

          if (hasTags) {
            const tagStr = tags.map((t: string) => `"${t}"`).join(', ');
            frontmatterLines.push(`tags: [${tagStr}]`);
          }
          if (hasCategory) {
            frontmatterLines.push(`category: "${category}"`);
          }
          // KB-P1-6（2026-08-27）：保存/标签更新时刷新 frontmatter 时间戳，
          // 统一 updated_at 数字格式（旧文件 updatedAt: "ISO" 一并收敛）
          frontmatterLines.push(`updated_at: ${Date.now()}`);

          const restLines = lines.slice(endIdx + 1);

          // KB-C（2026-08-27）：编辑器 content 为文件全文（含旧 frontmatter），
          // 直接写入会与下方新 frontmatter 重复；若 content 自带 frontmatter 则剥离
          let bodyContent: string;
          if (content) {
            const cLines = content.split('\n');
            if (cLines[0]?.trim() === '---') {
              const cEnd = cLines.indexOf('---', 1);
              bodyContent =
                cEnd !== -1
                  ? cLines
                      .slice(cEnd + 1)
                      .join('\n')
                      .trim()
                  : content.trim();
            } else {
              bodyContent = content.trim();
            }
          } else {
            bodyContent = restLines.join('\n').trim();
          }

          // KB-B（2026-08-27）：列表 title 来自正文首个 H1（FileDocsProvider.extractTitle），
          // 仅改 frontmatter title 列表不更新——同步替换正文 H1 保证显示名一致
          // KB-P0-4（2026-08-27）：边界修复——若正文首个非空行不是 H1（## 二级/直接段落），
          // 原逻辑不替换也不插入导致列表仍不更新；现改为在开头插入 H1
          if (title) {
            const bodyLines = bodyContent.split('\n');
            let h1Replaced = false;
            for (let i = 0; i < bodyLines.length; i++) {
              if (bodyLines[i].trim() === '') continue;
              if (bodyLines[i].trim().startsWith('# ')) {
                bodyLines[i] = `# ${title}`;
                h1Replaced = true;
              }
              break;
            }
            bodyContent = h1Replaced
              ? bodyLines.join('\n').trim()
              : `# ${title}\n\n${bodyContent}`;
          }

          const newContent = [
            '---',
            ...frontmatterLines,
            '---',
            '',
            bodyContent,
            '',
          ].join('\n');

          await writeFile(effectiveFilePath, newContent, 'utf-8');
          knowledgeDocsProvider.clearCache();
          // KB-P2-13（2026-08-27）：digest 重建改为 debounce（500ms 合并），不再每次串行全量
          scheduleDigestRebuild();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              docPath: effectiveDocPath,
              updatedAt: new Date().toISOString(),
            })
          );
          broadcastEvent('knowledge:updated', { id: effectiveDocPath });
          return;
        }
      }
    }

    const newContent = [
      '---',
      title ? `title: "${title.replace(/"/g, '\\"')}"` : 'title: "未命名文档"',
      `updatedAt: "${new Date().toISOString()}"`,
      '---',
      '',
      content,
      '',
    ].join('\n');

    await writeFile(effectiveFilePath, newContent, 'utf-8');
    knowledgeDocsProvider.clearCache();
    // KB-P2-13（2026-08-27）：digest 重建改为 debounce（500ms 合并），不再每次串行全量
    scheduleDigestRebuild();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        docPath: effectiveDocPath,
        updatedAt: new Date().toISOString(),
      })
    );
    broadcastEvent('knowledge:updated', { id: effectiveDocPath });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理批量删除知识文档请求 POST /v1/knowledge/batch-delete
 *
 * 请求体: { ids: string[] }
 * 批量删除指定的知识库文档文件
 */
export async function handleBatchDeleteKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { ids } = JSON.parse(body);

    if (!Array.isArray(ids) || ids.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'ids array is required' } }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { unlink } = await import('fs/promises');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();

    let deleted = 0;
    for (const id of ids) {
      const filePath = join(knowledgeRoot, id);
      if (existsSync(filePath)) {
        await unlink(filePath);
        deleted++;
      }
    }

    knowledgeDocsProvider.clearCache();
    // KB-P2-11（2026-08-27）：批量删除广播事件，多窗口/托盘场景同步
    for (const id of ids) {
      broadcastEvent('knowledge:deleted', { id });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ deleted }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 处理批量添加标签请求 POST /v1/knowledge/batch-tag
 *
 * 请求体: { ids: string[], tags: string[] }
 * 为多个知识文档批量添加标签
 */
export async function handleBatchTagKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { ids, tags } = JSON.parse(body);

    if (!Array.isArray(ids) || ids.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'ids array is required' } }));
      return;
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'tags array is required' } }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { readFile, writeFile } = await import('fs/promises');
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');

    const registry = getDefaultKnowledgeBaseRegistry();
    const knowledgeRoot = registry.getKnowledgeRoot();

    let updated = 0;
    for (const id of ids) {
      const filePath = join(knowledgeRoot, id);
      if (!existsSync(filePath)) continue;

      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      if (lines[0]?.trim() !== '---') continue;

      const endIdx = lines.indexOf('---', 1);
      if (endIdx === -1) continue;

      const fmLines = lines.slice(1, endIdx);

      const existingTagLine = fmLines.find((l) => l.startsWith('tags:'));
      const existingTags: string[] = [];

      if (existingTagLine) {
        const tagMatch = existingTagLine.match(/\[([^\]]*)\]/);
        if (tagMatch) {
          const rawTags = tagMatch[1]
            .split(',')
            .map((t) => t.trim().replace(/"/g, ''));
          existingTags.push(...rawTags.filter(Boolean));
        }
      }

      const mergedTags = [...new Set([...existingTags, ...tags])];
      const tagStr = mergedTags.map((t) => `"${t}"`).join(', ');

      const newFmLines = existingTagLine
        ? fmLines.map((l) => (l.startsWith('tags:') ? `tags: [${tagStr}]` : l))
        : [...fmLines, `tags: [${tagStr}]`];

      const newContent = [
        '---',
        ...newFmLines,
        '---',
        ...lines.slice(endIdx + 1),
      ].join('\n');

      await writeFile(filePath, newContent, 'utf-8');
      updated++;
    }

    knowledgeDocsProvider.clearCache();
    // KB-P2-11（2026-08-27）：批量标签更新广播事件，多窗口/托盘场景同步
    for (const id of ids) {
      broadcastEvent('knowledge:updated', { id });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ updated }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * GET /v1/knowledge/health
 * 返回知识库健康指标（基于 KnowledgeLinter）
 */
export async function handleKnowledgeHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { runKnowledgeLint } =
      await import('@modules/knowledge/KnowledgeLinter.js');
    const lintResult = await runKnowledgeLint();
    const { summary } = lintResult;

    // 计算综合 lint 分数 (0-100)
    const lintScore = Math.max(
      0,
      Math.round(
        100 - (summary.totalIssues / Math.max(1, lintResult.totalDocs)) * 100
      )
    );

    const metrics = {
      totalDocs: lintResult.totalDocs,
      totalIssues: summary.totalIssues,
      brokenLinks: summary.byCategory['broken_link'] ?? 0,
      expiredDocs: summary.byCategory['freshness'] ?? 0,
      orphanDocs: summary.byCategory['isolation'] ?? 0,
      structureErrors: summary.byCategory['structure'] ?? 0,
      consistencyWarnings: summary.byCategory['consistency'] ?? 0,
      qualityIssues: summary.byCategory['quality'] ?? 0,
      lintScore,
      lastLintAt: new Date().toISOString(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
  } catch (err) {
    sendError(res, err);
  }
}

// ========== 快照 & 恢复 ==========

export async function handleListSnapshots(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const title = url.searchParams.get('title');
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'title query param required' }));
      return;
    }

    const { KnowledgeBaseWriter } =
      await import('@modules/knowledge/KnowledgeBaseWriter.js');
    const writer = new KnowledgeBaseWriter();
    const snapshots = await writer.listSnapshots(title);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ title, snapshots }));
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRestoreSnapshot(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { title, snapshot } = JSON.parse(body);
    if (!title || !snapshot) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'title and snapshot required' }));
      return;
    }

    const { KnowledgeBaseWriter } =
      await import('@modules/knowledge/KnowledgeBaseWriter.js');
    const writer = new KnowledgeBaseWriter();
    const content = await writer.restoreSnapshot(title, snapshot);
    const restored = content !== null;
    res.writeHead(restored ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ restored, content }));
  } catch (err) {
    sendError(res, err);
  }
}

// ========== 回收站 ==========

export async function handleTrashKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { docPath } = JSON.parse(body);
    if (!docPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'docPath required' }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    const { rename, mkdir } = await import('fs/promises');
    const { join } = await import('path');

    const registry = getDefaultKnowledgeBaseRegistry();
    const root = registry.getKnowledgeRoot();
    const src = join(root, docPath);
    const trashDir = join(root, '.knowledge-trash');
    await mkdir(trashDir, { recursive: true });

    const dest = join(trashDir, docPath.replace(/[/\\]/g, '_'));
    await rename(src, dest);
    // KB-P0-1（2026-08-27）：trash 后清缓存 + 广播，与 delete/update 分支一致，
    // 否则 buildIndex 返回旧缓存，前端 REFRESH_LIST 拉到回收站中的过期数据
    knowledgeDocsProvider.clearCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ trashed: true }));
    broadcastEvent('knowledge:deleted', { id: docPath });
  } catch (err) {
    sendError(res, err);
  }
}

export async function handleRestoreTrash(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { docPath } = JSON.parse(body);
    if (!docPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'docPath required' }));
      return;
    }

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { knowledgeDocsProvider } =
      await import('@modules/docs/FileDocsProvider');
    const { rename } = await import('fs/promises');
    const { join } = await import('path');

    const registry = getDefaultKnowledgeBaseRegistry();
    const root = registry.getKnowledgeRoot();
    const src = join(root, '.knowledge-trash', docPath.replace(/[/\\]/g, '_'));
    const dest = join(root, docPath);
    await rename(src, dest);
    // KB-P0-1（2026-08-27）：restore 后清缓存 + 广播，回收站文档恢复后立即可见
    knowledgeDocsProvider.clearCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ restored: true }));
    broadcastEvent('knowledge:created', { id: docPath });
  } catch (err) {
    sendError(res, err);
  }
}

// ========== ZIP 导出 ==========

export async function handleExportKnowledge(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsedUrl = new URL(req.url || '', 'http://localhost');
    const baseFilter = parsedUrl.searchParams.get('base');

    const { getDefaultKnowledgeBaseRegistry } =
      await import('@modules/knowledge/KnowledgeBaseRegistry');
    const { readFile, readdir } = await import('fs/promises');
    const { join } = await import('path');

    const registry = getDefaultKnowledgeBaseRegistry();
    const root = registry.getKnowledgeRoot();

    // 递归收集知识库文件
    async function collectFiles(
      dir: string,
      prefix = ''
    ): Promise<{ path: string; content: string }[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const result: { path: string; content: string }[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (baseFilter && prefix === '' && entry.name !== baseFilter)
            continue;
          result.push(...(await collectFiles(fullPath, relPath)));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await readFile(fullPath, 'utf-8');
          result.push({ path: relPath, content });
        }
      }
      return result;
    }

    const files = await collectFiles(root);
    const manifest = {
      exportedAt: new Date().toISOString(),
      base: baseFilter || 'all',
      total: files.length,
      files,
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="knowledge-export-${Date.now()}.json"`,
    });
    res.end(JSON.stringify(manifest, null, 2));
  } catch (err) {
    sendError(res, err);
  }
}

// ========== Buddy Handlers ==========

// ========== 知识库配置 ==========

/** GET /v1/knowledge/config — 获取知识库配置 */
export async function handleGetKnowledgeConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { KnowledgeConfig } =
      await import('@modules/knowledge/KnowledgeConfig');
    const config = await KnowledgeConfig.load();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config.toJSON()));
  } catch (err) {
    sendError(res, err);
  }
}

/** PUT /v1/knowledge/config — 更新知识库配置 */
export async function handleUpdateKnowledgeConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const partial = JSON.parse(body);

    const { KnowledgeConfig } =
      await import('@modules/knowledge/KnowledgeConfig');
    const config = await KnowledgeConfig.load();
    const updated = config.update(partial);
    await config.save();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    sendError(res, err);
  }
}
