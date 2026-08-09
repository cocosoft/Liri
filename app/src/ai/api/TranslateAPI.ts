// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * Translate 子域 REST API 处理器
 *
 * 路由前缀: /v1/translate
 */

import type http from 'http';
import { handleError, AppError } from '@modules/error';
import { parseBody, sendJson, sendError } from './utils.js';

export async function handleTranslateAlternatives(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      word?: string;
      sourceLang?: string;
      targetLang?: string;
      context?: string;
    };

    if (!body.word || typeof body.word !== 'string' || !body.word.trim()) {
      sendError(res, 'word 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    const { translationService } =
      await import('../translation/TranslationService.js');
    await translationService.initialize();

    const result = await translationService.getAlternatives({
      word: body.word.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      context: body.context,
    });

    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'alternatives',
    });
    const message =
      err instanceof AppError
        ? (err as AppError).message
        : `备选翻译查询失败: ${(err as Error).message}`;
    sendError(res, message, 500);
  }
}

/**
 * POST /v1/translate — 翻译文本（非流式）
 */
export async function handleTranslate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
      model?: string;
    };

    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      sendError(res, 'text 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    const { translationService } =
      await import('../translation/TranslationService.js');
    await translationService.initialize();

    const result = await translationService.translate({
      text: body.text.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      model: body.model,
    });

    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'translate',
    });
    const message =
      err instanceof AppError
        ? (err as AppError).message
        : `翻译失败: ${(err as Error).message}`;
    sendError(res, message, 500);
  }
}

/**
 * GET /v1/translate/history — 查询翻译历史（分页）
 */
export async function handleTranslateHistory(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const sourceLang = url.searchParams.get('sourceLang') || undefined;
    const targetLang = url.searchParams.get('targetLang') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const starred = url.searchParams.has('starred')
      ? url.searchParams.get('starred') === 'true'
      : undefined;

    const { TranslateHistoryStore } =
      await import('../translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const result = await store.query({
      page,
      pageSize,
      sourceLang,
      targetLang,
      search,
      starred,
    });
    sendJson(res, { data: result });
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'history',
    });
    sendError(res, `获取翻译历史失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/history/:id/star — 切换收藏状态
 */
export async function handleTranslateStar(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
): Promise<void> {
  try {
    const id = match?.[1];
    if (!id) {
      sendError(res, 'id 不能为空', 400);
      return;
    }

    const { TranslateHistoryStore } =
      await import('../translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const starred = await store.toggleStar(id);
    sendJson(res, { data: { starred } });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'star' });
    sendError(res, `切换收藏失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/history/delete — 批量删除翻译历史
 */
export async function handleTranslateDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as { ids?: string[] };
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      sendError(res, 'ids 不能为空', 400);
      return;
    }

    const { TranslateHistoryStore } =
      await import('../translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const deleted = await store.deleteByIds(body.ids);
    sendJson(res, { data: { deleted } });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'delete' });
    sendError(res, `批量删除失败: ${(err as Error).message}`, 500);
  }
}

/**
 * GET /v1/translate/history/export — 导出翻译历史为 JSON
 */
export async function handleTranslateExport(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const sourceLang = url.searchParams.get('sourceLang') || undefined;
    const targetLang = url.searchParams.get('targetLang') || undefined;

    const { TranslateHistoryStore } =
      await import('../translation/TranslateHistoryStore.js');
    const store = TranslateHistoryStore.getInstance();
    await store.initialize();

    const result = await store.query({
      page: 1,
      pageSize: 500,
      sourceLang,
      targetLang,
    });
    sendJson(res, { data: result.records });
  } catch (err) {
    await handleError(err, { module: 'ai:translation', action: 'export' });
    sendError(res, `导出失败: ${(err as Error).message}`, 500);
  }
}

/**
 * POST /v1/translate/stream — 流式翻译（SSE）
 */
export async function handleTranslateStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _match: RegExpMatchArray | null
): Promise<void> {
  try {
    const body = (await parseBody(req)) as {
      text?: string;
      sourceLang?: string;
      targetLang?: string;
      model?: string;
    };

    if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
      sendError(res, 'text 不能为空', 400);
      return;
    }
    if (!body.targetLang || typeof body.targetLang !== 'string') {
      sendError(res, 'targetLang 不能为空', 400);
      return;
    }

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const { translationService } =
      await import('../translation/TranslationService.js');
    await translationService.initialize();

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    const stream = translationService.translateStream({
      text: body.text.trim(),
      sourceLang: body.sourceLang || 'auto',
      targetLang: body.targetLang,
      model: body.model,
    });

    for await (const chunk of stream) {
      if (aborted) break;
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.end();
  } catch (err) {
    await handleError(err, {
      module: 'ai:translation',
      action: 'stream',
    });
    // 如果响应头还没发送，发送错误
    if (!res.headersSent) {
      const message =
        err instanceof AppError
          ? (err as AppError).message
          : `流式翻译失败: ${(err as Error).message}`;
      sendError(res, message, 500);
    } else {
      res.end();
    }
  }
}
