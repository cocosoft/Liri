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
import { KnowledgeGraph } from '@modules/knowledge/graph/KnowledgeGraph';
import {
  evaluateEndpointMatch,
  type EndpointKindLookup,
} from './endpointMatch';
import type { SchemaContainer } from '@modules/knowledge/schema/SchemaLoader';
import type { AIService, AIMessage } from '@modules/ai';
import { AIMessageRole } from '@modules/ai';
// 内存画像（2026-09-02 排查"会话中断/内存尖峰"用，MEM_PROFILE=1 才采样）
import { memProfile } from '../../monitoring/memProfile.js';

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
 * 图谱 schema 约束（K2 本体驱动，opt-in）
 * 仅当调用方显式传入 schema（用户放置 entities.yaml/edges.yaml）时启用白名单；
 * 未传 schema 时保持自由提取，既有 2196 条自由边不受影响。
 */
type GraphSchema = {
  entities: SchemaContainer['entities'];
  edges: SchemaContainer['edges'];
};

/** 构建 schema 白名单描述文本 */
function buildSchemaConstraint(
  schema: GraphSchema | undefined,
  domain: string
): string {
  if (!schema) return '';

  const lines: string[] = [];
  lines.push(`文档领域：${domain}`);
  if (schema.entities.size > 0) {
    const kinds = Array.from(schema.entities.values())
      .map((e) => `  - ${e.kind}（${e.displayName}）：${e.description}`)
      .join('\n');
    lines.push('允许的实体类型（只能输出这些 type）：\n' + kinds);
  }
  if (schema.edges.size > 0) {
    const types = Array.from(schema.edges.values())
      .map(
        (e) =>
          `  - ${e.type}（${e.displayName}）：${e.endpoints.from} → ${e.endpoints.to}`
      )
      .join('\n');
    lines.push(
      '允许的关系类型（只能输出这些 type，并遵守端点约束）：\n' + types
    );
  }
  if (schema.entities.size > 0 || schema.edges.size > 0) {
    lines.push(
      `实体 ID 请使用**短横线 slug**（仅小写字母/数字/短横线，如 ontology、knowledge-graph）；` +
        `实体类型写在 type 字段里，**不要**拼进 ID`
    );
  }
  return lines.join('\n\n');
}

/**
 * 构建提取 Prompt
 */
function buildExtractionPrompt(
  content: string,
  domain: string,
  schema?: GraphSchema
): string {
  return `你是一个知识图谱构建助手。请从以下文档内容中提取关键实体和它们之间的关系。

${buildSchemaConstraint(schema, domain)}

规则：
1. 实体应包含唯一 ID、类型和简短描述
2. 关系应包含源实体 ID、目标实体 ID、关系类型、描述和强度(1-10)
3. 只提取明确出现的信息，不要推测
4. 存在 schema 约束时，实体 type 与关系 type 必须属于白名单，否则跳过该条

请以 JSON 格式返回：
{
  "entities": [{ "id": "实体ID", "type": "实体类型", "description": "简短描述" }],
  "edges": [{ "from": "源ID", "to": "目标ID", "type": "关系类型", "description": "关系描述", "strength": 1-10 }]
}

文档内容：
${content.slice(0, 8000)}`;
}

/**
 * schema 白名单后置过滤（K2，opt-in）
 * - 实体 type 不在白名单 → 丢弃并计数
 * - 关系 type 不在白名单 → 丢弃并计数
 * - 关系端点 kind 与 schema.endpoints 不符 → 丢弃并计数
 *
 * O15-B（2026-09-11）：实体 ID 统一为裸 slug，kind 不再从 ID 解析 —— 改为**注入**
 * 本次提取结果里 `entities[].type`（实体 ID → 类型）作为端点 kind 来源；端点未出现
 * 在 entities 中（kind 未知）→ 视为匹配、不丢弃（防误报）。
 */
