/**
 * MIT License
 * Copyright (c) 2026 Liri
 *
 * 翻译服务 — 核心编排层
 *
 * 管线：LanguageDetector → PromptBuilder → Provider.chat() → PostProcessor → TranslateHistoryStore
 * 增强：术语表注入（GlossaryManager）+ Few-shot 示例（历史记录采样）
 */

import { randomUUID } from 'crypto';
import { Logger, LogLevel } from '../../monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '../../error/types';
import { handleError } from '../../error/handleError';
import { modelRouter } from '../modelRouter';
import { providerRegistry } from '../providers/ProviderRegistry';
import { LanguageDetector } from './LanguageDetector';
import { PromptBuilder } from './PromptBuilder';
import { PostProcessor } from './PostProcessor';
import { TranslateHistoryStore } from './TranslateHistoryStore';
import { GlossaryManager } from './GlossaryManager';
import type {
  TranslateRequest,
  TranslateResult,
  TranslateStreamChunk,
  TranslateHistoryRecord,
  LanguageDetectionResult,
  AlternativesRequest,
  AlternativesResult,
} from './types';
import type { ChatMessage, ChatResponse } from '../models/types';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:translation' });

export class TranslationService {
  private languageDetector: LanguageDetector;
  private promptBuilder: PromptBuilder;
  private postProcessor: PostProcessor;
  private historyStore: TranslateHistoryStore;

  constructor() {
    this.languageDetector = new LanguageDetector();
    this.promptBuilder = new PromptBuilder();
    this.postProcessor = new PostProcessor();
    this.historyStore = TranslateHistoryStore.getInstance();
  }

  /**
   * 初始化历史存储
   */
  async initialize(): Promise<void> {
    await this.historyStore.initialize();
  }

