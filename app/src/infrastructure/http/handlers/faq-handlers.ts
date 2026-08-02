/**
 * faq-handlers.ts — FAQ 知识类型 HTTP 处理器
 *
 * 端点：
 *   GET    /v1/knowledge/:base/faq          — 列出 FAQ 条目
 *   POST   /v1/knowledge/:base/faq          — 创建 FAQ 条目
 *   PUT    /v1/knowledge/:base/faq/:id      — 更新 FAQ 条目
 *   DELETE /v1/knowledge/:base/faq/:id      — 删除 FAQ 条目
 *   POST   /v1/knowledge/:base/faq/batch-delete — 批量删除
 *   POST   /v1/knowledge/:base/faq/import   — 批量导入（CSV/JSON）
 *   GET    /v1/knowledge/:base/faq/search   — 搜索 FAQ
 *   GET    /v1/knowledge/:base/faq/categories — 获取分类列表
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { handleError } from '@modules/error';

/** 从 URL 路径中提取知识库名称 */
function extractBaseName(url: string): string | null {
  const match = url.match(/\/v1\/knowledge\/([^/]+)\/faq/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** 从 URL 路径中提取 FAQ ID */
function extractFaqId(url: string): string | null {
  const match = url.match(/\/v1\/knowledge\/[^/]+\/faq\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** 发送 JSON 响应 */
function sendJson(
  res: http.ServerResponse,
  status: number,
  data: unknown
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---- 列出 FAQ 条目 ----
export async function handleListFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const base = extractBaseName(req.url ?? '');
    if (!base) {
      sendError(res, 'Missing knowledge base name', 400);
      return;
    }

    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const category = url.searchParams.get('category') ?? undefined;
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') ?? '50', 10),
      200
    );

    const service = getFAQService();
    const entries = await service.list({
      knowledgeBaseName: base,
      category,
      offset,
      limit,
    });
    const total = await service.count(base);

    sendJson(res, 200, { entries, total, offset, limit });
  } catch (err) {
    await handleError(err, { module: 'infra:handler:faq', action: 'list' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 创建 FAQ 条目 ----
export async function handleCreateFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const base = extractBaseName(req.url ?? '');
    if (!base) {
      sendError(res, 'Missing knowledge base name', 400);
      return;
    }

    const body = await readRequestBody(req);
    const params = JSON.parse(body);

    if (!params.question || !params.answer) {
      sendError(res, 'question and answer are required', 400);
      return;
    }

    const service = getFAQService();
    const entry = await service.create({
      knowledgeBaseName: base,
      question: params.question,
      answer: params.answer,
      similarQuestions: params.similarQuestions,
      tags: params.tags,
      category: params.category,
      recommended: params.recommended,
    });

    sendJson(res, 201, entry);
  } catch (err) {
    if ((err as Record<string, unknown>)?.code === 'KNOWLEDGE_FAQ_DUPLICATE') {
      sendError(res, 'FAQ 条目重复', 409);
      return;
    }
    await handleError(err, { module: 'infra:handler:faq', action: 'create' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 更新 FAQ 条目 ----
export async function handleUpdateFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const id = extractFaqId(req.url ?? '');
    if (!id) {
      sendError(res, 'Missing FAQ id', 400);
      return;
    }

    const body = await readRequestBody(req);
    const params = JSON.parse(body);

    const service = getFAQService();
    const entry = await service.update(id, params);

    if (!entry) {
      sendError(res, 'FAQ entry not found', 404);
      return;
    }

    sendJson(res, 200, entry);
  } catch (err) {
    await handleError(err, { module: 'infra:handler:faq', action: 'update' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 删除 FAQ 条目 ----
export async function handleDeleteFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const id = extractFaqId(req.url ?? '');
    if (!id) {
      sendError(res, 'Missing FAQ id', 400);
      return;
    }

    const service = getFAQService();
    await service.delete(id);

    sendJson(res, 200, { deleted: true });
  } catch (err) {
    await handleError(err, { module: 'infra:handler:faq', action: 'delete' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 批量删除 FAQ ----
export async function handleBatchDeleteFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const body = await readRequestBody(req);
    const { ids } = JSON.parse(body);

    if (!Array.isArray(ids) || ids.length === 0) {
      sendError(res, 'ids array is required', 400);
      return;
    }

    const service = getFAQService();
    const count = await service.deleteBatch(ids);

    sendJson(res, 200, { deleted: count });
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:faq',
      action: 'batch_delete',
    });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 批量导入 FAQ ----
export async function handleImportFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const base = extractBaseName(req.url ?? '');
    if (!base) {
      sendError(res, 'Missing knowledge base name', 400);
      return;
    }

    const body = await readRequestBody(req);
    const { items } = JSON.parse(body);

    if (!Array.isArray(items) || items.length === 0) {
      sendError(res, 'items array is required', 400);
      return;
    }

    const service = getFAQService();
    const report = await service.importBatch(base, items);

    sendJson(res, 200, report);
  } catch (err) {
    await handleError(err, { module: 'infra:handler:faq', action: 'import' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 搜索 FAQ ----
export async function handleSearchFAQ(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const base = extractBaseName(req.url ?? '');
    if (!base) {
      sendError(res, 'Missing knowledge base name', 400);
      return;
    }

    const url = new URL(req.url!, `http://${req.headers.host ?? 'localhost'}`);
    const query = url.searchParams.get('q');
    if (!query) {
      sendError(res, 'Missing query parameter q', 400);
      return;
    }

    const category = url.searchParams.get('category') ?? undefined;
    const topK = parseInt(url.searchParams.get('topK') ?? '10', 10);

    const service = getFAQService();
    const entries = await service.search({
      query,
      knowledgeBaseName: base,
      category,
      topK,
    });

    sendJson(res, 200, { entries, query });
  } catch (err) {
    await handleError(err, { module: 'infra:handler:faq', action: 'search' });
    sendError(res, (err as Error).message, 500);
  }
}

// ---- 获取分类列表 ----
export async function handleFAQCategories(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const { getFAQService } = await import('@modules/knowledge/faq/FAQService');
    const base = extractBaseName(req.url ?? '');
    if (!base) {
      sendError(res, 'Missing knowledge base name', 400);
      return;
    }

    const service = getFAQService();
    const categories = await service.getCategories(base);

    sendJson(res, 200, { categories });
  } catch (err) {
    await handleError(err, {
      module: 'infra:handler:faq',
      action: 'categories',
    });
    sendError(res, (err as Error).message, 500);
  }
}
