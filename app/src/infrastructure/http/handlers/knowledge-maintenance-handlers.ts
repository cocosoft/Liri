/**
 * knowledge-maintenance-handlers.ts — 知识库维护类 HTTP 处理器
 *
 * 由 `knowledge-handlers.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §39）：**健康巡检 / 快照与恢复 /
 * 回收站 / ZIP 导出 / 知识库配置** 五段（原 :1956-2374）。
 *
 * ⚠️ **只搬不改**：逻辑逐字保留（含分区注释与全部 KB-* 根因修复说明）。
 * 共享工具 `assertDocPathWithin` / `publishKnowledgeChanged` 由 `knowledge-handlers`
 * 提供（**单向依赖：本模块 → 宿主，宿主不反向 import ⇒ 无循环**）。
 */

import type http from 'http';
import { sendError, readRequestBody, broadcastEvent } from './handler-utils';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  assertDocPathWithin,
  publishKnowledgeChanged,
} from './knowledge-handlers';

export async function handleKnowledgeHealth(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const lintResult = await kops.runKnowledgeLint();
    const { summary } = lintResult;

    // 计算综合 lint 分数 (0-100)
    const lintScore = Math.max(
      0,
      Math.round(
        100 - (summary.totalIssues / Math.max(1, lintResult.totalDocs)) * 100
      )
    );

    // KB-P2-12（2026-08-27）：统计面板聚合字段——来源/标签/最近更新。
    // 前端统计弹窗不再全量拉列表（store.items 双轨），改由本接口单次聚合：
    // sourceDistribution/tagDistribution 由 buildIndex（frontmatter 已解析 source/tags）派生；
    // recentItems 按文件 mtime 取最近 10 条
    const { stat } = await import('fs/promises');
    const { join } = await import('path');

    const knowledgeRoot = await kops.getDefaultKnowledgeRoot();
    const docs = await getCoreAPI().buildKnowledgeDocsIndex();
    const docMeta = await Promise.all(
      docs.map(async (doc) => {
        let updatedAt = 0;
        try {
          const fileStat = await stat(join(knowledgeRoot, doc.relativePath));
          updatedAt = fileStat.mtimeMs;
        } catch {
          // 文件可能已移动，保持默认 0
        }
        return {
          id: doc.relativePath,
          title: doc.title || '',
          source: doc.source || 'manual',
          tags: doc.tags ?? [],
          updatedAt,
        };
      })
    );

    const sourceDistribution = [...new Set(docMeta.map((d) => d.source))].map(
      (source) => ({
        source,
        count: docMeta.filter((d) => d.source === source).length,
      })
    );
    const tagCount = new Map<string, number>();
    for (const d of docMeta) {
      for (const tag of d.tags) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }
    const tagDistribution = [...tagCount.entries()].map(([tag, count]) => ({
      tag,
      count,
    }));
    const recentItems = [...docMeta]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map(({ id, title, updatedAt }) => ({
        id,
        title,
        updated_at: updatedAt,
      }));

    // D5：OCR 开关可见性（默认关；开启需含 EasyOCR 的 L2 环境）
    const ocrInfo = await kops.getKnowledgePdfOcrInfo();

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
      sourceDistribution,
      tagDistribution,
      recentItems,
      lastLintAt: new Date().toISOString(),
      // D5：扫描件 OCR 降级开关（环境变量 KNOWLEDGE_PDF_OCR，默认关）
      ocr: {
        enabled: ocrInfo.enabled,
        envVar: 'KNOWLEDGE_PDF_OCR',
        scanMinCharsPerPage: ocrInfo.scanMinCharsPerPage,
        note: 'PDF 文本层稀薄时自动降级 OCR，需含 EasyOCR 的 L2 运行环境',
      },
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

    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const snapshots = await kops.listKnowledgeSnapshots(title);
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

    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const content = await kops.restoreKnowledgeSnapshot(title, snapshot);
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

    const { rename, mkdir } = await import('fs/promises');
    const { join, relative } = await import('path');

    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const root = await kops.getDefaultKnowledgeRoot();
    // KB-DOC（2026-08-27）：docPath 来自请求体，防 ../ 逃逸根目录移入回收站
    const src = await assertDocPathWithin(root, docPath);
    const trashDir = join(root, '.knowledge-trash');
    await mkdir(trashDir, { recursive: true });

    // KB-TRASH-COLLISION（2026-08-29 导出复核）：保留相对目录层级而非拍平——
    // 原 docPath.replace(/[/\\]/g,'_') 使 a/b/c.md 与 a_b/c.md 碰撞（后者覆盖前者，
    // restore 也无法区分）。relative(root, src) 为 root 内无 .. 的相对路径，天然不碰撞。
    const dest = join(trashDir, relative(root, src));
    await rename(src, dest);
    // KB-P0-1（2026-08-27）：trash 后清缓存 + 广播，与 delete/update 分支一致，
    // 否则 buildIndex 返回旧缓存，前端 REFRESH_LIST 拉到回收站中的过期数据
    await getCoreAPI().clearKnowledgeDocsCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ trashed: true }));
    broadcastEvent('knowledge:deleted', { id: docPath });
    // KB-SEM：移入回收站 = 文档移除，驱动语义索引清理
    publishKnowledgeChanged('deleted', src);
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

    const { rename, mkdir } = await import('fs/promises');
    const { join, relative, dirname } = await import('path');
    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const root = await kops.getDefaultKnowledgeRoot();
    // KB-DOC（2026-08-27）：docPath 来自请求体，防 ../ 逃逸根目录恢复文件
    const dest = await assertDocPathWithin(root, docPath);
    // KB-TRASH-COLLISION：与 trash 对称——回收站保留相对目录层级，反查源路径
    const src = join(root, '.knowledge-trash', relative(root, dest));
    // KB-TRASH-RESTORE-DIR（2026-08-29）：目标父目录可能已被删除（如所属 base 被删），
    // 直接 rename 会 ENOENT——先重建目录层级再恢复。
    await mkdir(dirname(dest), { recursive: true });
    await rename(src, dest);
    // KB-P0-1（2026-08-27）：restore 后清缓存 + 广播，回收站文档恢复后立即可见
    await getCoreAPI().clearKnowledgeDocsCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ restored: true }));
    broadcastEvent('knowledge:created', { id: docPath });
    // KB-SEM：恢复文档 = 新增，驱动语义索引增量更新
    publishKnowledgeChanged('created', dest);
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * P2#18：列出回收站 GET /v1/knowledge/trash
 * 返回 { items: [{ docPath(原相对路径), fileName, trashedAt }] }
 */
