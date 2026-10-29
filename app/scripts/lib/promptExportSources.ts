/**
 * C-1（2026-10-18）提示词**冻结导出**的来源采集（生成脚本与守卫测试**共用**）。
 *
 * 口径（行为零变化）：
 * - **静态段**（compute() 为纯字面量/确定性渲染，**无环境依赖**）⇒ 原文导出为 `.md` + sha256；
 * - **动态段**（依赖工作区文件 / 用户文件 / 会话 / 记忆 / 知识库）⇒ **不导出文本**，
 *   只在 manifest 登记 `kind: 'dynamic'` + 原因 + 源文件 —— 冻结其运行时输出即**编造**
 *   （CS06），改由 C-2 的解析链以占位模板承接；
 * - **工具提示词**（`tools/<Tool>/prompt.ts`）⇒ 每个「`*_PROMPT` 字符串」或
 *   「`get*Description()` 函数」各导出一份原文。
 *
 * ⚠️ 本模块**不读取** `app/prompts/**`：它只回答「源文本是什么」，
 * 落盘 / 比对分别在 `scripts/export-prompts.ts` 与 `tests/prompts/promptExportParity.test.ts`。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SECTION_NAMES,
  type StaticPromptSectionName,
} from '@modules/constants';
import { BUILTIN_SECTIONS } from '../../src/context/promptSections/builtinSections';

/** 导出根目录 = `app/prompts`（本文件位于 `app/scripts/lib/`） */
export const PROMPTS_ROOT = resolve(import.meta.dir, '../../prompts');

/** 当前导出语言（源语言） */
export const PROMPT_LOCALE = 'zh-CN';

/** 段落源文件（相对仓库根的展示路径） */
const SECTION_SOURCE = 'app/src/context/promptSections/builtinSections.ts';

/** 静态段（可冻结为文本；compute() 不读环境） */
export const STATIC_SECTION_IDS: readonly StaticPromptSectionName[] = [
  'identity',
  'toolUse',
  'toolIntegrity',
  'shellDeclaration',
  'taskNegotiation',
  'pdcaThinking',
  'fewShotExamples',
  'knowledgeSaveGuide',
  'outputArtifactBoundary',
];

/** 动态段 → 不可冻结的原因（必须覆盖除 `STATIC_SECTION_IDS` 外的全部段） */
export const DYNAMIC_SECTION_REASONS: Record<string, string> = {
  projectRules: '读取工作区 AGENTS.md（内容随工作区变化）',
  toolsConvention: '读取工作区 TOOLS.md（内容随工作区变化）',
  userProfile: '读取用户 USER.md / settings.user（随用户变化）',
  personality: '读取 SOUL.md / Core Truths / Boundaries / Vibe（随用户变化）',
  memoryContext: '记忆检索结果 / 会话级冻结快照（运行时数据）',
  promptEvolution: '读取受管演化覆盖层（文件存在与否决定该段）',
  gitContext: '读取实时 git 状态（分支/变更）',
  projectMeta: '读取项目元数据（DB / 工作区）',
  skills: '读取技能清单（随安装的技能变化）',
  sessionContext: '读取当前会话状态（运行时数据）',
  projectContext: '读取项目文件清单（随工作区变化）',
  knowledgeContext: '知识库检索结果（运行时数据）',
  knowledgeDigest: '知识摘要异步生成（定时更新）',
  // S6 / issue #13（2026-10-29）：域清单读 ~/.pyapp/knowledge/domains/ 的 .domain.yaml（随用户建域变化）
  knowledgeDomains: '知识域清单读取磁盘配置（随用户创建域变化）',
};

export interface SectionExport {
  /** manifest id：`section:<name>` */
  id: string;
  name: StaticPromptSectionName;
  kind: 'static' | 'dynamic';
  source: string;
  /** 相对 `prompts/zh-CN/` 的文件路径（仅静态段） */
  file?: string;
  /** 原文（仅静态段） */
  text?: string;
  sha256?: string;
  /** 不可冻结原因（仅动态段） */
  reason?: string;
}

