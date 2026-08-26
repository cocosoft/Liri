/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * translation-routes.ts — dispatchTranslationRoutes
 * 翻译领域路由分发（2026-08-26 新增）
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { handleTranslate } from '../translation-handlers';

/**
 * dispatchTranslationRoutes — 翻译路由分发
 * @returns true 表示已匹配并处理，false 表示未匹配
 */
export async function dispatchTranslationRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';

  // POST /v1/translate — 非流式翻译
  if (method === 'POST' && url === '/v1/translate') {
    await handleTranslate(handlerCtx, req, res);
    return true;
  }

  return false;
}
