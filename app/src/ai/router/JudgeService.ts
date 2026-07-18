// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF SERVICE, CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * JudgeService — LLM Judge 分级服务
 *
 * 职责：对用户消息做四级分类（simple/medium/complex/reasoning）。
 * 优先级：LocalAgent 可用时委托本地 Ollama 模型，不可用时回退到云端 LLM。
 *
 * Judge 不独立管理 provider 连接——本地路径委托给 LocalAgent，
 * 云端路径复用系统已有的 ProviderRegistry。
 */

import type { AIProvider } from '../providers/AIProvider.js';
import type { JudgeResult, JudgeCloudConfig, RouterTier } from './types.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:judge' });

/** 四级分类的 prompt 模板（极简，单次生成，非流式） */
const CLASSIFY_PROMPT_TEMPLATE = `You are a query complexity classifier. Classify the user's message into one of four tiers:

- simple: Greetings, basic Q&A, time/date, simple commands (no LLM reasoning needed)
- medium: General chat, explanations, summarization, translation (standard LLM capability)
- complex: Code generation, analysis, debugging, multi-step reasoning (needs strong model)
- reasoning: Deep logical reasoning, math, architecture design, security review (needs strongest model)

Respond with ONLY a JSON object: {"tier": "simple|medium|complex|reasoning", "confidence": 0.0-1.0}

User message: {MESSAGE}`;

/**
 * JudgeService 将分级决策委托给 LocalAgent 或云端 LLM
 */
export class JudgeService {
  /**
   * @param classifyLocal - 本地分类函数（由 LocalAgent.classifyForJudge 提供），可为 null
   * @param cloudJudge - 云端 Judge 配置（仅 LocalAgent 不可用时需要）
   * @param cloudProvider - 云端 Provider 实例（用于云端分类时的 LLM 调用）
   */
  constructor(
    private classifyLocal: ((message: string) => Promise<RouterTier>) | null,
    private cloudJudge?: JudgeCloudConfig,
    private cloudProvider?: AIProvider
  ) {}

  /**
   * 四级分类主入口
   * 优先级：LocalAgent（本地模型）> 云端 LLM > 兜底（'medium'）
   */
  async classify(message: string): Promise<JudgeResult> {
    const otel = getOTelTracing();
    const span = otel.startSpan('ai.judge.classify', {
      'message.length': message.length,
      has_local: !!this.classifyLocal,
      has_cloud: !!(this.cloudJudge && this.cloudProvider),
    });

    // 优先级 1：LocalAgent 可用 → 委托本地模型
    if (this.classifyLocal) {
      try {
        const tier = await this.classifyLocal(message);
        logger.debug('JudgeService: LocalAgent 分类完成', { tier });
        otel.endSpan(span, SpanStatusCode.OK);
        return {
          tier,
          confidence: 0.8,
          reason: 'LocalAgent 本地模型分类',
          source: 'local',
        };
      } catch (error) {
        await handleError(error, { module: 'ai:judge', action: 'classify' });
        logger.warning('JudgeService: LocalAgent 分类失败，回退云端', {
          error,
        });
        // fall through to cloud
      }
    }

    // 优先级 2：云端 Judge 配置 → 调云端 LLM
    if (this.cloudJudge && this.cloudProvider) {
      try {
        const result = await this.classifyCloud(message);
        otel.endSpan(span, SpanStatusCode.OK);
        return result;
      } catch (error) {
        await handleError(error, {
          module: 'ai:judge',
          action: 'classifyCloud',
        });
        logger.warning('JudgeService: 云端分类失败，使用兜底', { error });
      }
    }

    // 兜底
    logger.debug('JudgeService: 无可用 Judge，使用兜底 tier=medium');
    otel.endSpan(span, SpanStatusCode.OK);
    return {
      tier: 'medium',
      confidence: 0.5,
      reason: '无可用 Judge 配置，兜底 medium',
      source: 'default',
    };
  }

  /**
   * 通过云端 LLM 分类
   */
  private async classifyCloud(message: string): Promise<JudgeResult> {
    const prompt = CLASSIFY_PROMPT_TEMPLATE.replace('{MESSAGE}', message);

    const response = await this.cloudProvider!.chat([
      { role: 'user', content: prompt },
    ]);

    const parsed = this.parseResponse(response.content);
    logger.debug('JudgeService: 云端分类结果', {
      tier: parsed.tier,
      confidence: parsed.confidence,
    });

    return {
      ...parsed,
      source: 'cloud',
    };
  }

  /**
   * 解析 LLM 返回的 JSON
   */
  private parseResponse(content: string): {
    tier: RouterTier;
    confidence: number;
    reason: string;
  } {
    try {
      // 尝试从 JSON 块中提取
      const jsonMatch = content.match(/\{[\s\S]*"tier"[\s\S]*\}/);
      const json = jsonMatch ? jsonMatch[0] : content;
      const parsed = JSON.parse(json);

      const tier = this.normalizeTier(parsed.tier);
      return {
        tier,
        confidence:
          typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
        reason: `LLM Judge 分类: ${tier}`,
      };
    } catch (err) {
      // JSON 解析失败：按关键词启发式兜底
      return {
        tier: this.heuristicClassify(content),
        confidence: 0.5,
        reason: 'Judge 响应解析失败，使用启发式兜底',
      };
    }
  }

  /**
   * 归一化 tier 值
   */
  private normalizeTier(tier: string): RouterTier {
    const normalized = tier?.toLowerCase().trim() || '';
    if (['simple', 'medium', 'complex', 'reasoning'].includes(normalized)) {
      return normalized as RouterTier;
    }
    return 'medium';
  }

  /**
   * 启发式分类（JSOn 解析失败的极端情况）
   */
  private heuristicClassify(content: string): RouterTier {
    const lower = content.toLowerCase();
    if (lower.includes('simple')) return 'simple';
    if (lower.includes('reasoning') || lower.includes('complex'))
      return 'reasoning';
    if (lower.includes('complex')) return 'complex';
    return 'medium';
  }
}
