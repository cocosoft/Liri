import {
  getRegisteredSections,
  resolveSystemPromptSections,
  CACHE_BOUNDARY,
  type SystemPromptSection,
} from '@modules/constants/systemPromptSections';
import { buildSystemPrompt, type SystemPromptContext } from '@modules/ai';
import { providerPromptRegistry } from './ProviderPromptPlugin';
import { modelManager } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { Logger, LogLevel } from '@modules/monitoring';
import { setCurrentSessionContext } from './MemoryPromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import { generatePromptReport, formatPromptReport } from './SystemPromptReport';
import {
  applyPromptOverrides,
  getPromptAppendices,
} from './PromptVersionManager';
import {
  generateDiagnosticsReport,
  type DiagnosticsReport,
} from './DiagnosticsReport';
import type { PromptMode } from './types';
export type { PromptMode };

const logger = new Logger({ module: 'prompt:assembler', level: LogLevel.INFO });

/** P3-11: 最近一次诊断报告缓存 */
let _lastDiagnosticsReport: DiagnosticsReport | null = null;

/** P3-11: 获取最近一次诊断报告 */
export function getLastDiagnosticsReport(): DiagnosticsReport | null {
  return _lastDiagnosticsReport;
}

const CORE_SECTION_NAMES = new Set([
  'identity',
  'personality',
  'userProfile',
  'toolUse',
  'toolIntegrity',
  'shellDeclaration',
]);

const CONVERSATION_SECTION_NAMES = new Set([
  'identity',
  'personality',
  'userProfile',
  'toolUse',
  'toolIntegrity',
  'shellDeclaration',
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
 * 从模型名称解析提供商。
 * CS02 FIXED: 优先从 ProviderRegistry 查询，未命中时回退到名称前缀启发式。
 */
function resolveProviderFromModel(modelName: string): string {
  // 优先从 ProviderRegistry 查（DB 注册的模型都有精确的 provider）
  try {
    const resolved = providerRegistry.getByModel(modelName);
    if (resolved) return resolved.id;
  } catch {
    /* ProviderRegistry 不可用时回退 */
  }

  // 回退：名称前缀启发式（仅用于未注册的临时模型名）
  logger.debug('PromptAssembler: ProviderRegistry 未命中，回退启发式', {
    modelName,
  });
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
    const section = filteredSections[i];
    let result = sectionResults[i];
    if (!result) continue;

    // P3-10: 应用外置 Prompt 覆盖（~/.pyapp/prompts/*.md）
    result = applyPromptOverrides(section.name, result);

    if (section.cacheBreak) {
      dynamicParts.push(result);
    } else {
      stableParts.push(result);
    }
  }

  // P3-10: 追加外置 custom prompt
  const appendices = getPromptAppendices();
  const parts: string[] = [
    ...stableParts,
    CACHE_BOUNDARY,
    ...dynamicParts,
    ...appendices,
  ];

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

  // P3-11: 生成诊断报告（按静态/动态/消息/工具/记忆/MCP 分类的 Token 消耗分解）
  try {
    const sectionData = filteredSections.map((s, i) => ({
      name: s.name,
      content: sectionResults[i] ?? '',
      cacheBreak: s.cacheBreak,
    }));
    // 上下文限制从环境配置获取，默认 200K
    const contextLimit =
      ((systemPromptContext as Record<string, unknown>)
        ?.contextLimit as number) ?? 200_000;
    _lastDiagnosticsReport = generateDiagnosticsReport(
      sectionData,
      0, // messages — 此处不跟踪，由调用方按需补充
      0, // toolDefs
      0, // toolResults
      0, // memoryFiles
      0, // mcpInstructions
      contextLimit
    );
    if (_lastDiagnosticsReport.suggestions.length > 0) {
      logger.debug('diagnostics:suggestions', {
        suggestions: _lastDiagnosticsReport.suggestions,
      });
    }
  } catch {
    // 诊断报告失败不阻断主流程
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
