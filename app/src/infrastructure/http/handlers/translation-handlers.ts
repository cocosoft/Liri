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
// C1（2026-09-30 D-109，`ai` 域 P3）：改经服务层端口
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
// ⚠️ **类型位** app 类型（原文由 ai 域提供）已替换为服务层端口类型。
// 此处**故意不写完整导入路径** —— 门禁不剥离注释，写了会让「对」复活（见台账 D-77）
import type { TranslateRequestDto } from '@modules/runtime/api/aiOpsPorts';

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
    ) as TranslateRequestDto;

    if (!text || !targetLang) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'text 和 targetLang 是必填项' }));
      return;
    }

    const result = await (
      await getCoreAPI().getAiOpsPort()
    ).translateText({
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
