export interface ModelSpecificTokenEstimator {
  modelPattern: RegExp;
  charsPerToken: number;
  overheadPerMessage: number;
  overheadPerTurn: number;
}

export const DEFAULT_ESTIMATORS: ModelSpecificTokenEstimator[] = [
  {
    modelPattern: /claude/i,
    charsPerToken: 3.5,
    overheadPerMessage: 5,
    overheadPerTurn: 20,
  },
  {
    modelPattern: /gpt-4/i,
    charsPerToken: 4,
    overheadPerMessage: 4,
    overheadPerTurn: 15,
  },
  {
    modelPattern: /gpt-3\.5/i,
    charsPerToken: 4,
    overheadPerMessage: 4,
    overheadPerTurn: 12,
  },
  {
    modelPattern: /deepseek/i,
    charsPerToken: 3.8,
    overheadPerMessage: 5,
    overheadPerTurn: 18,
  },
  {
    modelPattern: /gemini/i,
    charsPerToken: 4,
    overheadPerMessage: 6,
    overheadPerTurn: 22,
  },
];

export function getEstimatorForModel(
  model: string
): ModelSpecificTokenEstimator {
  for (const estimator of DEFAULT_ESTIMATORS) {
    if (estimator.modelPattern.test(model)) {
      return estimator;
    }
  }
  return {
    modelPattern: /.*/,
    charsPerToken: 4,
    overheadPerMessage: 4,
    overheadPerTurn: 15,
  };
}

export function estimateTokensForText(text: string, model: string): number {
  const estimator = getEstimatorForModel(model);
  return Math.ceil(text.length / estimator.charsPerToken);
}

export function estimateTokensForMessages(
  messages: Array<{ content?: string | unknown; role?: string }>,
  model: string
): number {
  const estimator = getEstimatorForModel(model);
  let total = 0;

  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += Math.ceil(message.content.length / estimator.charsPerToken);
    } else if (
      typeof message.content === 'object' &&
      message.content !== null
    ) {
      total += Math.ceil(
        JSON.stringify(message.content).length / estimator.charsPerToken
      );
    }
    total += estimator.overheadPerMessage;
  }

  total += estimator.overheadPerTurn;
  return total;
}

export function estimateThinkingTokens(
  thinkingText: string,
  model: string
): number {
  const estimator = getEstimatorForModel(model);
  return Math.ceil(thinkingText.length / estimator.charsPerToken);
}
