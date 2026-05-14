/**
 * MoARouter - Mixture of Agents 路由器
 * N 模型并行查询 → 1 聚合器综合输出
 */
import { buildAggregatorPrompt } from './AggregatorPrompt';

export interface MoARequest {
  query: string;
  models: string[];
  aggregatorModel: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface MoAResponse {
  aggregated: string;
  individualResponses: Array<{
    model: string;
    response: string;
    tokensUsed?: number;
  }>;
  meta: {
    modelsUsed: number;
    totalTokens: number;
    latencyMs: number;
  };
}

export interface MoAModelAdapter {
  name: string;
  query(
    query: string,
    systemPrompt?: string,
    maxTokens?: number
  ): Promise<string>;
}

export class MoARouter {
  private adapters: Map<string, MoAModelAdapter> = new Map();

  registerAdapter(name: string, adapter: MoAModelAdapter): void {
    this.adapters.set(name, adapter);
  }

  removeAdapter(name: string): void {
    this.adapters.delete(name);
  }

  getRegisteredModels(): string[] {
    return Array.from(this.adapters.keys());
  }

  async route(request: MoARequest): Promise<MoAResponse> {
    const startTime = Date.now();

    const selectedAdapters = request.models
      .filter((name) => this.adapters.has(name))
      .map((name) => this.adapters.get(name)!);

    const individualResults: Array<{
      model: string;
      response: string;
      tokensUsed?: number;
    }> = [];

    const parallelQueries = selectedAdapters.map(async (adapter) => {
      try {
        const response = await adapter.query(
          request.query,
          request.systemPrompt,
          request.maxTokens
        );
        individualResults.push({
          model: adapter.name,
          response,
        });
      } catch (err) {
        individualResults.push({
          model: adapter.name,
          response: `[Error: ${err instanceof Error ? err.message : 'Unknown error'}]`,
        });
      }
    });

    await Promise.all(parallelQueries);

    const aggregatorAdapter = this.adapters.get(request.aggregatorModel);
    let aggregated = '';

    if (aggregatorAdapter && individualResults.length > 0) {
      const aggregatorPrompt = buildAggregatorPrompt(
        request.query,
        individualResults.map((r) => ({
          model: r.model,
          response: r.response,
        }))
      );

      aggregated = await aggregatorAdapter.query(
        aggregatorPrompt,
        undefined,
        request.maxTokens
      );
    } else if (individualResults.length >= 1) {
      aggregated = individualResults[0].response;
    } else {
      aggregated = 'No models available to process the request.';
    }

    return {
      aggregated,
      individualResponses: individualResults,
      meta: {
        modelsUsed: individualResults.length,
        totalTokens: 0,
        latencyMs: Date.now() - startTime,
      },
    };
  }
}
