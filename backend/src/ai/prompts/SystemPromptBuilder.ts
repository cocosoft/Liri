import { buildEnvironmentHints, getPlatformHint } from './PlatformHints';
import { getModelGuidance } from './ModelGuidance';

export interface SystemPromptContext {
  platform?: string;
  provider?: string;
  modelName?: string;
  includeEnvironmentHints?: boolean;
  includePlatformHint?: boolean;
  includeModelGuidance?: boolean;
}

export function buildSystemPrompt(basePrompt: string, context: SystemPromptContext = {}): string {
  const parts: string[] = [basePrompt];

  if (context.includeEnvironmentHints !== false) {
    const envHints = buildEnvironmentHints();
    if (envHints) {
      parts.push(`\n[Environment Information]\n${envHints}`);
    }
  }

  if (context.includePlatformHint !== false && context.platform) {
    const platformHint = getPlatformHint(context.platform);
    if (platformHint) {
      parts.push(`\n[Platform Hint: ${context.platform}]\n${platformHint}`);
    }
  }

  if (context.includeModelGuidance !== false && context.provider && context.modelName) {
    const guidance = getModelGuidance(context.provider, context.modelName);
    if (guidance) {
      parts.push(`\n[Model Guidance: ${context.provider}/${context.modelName}]\n${guidance}`);
    }
  }

  return parts.join('\n');
}

export function injectPlatformHints(prompt: string, platform: string): string {
  const hint = getPlatformHint(platform);

  return hint ? `${prompt}\n\n${hint}` : prompt;
}

export function injectModelGuidance(
  prompt: string,
  provider: string,
  modelName: string
): string {
  const guidance = getModelGuidance(provider, modelName);

  return guidance ? `${prompt}\n\n${guidance}` : prompt;
}

export function injectEnvironmentHints(prompt: string): string {
  const hints = buildEnvironmentHints();

  return hints ? `${prompt}\n\n[System Information]\n${hints}` : prompt;
}

export const systemPromptBuilder = {
  build: buildSystemPrompt,
  injectPlatformHints,
  injectModelGuidance,
  injectEnvironmentHints,
};
