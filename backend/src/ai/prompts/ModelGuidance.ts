export const TOOL_USE_ENFORCEMENT_GUIDANCE: Record<string, string> = {
  anthropic: 'You MUST use tools to interact with the environment.',
  openai:
    'Use function calls for any action that modifies files or executes commands.',
  google: 'Use the available tools for all filesystem and terminal operations.',
  deepseek: 'Call the appropriate tool functions for each operation.',
  ollama: 'Use tool calls for file and command operations.',
};

export const OPENAI_MODEL_EXECUTION_GUIDANCE =
  'Plan your actions step by step. Execute each step using the appropriate tool. After each tool call, evaluate the result before proceeding.';

export const GOOGLE_MODEL_OPERATIONAL_GUIDANCE =
  'Use the available tool functions systematically. Verify each tool result before the next action.';

export function getModelGuidance(provider: string, modelName: string): string {
  const providerLower = provider.toLowerCase();

  if (TOOL_USE_ENFORCEMENT_GUIDANCE[providerLower]) {
    return TOOL_USE_ENFORCEMENT_GUIDANCE[providerLower];
  }

  if (
    modelName.includes('gpt') ||
    modelName.includes('o1') ||
    modelName.includes('o3')
  ) {
    return OPENAI_MODEL_EXECUTION_GUIDANCE;
  }

  if (modelName.includes('gemini')) {
    return GOOGLE_MODEL_OPERATIONAL_GUIDANCE;
  }

  return '';
}
