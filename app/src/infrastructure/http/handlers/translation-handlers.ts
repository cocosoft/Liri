/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译 HTTP Handler（2026-08-26 新增）
 *
 * 端点：
 *   POST /v1/translate — 非流式翻译（前端 translateService.translate）
 *
 * 此前 TranslationService 仅供模型管理内部使用，前端高频区"翻译"调用
 * /v1/translate 404 → 本次补齐 HTTP 层，打通翻译模块与会话系统/前端。
 */

import type http from 'http';
import type { HandlerCtx } from './handler-utils';
import { translationService } from '@modules/ai';
import type { TranslateRequest } from '@modules/ai';

/**
 * POST /v1/translate
 * Body: { text, sourceLang?, targetLang, model? }
 * → 200 { data: TranslateResult }
 */
export async function handleTranslate(
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await ctx.readRequestBody(req);
    const { text, sourceLang, targetLang, model } = JSON.parse(
      body
    ) as Partial<TranslateRequest>;

    if (!text || !targetLang) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'text 和 targetLang 是必填项' }));
      return;
    }

    const result = await translationService.translate({
      text,
      sourceLang: (sourceLang as string) || 'auto',
      targetLang,
      model: model || undefined,
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ data: result }));
  } catch (err) {
    ctx.sendError(res, err);
  }
}
