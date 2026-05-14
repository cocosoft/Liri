export const AGGREGATOR_PROMPT_TEMPLATE = `You are an expert synthesizer. You will receive multiple responses from different AI models to the same prompt. Your task is to produce a single, high-quality response that combines the best elements from all responses.

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

export function buildAggregatorPrompt(query: string, responses: Array<{ model: string; response: string }>): string {
  const responsesText = responses
    .map((r) => `--- Model: ${r.model} ---\n${r.response}\n`)
    .join('\n');

  return AGGREGATOR_PROMPT_TEMPLATE
    .replace('{query}', query)
    .replace('{responses}', responsesText);
}
