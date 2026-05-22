import {
  getRegisteredSections,
  resolveSystemPromptSections,
  type SystemPromptSection,
} from '@modules/constants/systemPromptSections';
import {
  buildSystemPrompt,
  type SystemPromptContext,
} from '@modules/ai/prompts/SystemPromptBuilder';
import { providerPromptRegistry } from './ProviderPromptPlugin';

export type PromptMode = 'full' | 'minimal' | 'none';

const CORE_SECTION_NAMES = new Set([
  'identity',
  'personality',
  'userProfile',
  'toolUse',
]);

export interface AssembleOptions {
  sections?: SystemPromptSection[];
  strategyExtra?: string;
  systemPromptContext?: SystemPromptContext;
  mode?: PromptMode;
  providerId?: string;
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
    case 'full':
    default:
      return sections;
  }
}

export async function assembleSystemPrompt(
  options: AssembleOptions = {}
): Promise<string> {
  const { sections, strategyExtra, systemPromptContext, mode, providerId } =
    options;
  const resolvedMode: PromptMode = mode ?? 'full';

  const baseSections = sections ?? getRegisteredSections();
  const providerSections = providerPromptRegistry.applyOverrides(
    providerId,
    baseSections
  );
  const filteredSections = filterSectionsByMode(providerSections, resolvedMode);
  const sectionResults = await resolveSystemPromptSections(filteredSections);

  const parts: string[] = [];

  for (const result of sectionResults) {
    if (result) {
      parts.push(result);
    }
  }

  if (strategyExtra) {
    parts.push(strategyExtra);
  }

  const combined = parts.join('\n\n');

  return buildSystemPrompt(combined, systemPromptContext);
}

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
