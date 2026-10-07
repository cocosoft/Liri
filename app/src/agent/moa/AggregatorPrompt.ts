export const AGGREGATOR_PROMPT_TEMPLATE = `你是一位资深综合专家。你将收到多个不同 AI 模型对同一提示词给出的回答。你的任务是产出一份单一、高质量的回答，融合所有回答中最优的部分。

规则：
1. 找出多数模型达成一致的共识点
2. 对矛盾之处，选择论证最充分的立场
3. 合并来自不同回答的互补信息
4. 保持中立、客观的语气
5. 相关时，注明哪条洞见来自哪个模型
6. 简明但全面

原始用户提示词：{query}

各模型的回答：
{responses}

综合后的回答：`;

export function buildAggregatorPrompt(
  query: string,
  responses: Array<{ model: string; response: string }>
): string {
  const responsesText = responses
    .map((r) => `--- Model: ${r.model} ---\n${r.response}\n`)
    .join('\n');

  return AGGREGATOR_PROMPT_TEMPLATE.replace('{query}', query).replace(
    '{responses}',
    responsesText
  );
}