export async function handleListKnowledgeTrash(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { readdir, stat } = await import('fs/promises');
    const { join, relative, basename } = await import('path');
    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const root = await kops.getDefaultKnowledgeRoot();
    const trashDir = join(root, '.knowledge-trash');

    const items: Array<{
      docPath: string;
      fileName: string;
      trashedAt: number;
    }> = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return; // 回收站不存在视为空
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let s;
        try {
          s = await stat(full);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          await walk(full);
        } else if (entry.endsWith('.md')) {
          items.push({
            docPath: relative(trashDir, full).split('\\').join('/'),
            fileName: basename(full),
            trashedAt: s.mtimeMs,
          });
        }
      }
    };
    await walk(trashDir);
    items.sort((a, b) => b.trashedAt - a.trashedAt);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items }));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * P2#18：永久删除回收站条目 DELETE /v1/knowledge/trash?docPath=<原相对路径>
 */
export async function handlePurgeKnowledgeTrash(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const parsedUrl = new URL(req.url || '', 'http://localhost');
    const docPath = parsedUrl.searchParams.get('docPath');
    if (!docPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'docPath required' } }));
      return;
    }
    const { unlink } = await import('fs/promises');
    const { join, resolve, sep } = await import('path');
    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const root = await kops.getDefaultKnowledgeRoot();
    const trashDir = resolve(join(root, '.knowledge-trash'));
    const target = resolve(join(trashDir, docPath));

    // 防逃逸：目标必须位于回收站目录内
    if (target !== trashDir && !target.startsWith(trashDir + sep)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '不允许访问该路径' } }));
      return;
    }
    await unlink(target);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ purged: true }));
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

    const { readFile, readdir } = await import('fs/promises');
    const { join } = await import('path');

    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const root = await kops.getDefaultKnowledgeRoot();

    // 递归收集知识库文件
    async function collectFiles(
      dir: string,
      prefix = ''
    ): Promise<{ path: string; content: string }[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const result: { path: string; content: string }[] = [];
      for (const entry of entries) {
        // KB-EXPORT（2026-08-27）：与 FileDocsProvider 扫描一致，跳过 raw/ 源目录——
        // 否则上传二进制文件生成的伴侣 md 会被打进 ZIP 导出
        if (entry.name.startsWith('.') || entry.name === 'raw') continue;
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

// ========== 知识库配置 ==========

/** GET /v1/knowledge/config — 获取知识库配置 */
export async function handleGetKnowledgeConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const config = await kops.getKnowledgeConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
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

    const kops = await getCoreAPI().getKnowledgeOpsPort();
    const updated = await kops.updateKnowledgeConfig(partial);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    sendError(res, err);
  }
}