  /**
   * 执行翻译（非流式）
   *
   * 管线步骤：
   * 1. LanguageDetector.resolveSourceLang() — 解析源语言
   * 2. modelRouter.resolve('translation') — 获取翻译任务模型
   * 3. providerRegistry.getByModel(model) — 获取 Provider
   * 4. PromptBuilder — 构建 system + user 消息
   * 5. provider.chat() — 调用 LLM（temperature 0.3，maxTokens 自适应）
   * 6. PostProcessor.process() — 清理输出
   * 7. TranslateHistoryStore.insert() — 持久化记录
   */
  async translate(request: TranslateRequest): Promise<TranslateResult> {
    const startedAt = Date.now();

    // Step 1: 解析源语言
    const langResult: LanguageDetectionResult =
      this.languageDetector.resolveSourceLang(request.text, request.sourceLang);

    // Step 2: 获取模型
    const modelName = request.model || modelRouter.resolve('translation');
    if (!modelName) {
      throw new AppError(
        '未配置翻译模型，请在"模型管理 → 任务分工"中设置翻译模型',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_MODEL'
      );
    }

    // Step 3: 获取 Provider
    const provider = providerRegistry.getByModel(modelName);
    if (!provider) {
      throw new AppError(
        `翻译模型 ${modelName} 对应的 Provider 未找到`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_PROVIDER'
      );
    }

    // Step 4: 构建消息（含术语表 + Few-shot）
    const glossaryManager = GlossaryManager.getInstance();
    await glossaryManager.initialize();

    const glossaryPrompt = glossaryManager.buildGlossaryPrompt(
      langResult.detectedLanguage,
      request.targetLang
    );

    const fewShotHistory = await this.historyStore
      .query({
        page: 1,
        pageSize: 5,
        sourceLang: langResult.detectedLanguage,
        targetLang: request.targetLang,
      })
      .then((r) => r.records)
      .catch(() => [] as TranslateHistoryRecord[]);

    const messages: ChatMessage[] = this.promptBuilder.buildMessages(
      langResult.detectedLanguage,
      request.targetLang,
      request.text,
      {
        glossaryPrompt: glossaryPrompt || undefined,
        fewShotHistory,
        maxFewShot: 3,
      }
    ) as ChatMessage[];

    // Step 5: 调用 LLM
    let rawOutput: string;
    let usage: TranslateResult['usage'];

    try {
      const response = await provider.chat(messages, {
        model: modelName,
        temperature: 0.3,
        maxTokens: Math.max(request.text.length * 2, 256),
      });

      rawOutput = response.content || '';

      if (response.usage) {
        usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:translation',
        action: 'provider.chat',
      });
      throw new AppError(
        `翻译模型调用失败: ${(err as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_PROVIDER_ERROR'
      );
    }

    // Step 6: 后处理
    const postResult = this.postProcessor.process(rawOutput, request.text);

    if (postResult.isNonTranslation) {
      throw new AppError(
        '模型未能完成翻译，请重试或更换模型',
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        'TRANSLATION_REFUSED'
      );
    }

    const durationMs = Date.now() - startedAt;

    // Step 7: 持久化
    const groupId = randomUUID();
    const id = await this.historyStore.insert({
      groupId,
      sourceText: request.text,
      translatedText: postResult.cleaned,
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      usageJson: usage ? JSON.stringify(usage) : null,
    });

    logger.info('翻译完成', {
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      autoDetected: langResult.autoDetected,
      strategies: postResult.appliedStrategies,
    });

    return {
      id,
      sourceText: request.text,
      translatedText: postResult.cleaned,
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      confidence: langResult.autoDetected ? langResult.confidence : undefined,
      usage,
      createdAt: Math.floor(Date.now() / 1000),
    };
  }

  /**
   * 执行流式翻译
   *
   * 复用 translate() 的 Step 1-4（语言检测、模型路由、Provider 获取、Prompt 构建），
   * Step 5 改用 provider.chatStream() 逐 token 产出。
   * 每个 token 立即 yield，流结束后进行后处理 + 持久化 + yield done。
   */
  async *translateStream(
    request: TranslateRequest
  ): AsyncGenerator<TranslateStreamChunk, TranslateResult> {
    const startedAt = Date.now();

    // Step 1: 解析源语言
    const langResult: LanguageDetectionResult =
      this.languageDetector.resolveSourceLang(request.text, request.sourceLang);

    // Step 2: 获取模型
    const modelName = request.model || modelRouter.resolve('translation');
    if (!modelName) {
      yield {
        type: 'error',
        message: '未配置翻译模型，请在"模型管理 → 任务分工"中设置翻译模型',
      };
      throw new AppError(
        '未配置翻译模型，请在"模型管理 → 任务分工"中设置翻译模型',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_MODEL'
      );
    }

    // Step 3: 获取 Provider
    const provider = providerRegistry.getByModel(modelName);
    if (!provider) {
      yield {
        type: 'error',
        message: `翻译模型 ${modelName} 对应的 Provider 未找到`,
      };
      throw new AppError(
        `翻译模型 ${modelName} 对应的 Provider 未找到`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_PROVIDER'
      );
    }

    // Step 4: 构建消息（含术语表 + Few-shot）
    const glossaryManager = GlossaryManager.getInstance();
    await glossaryManager.initialize();

    const glossaryPrompt = glossaryManager.buildGlossaryPrompt(
      langResult.detectedLanguage,
      request.targetLang
    );

    const fewShotHistory = await this.historyStore
      .query({
        page: 1,
        pageSize: 5,
        sourceLang: langResult.detectedLanguage,
        targetLang: request.targetLang,
      })
      .then((r) => r.records)
      .catch(() => [] as TranslateHistoryRecord[]);

    const messages: ChatMessage[] = this.promptBuilder.buildMessages(
      langResult.detectedLanguage,
      request.targetLang,
      request.text,
      {
        glossaryPrompt: glossaryPrompt || undefined,
        fewShotHistory,
        maxFewShot: 3,
      }
    ) as ChatMessage[];

    // Step 5: 流式调用 LLM
    let rawOutput = '';
    let usage: TranslateResult['usage'];

    try {
      const stream = provider.chatStream(messages, {
        model: modelName,
        temperature: 0.3,
        maxTokens: Math.max(request.text.length * 2, 256),
      });

      let chatResponse: ChatResponse | undefined;
      for await (const chunk of stream) {
        if (typeof chunk === 'string') {
          rawOutput += chunk;
          yield { type: 'token', token: chunk };
        } else {
          // 非字符串 chunk（如思考过程），翻译场景忽略
          chatResponse = chunk as unknown as ChatResponse;
        }
      }

      // 从 stream 返回值获取 usage
      if (chatResponse) {
        if (chatResponse.usage) {
          usage = {
            promptTokens: chatResponse.usage.prompt_tokens,
            completionTokens: chatResponse.usage.completion_tokens,
            totalTokens: chatResponse.usage.total_tokens,
          };
        }
      }
    } catch (err) {
      await handleError(err, {
        module: 'ai:translation',
        action: 'provider.chatStream',
      });
      yield {
        type: 'error',
        message: `翻译模型调用失败: ${(err as Error).message}`,
      };
      throw new AppError(
        `翻译模型调用失败: ${(err as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_PROVIDER_ERROR'
      );
    }

    // Step 6: 后处理
    const postResult = this.postProcessor.process(rawOutput, request.text);

    if (postResult.isNonTranslation) {
      yield { type: 'error', message: '模型未能完成翻译，请重试或更换模型' };
      throw new AppError(
        '模型未能完成翻译，请重试或更换模型',
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        'TRANSLATION_REFUSED'
      );
    }

    const durationMs = Date.now() - startedAt;

    // Step 7: 持久化
    const groupId = randomUUID();
    const id = await this.historyStore.insert({
      groupId,
      sourceText: request.text,
      translatedText: postResult.cleaned,
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      usageJson: usage ? JSON.stringify(usage) : null,
    });

    logger.info('流式翻译完成', {
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      autoDetected: langResult.autoDetected,
      strategies: postResult.appliedStrategies,
    });

    const result: TranslateResult = {
      id,
      sourceText: request.text,
      translatedText: postResult.cleaned,
      sourceLang: langResult.detectedLanguage,
      targetLang: request.targetLang,
      model: modelName,
      durationMs,
      confidence: langResult.autoDetected ? langResult.confidence : undefined,
      usage,
      createdAt: Math.floor(Date.now() / 1000),
    };

    yield { type: 'done', result };

    return result;
  }

  /**
   * 获取备选翻译
   *
   * 对单个词汇调用 LLM 返回多个候选翻译及词性标注。
   * 使用低 temperature 确保翻译质量，超时 5 秒防止阻塞。
   */
  async getAlternatives(
    request: AlternativesRequest
  ): Promise<AlternativesResult> {
    const modelName = modelRouter.resolve('translation');
    if (!modelName) {
      throw new AppError(
        '未配置翻译模型',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_MODEL'
      );
    }

    const provider = providerRegistry.getByModel(modelName);
    if (!provider) {
      throw new AppError(
        `翻译模型 ${modelName} 对应的 Provider 未找到`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'TRANSLATION_NO_PROVIDER'
      );
    }

    const contextHint = request.context ? `Context: "${request.context}"` : '';

    const systemPrompt = [
      `You are a professional translator. For the given word, provide 5 alternative translations in ${request.targetLang}.`,
      contextHint,
      'Return ONLY a JSON array of objects: [{"translation": "...", "pos": "noun/verb/adj/adv", "score": 0.0-1.0}]',
      'Score indicates how well the translation fits the context (1.0 = best).',
      'Sort by score descending. Do not include the original word.',
    ]
      .filter(Boolean)
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Word: "${request.word}"\nSource language: ${request.sourceLang}`,
      },
    ];

    try {
      const response = await provider.chat(messages, {
        model: modelName,
        temperature: 0.1,
        maxTokens: 512,
      });

      const rawOutput = (response.content || '').trim();

      // 尝试提取 JSON 数组
      const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warning('备选翻译响应格式异常', {
          rawOutput: rawOutput.slice(0, 200),
        });
        return { alternatives: [] };
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        translation: string;
        pos?: string;
        score: number;
      }>;

      const alternatives = parsed
        .filter((a) => a.translation && typeof a.translation === 'string')
        .map((a) => ({
          translation: a.translation,
          pos: a.pos,
          score: typeof a.score === 'number' ? a.score : 0.5,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      return { alternatives };
    } catch (err) {
      await handleError(err, {
        module: 'ai:translation',
        action: 'getAlternatives',
      });
      return { alternatives: [] };
    }
  }
}

/** 全局单例 */
export const translationService = new TranslationService();
