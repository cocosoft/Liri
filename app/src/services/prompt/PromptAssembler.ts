import {
  getRegisteredSections,
  resolveSystemPromptSections,
  CACHE_BOUNDARY,
  type SystemPromptSection,
} from '@modules/constants/systemPromptSections';
import { buildSystemPrompt, type SystemPromptContext } from '@modules/ai';
import { providerPromptRegistry } from './ProviderPromptPlugin';
import { modelManager } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import { setCurrentSessionContext } from './MemoryPromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import { generatePromptReport, formatPromptReport } from './SystemPromptReport';
import type { PromptMode } from './types';
export type { PromptMode };

const logger = new Logger({ module: 'prompt:assembler', level: LogLevel.INFO });

const CORE_SECTION_NAMES = new Set([
  'identity',
  'personality',
  'userProfile',
  'toolUse',
]);

const CONVERSATION_SECTION_NAMES = new Set([
  'identity',
  'personality',
  'userProfile',
  'toolUse',
  'taskNegotiation',
  'sessionContext',
]);

export interface AssembleOptions {
  sections?: SystemPromptSection[];
  strategyExtra?: string;
  systemPromptContext?: SystemPromptContext;
  mode?: PromptMode;
  providerId?: string;
  sessionContext?: SessionContext;
}

function filterSectionsByMode(
  sections: SystemPromptSection[],
  mode: PromptMode
): SystemPromptSection[] {
  switch (mode) {
    case 'none':
      return sections.filter((s) => s.name === 'identity');
    case 'minimal':
      return sections.filter((s) => CORE_SECTION_NAMES.has(s.name));
    case 'conversation':
      return sections.filter((s) => CONVERSATION_SECTION_NAMES.has(s.name));
    case 'full':
    default:
      return sections;
  }
}

/**
 * 从模型名称解析提供商
 */
function resolveProviderFromModel(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (
    lower.startsWith('claude-') ||
    lower.startsWith('opus') ||
    lower.startsWith('sonnet') ||
    lower.startsWith('haiku')
  )
    return 'anthropic';
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  )
    return 'openai';
  if (lower.startsWith('gemini-')) return 'google';
  if (lower.startsWith('deepseek-') || lower.includes('deepseek'))
    return 'deepseek';
  if (
    lower.includes('llama') ||
    lower.includes('mistral') ||
    lower.includes('mixtral')
  )
    return 'groq';
  return 'unknown';
}

export async function assembleSystemPrompt(
  options: AssembleOptions = {}
): Promise<string> {
  const {
    sections,
    strategyExtra,
    systemPromptContext,
    mode,
    providerId,
    sessionContext,
  } = options;

  if (sessionContext) {
    setCurrentSessionContext(sessionContext);
  }
  const resolvedMode: PromptMode = mode ?? 'full';

  const baseSections = sections ?? getRegisteredSections();
  const providerSections = providerPromptRegistry.applyOverrides(
    providerId,
    baseSections
  );
  const filteredSections = filterSectionsByMode(providerSections, resolvedMode);
  const sectionResults = await resolveSystemPromptSections(filteredSections);

  {
    const report = generatePromptReport(
      filteredSections,
      sectionResults,
      resolvedMode
    );
    logger.debug(formatPromptReport(report));
  }

  const stableParts: string[] = [];
  const dynamicParts: string[] = [];

  for (let i = 0; i < filteredSections.length; i++) {
    const result = sectionResults[i];
    if (!result) continue;

    if (filteredSections[i].cacheBreak) {
      dynamicParts.push(result);
    } else {
      stableParts.push(result);
    }
  }

  const parts: string[] = [...stableParts, CACHE_BOUNDARY, ...dynamicParts];

  const combined = parts.join('\n\n');

  let result = buildSystemPrompt(combined, {
    includeModelGuidance: true,
    ...systemPromptContext,
    ...(systemPromptContext?.provider && systemPromptContext?.modelName
      ? {}
      : resolveModelContext()),
  });

  if (strategyExtra) {
    result = result + '\n\n' + strategyExtra;
  }

  return result;
}

/**
 * 解析当前模型上下文（provider + modelName）
 */
function resolveModelContext(): { provider: string; modelName: string } {
  try {
    const modelName = modelManager.getCurrentModel();
    const provider = resolveProviderFromModel(modelName);
    return { provider, modelName };
  } catch {
    return { provider: 'unknown', modelName: 'unknown' };
  }
}

/**
 * 使用默认段落列表组装系统提示词
 * @deprecated 请直接使用 assembleSystemPrompt({ strategyExtra, mode, providerId })
 */
export async function assembleDefaultSystemPrompt(
  strategyExtra?: string,
  mode?: PromptMode,
  providerId?: string
): Promise<string> {
  return assembleSystemPrompt({
    sections: getRegisteredSections(),
    strategyExtra,
    mode,
    providerId,
  });
}