function applySchemaFilter(
  extracted: ExtractionResult,
  schema: GraphSchema | undefined
): { result: ExtractionResult; droppedEntities: number; droppedEdges: number } {
  if (!schema)
    return { result: extracted, droppedEntities: 0, droppedEdges: 0 };

  const knownKinds =
    schema.entities.size > 0 ? new Set(schema.entities.keys()) : null;
  const knownEdgeTypes =
    schema.edges.size > 0 ? new Set(schema.edges.keys()) : null;

  let droppedEntities = 0;
  let droppedEdges = 0;

  // O15-B：端点 kind 由本次提取的实体类型提供（ID → type），端点未列出时视为未知
  const extractedKinds = new Map(extracted.entities.map((e) => [e.id, e.type]));
  const kindOf: EndpointKindLookup = (nodeId) =>
    extractedKinds.get(nodeId) || undefined;

  const entities = knownKinds
    ? extracted.entities.filter((e) => {
        if (knownKinds.has(e.type)) return true;
        droppedEntities++;
        return false;
      })
    : extracted.entities;

  // 注意：此处不能用 `knownEdgeTypes ? extracted.edges : []` —— 那会在 edges.yaml
  // 缺失/为空（knownEdgeTypes=null）时对空数组 filter，恒得 [] 且 droppedEdges 保持 0，
  // 造成"只写了 entities.yaml"的用户所有关系边被静默清空（无任何日志痕迹）。
  // 保留下方 `if (!knownEdgeTypes) return true` 作为唯一判定。
  const edges = extracted.edges.filter((edge) => {
    if (!knownEdgeTypes) return true;
    if (!knownEdgeTypes.has(edge.type)) {
      droppedEdges++;
      return false;
    }
    // D7-1：端点判定收敛到纯函数（与写入侧共用同一判定，处置动作各自保留）
    if (!evaluateEndpointMatch(edge, schema.edges, kindOf).matched) {
      droppedEdges++;
      return false;
    }
    return true;
  });

  return {
    result: { entities, edges },
    droppedEntities,
    droppedEdges,
  };
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
  domain: string,
  schema?: GraphSchema
): Promise<ExtractionResult | null> {
  const otel = getOTelTracing();
  const span = otel.startSpan('knowledge.graph.extract', {
    'knowledge.graph.domain': domain,
    'knowledge.graph.schema': schema ? 'constrained' : 'freeform',
  });

  try {
    // 1. 通过 ModelRouter 获取模型配置
    const modelName = modelRouter.resolve('quick');
    if (!modelName) {
      logger.warn('图谱提取跳过：未配置 quick 任务模型');
      span.setAttribute('knowledge.graph.skipped', 'not_configured');
      return null;
    }

    // 2. 构建 Prompt 并调用 LLM（schema 白名单在 prompt 内联）
    const prompt = buildExtractionPrompt(content, domain, schema);
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

    // 内存画像（MEM_PROFILE=1）：LLM 提取前采样（图谱后台任务与用户 agentic
    // 任务并发是 RSS 尖峰候选之一）
    memProfile('graph-extract:llm', { domain, contentLength: content.length });

    // 3. 调用 LLM 并解析 JSON（长文档输出易被 max_tokens 截断导致解析失败，
    //    失败时翻倍 max_tokens 重试一次，提高提取成功率）
    let extracted: ExtractionResult | null = null;
    let maxTokens = 8192;
    for (let attempt = 1; attempt <= 2 && !extracted; attempt++) {
      const response = await aiService.generate(messages, modelName, {
        max_tokens: maxTokens,
      });
      const rawOutput = response.content.trim();
      const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (attempt < 2) {
          maxTokens *= 2;
          logger.warn('图谱提取 JSON 不完整，翻倍 max_tokens 重试', {
            attempt,
            maxTokens,
          });
          continue;
        }
        logger.warn('图谱提取失败：无法解析 JSON', {
          rawPreview: rawOutput.slice(0, 200),
        });
        return null;
      }
      try {
        extracted = JSON.parse(jsonMatch[0]) as ExtractionResult;
      } catch (err) {
        if (attempt < 2) {
          maxTokens *= 2;
          logger.warn('图谱提取 JSON 解析失败，翻倍 max_tokens 重试', {
            attempt,
            maxTokens,
            error: (err as Error).message,
          });
          continue;
        }
        logger.warn('图谱提取失败，跳过该文档', {
          error: (err as Error).message,
          domain,
        });
        otel.recordError(span, err as Error);
        return null;
      }
    }
    // 内存画像（MEM_PROFILE=1）：LLM 提取完成（rawOutput 大字符串释放前）
    memProfile('graph-extract:done', { domain });
    if (!extracted) return null;

    // 3.5 schema 白名单后置过滤（K2 opt-in）：丢弃白名单外实体/关系并计数
    const {
      result: filtered,
      droppedEntities,
      droppedEdges,
    } = applySchemaFilter(extracted, schema);
    const keptEntities = filtered.entities ?? [];
    const keptEdges = filtered.edges ?? [];

    // 4. 写入 kg_edges 表
    let edgeCount = 0;
    for (const edge of keptEdges) {
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

    span.setAttribute('knowledge.graph.entity_count', keptEntities.length);
    span.setAttribute('knowledge.graph.edge_count', edgeCount);
    if (schema) {
      span.setAttribute('knowledge.graph.dropped_entities', droppedEntities);
      span.setAttribute('knowledge.graph.dropped_edges', droppedEdges);
    }
    logger.info('图谱提取完成', {
      domain,
      entities: keptEntities.length,
      edges: edgeCount,
      schema: schema ? 'constrained' : 'freeform',
      droppedEntities,
      droppedEdges,
    });

    return { entities: keptEntities, edges: keptEdges };
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
  private schema?: GraphSchema;

  constructor(
    private aiService: AIService,
    private knowledgeGraph: KnowledgeGraph,
    schema?: GraphSchema
  ) {
    this.schema = schema;
  }

  async extract(
    content: string,
    domain: string
  ): Promise<ExtractionResult | null> {
    return extractGraph(
      this.aiService,
      this.knowledgeGraph,
      content,
      domain,
      this.schema
    );
  }

  /** 查询指定域是否已存在图谱数据（用于判断是否需要全量构建） */
  async hasDomainEdges(domain: string): Promise<boolean> {
    const edges = await this.knowledgeGraph.queryEdges({ domain, limit: 1 });
    return edges.length > 0;
  }
}
