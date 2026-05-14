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

const AGGREGATOR_PROMPT = `You are an expert synthesizer. You will receive multiple responses from different AI models to the same prompt. Your task is to produce a single, high-quality response that combines the best elements from all responses.

Rules:
1. Identify consensus points that most models agree on
2. Resolve contradictions by choosing the most well-reasoned position
3. Combine complementary information from different responses
4. Maintain a neutral, objective tone
5. Cite which model contributed which insight when relevant
6. Be concise but comprehensive

Original user prompt: {query}

Individual model responses:
{responses}

Synthesized response:`;

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
      const responsesText = individualResults
        .map((r) => `--- Model: ${r.model} ---\n${r.response}\n`)
        .join('\n');

      const aggregatorPrompt = AGGREGATOR_PROMPT.replace(
        '{query}',
        request.query
      ).replace('{responses}', responsesText);

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
