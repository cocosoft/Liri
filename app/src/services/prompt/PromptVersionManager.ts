/**
 * PromptVersionManager — 外置 Prompt 版本管理
 *
 * P3-10: 支持从 ~/.pyapp/prompts/ 外置目录加载 Prompt 覆盖，
 * 修改无需重新编译。对标 cc_code systemPromptSection 缓存 + hermes 三层架构。
 *
 * 目录结构：
 *   ~/.pyapp/prompts/
 *     identity.md      → 覆盖 identity 段落
 *     personality.md   → 覆盖 personality 段落
 *     toolUse.md       → 覆盖 toolUse 段落
 *     custom.md        → 追加到末尾
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core';

export interface PromptOverrides {
  sections: Record<string, string>;
  appendices: string[];
}

let _cachedOverrides: PromptOverrides | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30s

const SECTION_FILE_MAP: Record<string, string> = {
  identity: 'identity.md',
  personality: 'personality.md',
  toolUse: 'toolUse.md',
  toolIntegrity: 'toolIntegrity.md',
  shellDeclaration: 'shellDeclaration.md',
  taskNegotiation: 'taskNegotiation.md',
  custom: 'custom.md',
};

/**
 * 加载外置 Prompt 覆盖
 */
export function loadPromptOverrides(forceRefresh = false): PromptOverrides {
  if (!forceRefresh && _cachedOverrides && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cachedOverrides;
  }

  const promptsDir = join(resolvePyappHome(), 'prompts');
  const sections: Record<string, string> = {};
  const appendices: string[] = [];

  for (const [section, filename] of Object.entries(SECTION_FILE_MAP)) {
    const filePath = join(promptsDir, filename);
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, 'utf-8').trim();
      if (!content) continue;

      if (section === 'custom') {
        appendices.push(content);
      } else {
        sections[section] = content;
      }
    } catch {
      // skip unreadable files
    }
  }

  _cachedOverrides = { sections, appendices };
  _cacheTime = Date.now();
  return _cachedOverrides;
}

/**
 * 应用 Prompt 覆盖到指定段落
 */
export function applyPromptOverrides(
  sectionName: string,
  defaultContent: string
): string {
  const overrides = loadPromptOverrides();
  return overrides.sections[sectionName] ?? defaultContent;
}

/**
 * 获取所有追加段落
 */
export function getPromptAppendices(): string[] {
  return loadPromptOverrides().appendices;
}

/**
 * 清除缓存
 */
export function clearPromptCache(): void {
  _cachedOverrides = null;
  _cacheTime = 0;
}
