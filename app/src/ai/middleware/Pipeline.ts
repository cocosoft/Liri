/**
 * AI 请求中间件管道
 *
 * 提供请求前/响应后拦截能力，各中间件可组合成链：
 *   preRequest   — 请求前拦截（修改上下文、缓存命中、限流检查）
 *   postResponse — 响应后拦截（响应清洗、日志记录、缓存写入）
 *
 * 用法:
 *   const pipeline = new AIPipeline();
 *   pipeline.use(new ScrubberMiddleware());
 *   pipeline.use(new CacheMiddleware());
 *
 *   const response = await pipeline.execute(provider, messages, options);
 */

import type {
  AIProvider,
  ChatOptions,
  ThinkingProviderChunk,
} from '../providers/AIProvider';
import type { ChatMessage, ChatResponse } from '../models/types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'ai:middleware:pipeline',
  level: LogLevel.INFO,
});

export interface AIMiddlewareContext {
  readonly providerId: string;
  readonly model: string;
  messages: ChatMessage[];
  options?: Record<string, unknown>;
}

export interface AIMiddleware {
  readonly name: string;
  preRequest?(ctx: AIMiddlewareContext): Promise<AIMiddlewareContext | null>;
  postResponse?(
    ctx: AIMiddlewareContext,
    response: ChatResponse
  ): Promise<ChatResponse>;
}

function applyPreRequest(
  ctx: AIMiddlewareContext,
  middlewares: AIMiddleware[],
  index: number
): Promise<AIMiddlewareContext | null> {
  if (index >= middlewares.length) return Promise.resolve(ctx);
  const mw = middlewares[index];
  if (!mw.preRequest) return applyPreRequest(ctx, middlewares, index + 1);
  return Promise.resolve(
    mw
      .preRequest(ctx)
      .then((newCtx) => {
        if (newCtx === null) return null;
        return applyPreRequest(newCtx, middlewares, index + 1);
      })
      .catch((err) => {
        logger.error(`Middleware "${mw.name}" preRequest failed`, {
          error: String(err),
        });
        return ctx;
      })
  );
}

async function applyPostResponse(
  ctx: AIMiddlewareContext,
  response: ChatResponse,
  middlewares: AIMiddleware[],
  index: number
): Promise<ChatResponse> {
  if (index >= middlewares.length) return response;
  const mw = middlewares[index];
  if (!mw.postResponse)
    return applyPostResponse(ctx, response, middlewares, index + 1);
  try {
    const newResponse = await mw.postResponse(ctx, response);
    return applyPostResponse(ctx, newResponse, middlewares, index + 1);
  } catch (err) {
    logger.error(`Middleware "${mw.name}" postResponse failed`, {
      error: String(err),
    });
    return response;
  }
}

export class AIPipeline {
  private middlewares: AIMiddleware[] = [];

  use(middleware: AIMiddleware): void {
    if (this.middlewares.find((m) => m.name === middleware.name)) {
      logger.warning(
        `Middleware already registered, replacing: ${middleware.name}`
      );
      this.remove(middleware.name);
    }
    this.middlewares.push(middleware);
    logger.info(`Middleware registered: ${middleware.name}`);
  }

  remove(name: string): boolean {
    const idx = this.middlewares.findIndex((m) => m.name === name);
    if (idx !== -1) {
      this.middlewares.splice(idx, 1);
      logger.info(`Middleware removed: ${name}`);
      return true;
    }
    return false;
  }

  list(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  async execute(
    provider: AIProvider,
    messages: ChatMessage[],
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const ctx: AIMiddlewareContext = {
      providerId: provider.id,
      model: options?.model || 'unknown',
      messages: [...messages],
      options: options as Record<string, unknown> | undefined,
    };

    const finalCtx = await applyPreRequest(ctx, this.middlewares, 0);
    if (finalCtx === null) {
      logger.info(`Request blocked by middleware for ${provider.id}`);
      return {
        content: '',
        stop_reason: 'stop',
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    }

    const response = await provider.chat(finalCtx.messages, {
      ...options,
      messages: undefined,
    } as ChatOptions);

    return applyPostResponse(finalCtx, response, this.middlewares, 0);
  }

  async *executeStream(
    provider: AIProvider,
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse, unknown> {
    const ctx: AIMiddlewareContext = {
      providerId: provider.id,
      model: options?.model || 'unknown',
      messages: [...messages],
      options: options as Record<string, unknown> | undefined,
    };

    const finalCtx = await applyPreRequest(ctx, this.middlewares, 0);
    if (finalCtx === null) {
      logger.info(`Stream request blocked by middleware for ${provider.id}`);
      return {
        content: '',
        stop_reason: 'stop',
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    }

    const gen = provider.chatStream(finalCtx.messages, {
      ...options,
      messages: undefined,
    } as ChatOptions);

    let result = await gen.next();
    while (!result.done) {
      yield result.value;
      result = await gen.next();
    }

    const finalResponse = await applyPostResponse(
      finalCtx,
      result.value,
      this.middlewares,
      0
    );
    return finalResponse;
  }
}

let defaultPipeline: AIPipeline | null = null;

export function getDefaultPipeline(): AIPipeline {
  if (!defaultPipeline) {
    defaultPipeline = new AIPipeline();
  }
  return defaultPipeline;
}

export function setDefaultPipeline(pipeline: AIPipeline): void {
  defaultPipeline = pipeline;
}
