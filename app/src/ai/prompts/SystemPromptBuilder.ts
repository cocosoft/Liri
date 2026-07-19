import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { buildEnvironmentHints, buildPlatformContext } from './PlatformHints';
import {
  getModelGuidance,
  DEFAULT_GUIDANCE_CONFIG,
  type ModelGuidanceConfig,
  type ModelGuidanceMode,
} from './ModelGuidance';
import { getPromptInjectionDetector } from '../../security/injection/PromptInjectionDetector';
import { getUnicodeSanitizer } from '../../security/injection/UnicodeSanitizer';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'ai\prompts\SystemPromptBuilder',
  level: LogLevel.INFO,
});

export interface SystemPromptContext {
  platform?: string;
  provider?: string;
  modelName?: string;
  includeEnvironmentHints?: boolean;
  includePlatformHint?: boolean;
  includeModelGuidance?: boolean;
  modelGuidanceMode?: ModelGuidanceMode;
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
    const platformContext = buildPlatformContext(context.platform);
    if (platformContext) {
      parts.push(`\n[Platform Context]\n${platformContext}`);
    }
  }

  if (
    context.includeModelGuidance !== false &&
    context.provider &&
    context.modelName
  ) {
    const guidanceConfig: ModelGuidanceConfig = {
      ...DEFAULT_GUIDANCE_CONFIG,
      ...(context.modelGuidanceMode ? { mode: context.modelGuidanceMode } : {}),
    };
    const guidance = getModelGuidance(
      context.provider,
      context.modelName,
      guidanceConfig
    );
    if (guidance) {
      parts.push(
        `\n[Model Guidance: ${context.provider}/${context.modelName}]\n${guidance}`
      );
    }
  }

  return parts.join('\n');
}

export function injectPlatformHints(prompt: string, platform: string): string {
  const context = buildPlatformContext(platform);

  return context ? `${prompt}\n\n${context}` : prompt;
}

export function injectModelGuidance(
  prompt: string,
  provider: string,
  modelName: string,
  mode?: ModelGuidanceMode
): string {
  const guidanceConfig: ModelGuidanceConfig = {
    ...DEFAULT_GUIDANCE_CONFIG,
    ...(mode ? { mode } : {}),
  };
  const guidance = getModelGuidance(provider, modelName, guidanceConfig);

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
