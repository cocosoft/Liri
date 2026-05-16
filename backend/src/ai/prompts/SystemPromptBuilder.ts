import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { buildEnvironmentHints, getPlatformHint } from './PlatformHints';
import { getModelGuidance } from './ModelGuidance';
import { getPromptInjectionDetector } from '../../security/injection/PromptInjectionDetector';
import { getUnicodeSanitizer } from '../../security/injection/UnicodeSanitizer';

export interface SystemPromptContext {
  platform?: string;
  provider?: string;
  modelName?: string;
  includeEnvironmentHints?: boolean;
  includePlatformHint?: boolean;
  includeModelGuidance?: boolean;
}

export function buildSystemPrompt(
  basePrompt: string,
  context: SystemPromptContext = {}
): string {
  const sanitized = getUnicodeSanitizer().sanitize(basePrompt);
  const detectionResult = getPromptInjectionDetector().detect(sanitized.output);

  if (detectionResult.detected && detectionResult.severity === 'critical') {
    throw new AppError(
      `Prompt injection detected: ${detectionResult.description}\n` +
        `Patterns: ${detectionResult.matchedPatterns.join(', ')}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.CRITICAL,
      'PROMPT_INJECTION_DETECTED',
      {
        severity: detectionResult.severity,
        patterns: detectionResult.matchedPatterns,
      }
    );
  }

  const parts: string[] = [sanitized.output];

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

  if (
    context.includeModelGuidance !== false &&
    context.provider &&
    context.modelName
  ) {
    const guidance = getModelGuidance(context.provider, context.modelName);
    if (guidance) {
      parts.push(
        `\n[Model Guidance: ${context.provider}/${context.modelName}]\n${guidance}`
      );
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
