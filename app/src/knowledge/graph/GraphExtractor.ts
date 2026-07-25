// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GraphExtractor — LLM 驱动的知识图谱实体/关系提取
 *
 * 在文档编译完成后自动调用，通过 LLM 提取实体和关系，
 * 写入 kg_edges 表。按 modelRouter.resolve('quick') 获取对话模型。
 *
 * 降级策略：
 *   - quick 任务未配置模型 → 跳过（WARNING 日志）
 *   - LLM 调用失败 → 跳过该文档，不阻塞编译管线（ERROR 日志）
 */

import { modelRouter } from '@modules/ai';
import { LogLevel } from '@modules/monitoring';
import { OTelAwareLogger } from '@modules/monitoring/logs/OTelAwareLogger';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing';
import type { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';

const logger = new OTelAwareLogger({
  module: 'knowledge:graph:extract',
  level: LogLevel.INFO,
});

/** 提取结果 */
export interface ExtractionResult {
  entities: Array<{ id: string; type: string; description: string }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    description: string;
    strength: number;
  }>;
}

/**
 * 构建提取 Prompt
 */
function buildExtractionPrompt(content: string, domain: string): string {
  return `你是一个知识图谱构建助手。请从以下文档内容中提取关键实体和它们之间的关系。

文档领域：${domain}

规则：
1. 实体应包含唯一 ID、类型和简短描述
2. 关系应包含源实体 ID、目标实体 ID、关系类型、描述和强度(1-10)
3. 只提取明确出现的信息，不要推测

请以 JSON 格式返回：
{
  "entities": [{ "id": "实体ID", "type": "实体类型", "description": "简短描述" }],
  "edges": [{ "from": "源ID", "to": "目标ID", "type": "关系类型", "description": "关系描述", "strength": 1-10 }]
}

文档内容：
${content.slice(0, 8000)}`;
}

/**
 * 从文档自动提取实体和关系
 *
 * @param aiService AI 服务实例
 * @param knowledgeGraph 知识图谱实例
 * @param content 文档内容
 * @param domain 所属域
 */
export async function extractGraph(
  aiService: AIService,
  knowledgeGraph: KnowledgeGraph,
  content: string,
  domain: string
): Promise<ExtractionResult | null> {
  const otel = getOTelTracing();
  const span = otel.startSpan('knowledge.graph.extract', {
    'knowledge.graph.domain': domain,
  });

  try {
    // 1. 通过 ModelRouter 获取模型配置
    const modelName = modelRouter.resolve('quick');
    if (!modelName) {
      logger.warn('图谱提取跳过：未配置 quick 任务模型');
      span.setAttribute('knowledge.graph.skipped', 'not_configured');
      return null;
    }

    // 2. 构建 Prompt 并调用 LLM
    const prompt = buildExtractionPrompt(content, domain);
    const messages: AIMessage[] = [
      {
        role: AIMessageRole.SYSTEM,
        content: prompt,
        timestamp: Date.now(),
      },
      {
        role: AIMessageRole.USER,
        content: '请提取实体和关系',
        timestamp: Date.now(),
      },
    ];

    logger.info('图谱提取中', { domain, contentLength: content.length });
    const response = await aiService.generate(messages, modelName);
    const rawOutput = response.content.trim();

    // 3. 解析 JSON 结果
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('图谱提取失败：无法解析 JSON', {
        rawPreview: rawOutput.slice(0, 200),
      });
      return null;
    }

    const extracted: ExtractionResult = JSON.parse(jsonMatch[0]);

    // 4. 写入 kg_edges 表
    let edgeCount = 0;
    for (const edge of extracted.edges ?? []) {
      await knowledgeGraph.addEdge({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        direction: 'directed',
        domain,
        attributes: {
          description: edge.description,
          strength: edge.strength,
        } as Record<string, unknown>,
      });
      edgeCount++;
    }

    span.setAttribute(
      'knowledge.graph.entity_count',
      (extracted.entities ?? []).length
    );
    span.setAttribute('knowledge.graph.edge_count', edgeCount);
    logger.info('图谱提取完成', {
      domain,
      entities: (extracted.entities ?? []).length,
      edges: edgeCount,
    });

    return extracted;
  } catch (err) {
    logger.warn('图谱提取失败，跳过该文档', {
      error: (err as Error).message,
      domain,
    });
    otel.recordError(span, err as Error);
    return null;
  } finally {
    otel.endSpan(span);
  }
}

/** 兼容类形式的导出（用于构造函数注入场景） */
export class GraphExtractor {
  constructor(
    private aiService: AIService,
    private knowledgeGraph: KnowledgeGraph
  ) {}

  async extract(
    content: string,
    domain: string
  ): Promise<ExtractionResult | null> {
    return extractGraph(this.aiService, this.knowledgeGraph, content, domain);
  }
}