export interface ToolPromptExport {
  /** manifest id：`tool:<dir>/<exportName>` */
  id: string;
  /** 工具目录名（如 `FileWriteTool`） */
  dir: string;
  /** 源导出名（`*_PROMPT` 常量名或 `get*Description` 函数名） */
  exportName: string;
  source: string;
  /** 相对 `prompts/zh-CN/` 的文件路径 */
  file: string;
  text: string;
  sha256: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 采集全部段（23）：静态段带原文，动态段带原因（顺序 = `SECTION_NAMES`） */
export async function collectSections(): Promise<SectionExport[]> {
  const staticSet = new Set<string>(STATIC_SECTION_IDS);
  const out: SectionExport[] = [];

  for (const name of SECTION_NAMES) {
    if (staticSet.has(name)) {
      const section = BUILTIN_SECTIONS[name];
      const text = await section.compute();
      if (typeof text !== 'string' || text.length === 0) {
        throw new Error(`静态段落 ${name} 未产出文本（不应为 null/空）`);
      }
      out.push({
        id: `section:${name}`,
        name,
        kind: 'static',
        source: SECTION_SOURCE,
        file: `sections/${name}.md`,
        text,
        sha256: sha256(text),
      });
      continue;
    }

    const reason = DYNAMIC_SECTION_REASONS[name];
    if (!reason) {
      throw new Error(
        `段落 ${name} 未分类：请加入 STATIC_SECTION_IDS 或 DYNAMIC_SECTION_REASONS`
      );
    }
    out.push({
      id: `section:${name}`,
      name,
      kind: 'dynamic',
      source: SECTION_SOURCE,
      reason,
    });
  }

  return out;
}

/** 工具目录（`app/src/tools/<Tool>/prompt.ts`）——按目录名排序 */
export function listToolPromptDirs(toolsRoot: string): string[] {
  return readdirSync(toolsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(toolsRoot, name, 'prompt.ts')))
    .sort();
}

function pickPromptTexts(
  mod: Record<string, unknown>
): Array<{ exportName: string; text: string }> {
  const found: Array<{ exportName: string; text: string }> = [];
  for (const [exportName, value] of Object.entries(mod)) {
    if (typeof value === 'string' && exportName.endsWith('_PROMPT')) {
      found.push({ exportName, text: value });
    }
  }
  for (const [exportName, value] of Object.entries(mod)) {
    if (
      typeof value === 'function' &&
      /^get[A-Za-z]*Description$/.test(exportName)
    ) {
      const text = (value as () => string)();
      if (typeof text === 'string' && text.length > 0) {
        found.push({ exportName, text });
      }
    }
  }
  if (found.length === 0) {
    throw new Error('未找到 *_PROMPT 或 get*Description 导出');
  }
  return found.sort((a, b) => (a.exportName < b.exportName ? -1 : 1));
}

/** 采集全部工具提示词（3 个 `prompt.ts`，按导出逐个成文） */
export async function collectToolPrompts(
  toolsRoot: string = resolve(import.meta.dir, '../../src/tools')
): Promise<ToolPromptExport[]> {
  const out: ToolPromptExport[] = [];

  for (const dir of listToolPromptDirs(toolsRoot)) {
    const abs = join(toolsRoot, dir, 'prompt.ts');
    const mod = (await import(pathToFileURL(abs).href)) as Record<
      string,
      unknown
    >;
    for (const { exportName, text } of pickPromptTexts(mod)) {
      out.push({
        id: `tool:${dir}/${exportName}`,
        dir,
        exportName,
        source: `app/src/tools/${dir}/prompt.ts`,
        file: `tools/${dir}/${exportName}.md`,
        text,
        sha256: sha256(text),
      });
    }
  }

  return out;
}
