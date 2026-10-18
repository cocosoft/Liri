/**
 * PromptVersionManager — 外置 Prompt 版本管理
 *
 * P3-10: 支持从 ~/.pyapp/prompts/ 外置目录加载 Prompt 覆盖，
 * 修改无需重新编译。对标 cc_code systemPromptSection 缓存 + hermes 三层架构。
 *
 * C-2（2026-10-18）：`resolvePrompt()` 六级解析链 + locale 缓存键
 * （清单 `dev_docs/20261018/待修复任务清单-20261018.md` §4 C-2）。
 *
 * C-3（2026-10-18）：工具提示词（T2）接入同一解析链 —— `resolveToolPrompt()`
 * （清单 §4 C-3；资源由 C-1 冻结导出到 `tools/<ToolDir>/<Export>.md`）。
 *
 * 目录结构（用户级，`~/.pyapp/prompts/`）：
 *   <locale>/<sectionId>.md   → 按语言覆盖段落（C-2 新增）
 *   <sectionId>.md            → 旧扁平覆盖（P3-10 已发布形态；locale 目录 miss 时回退，兼容存量数据）
 *   <locale>/tools/<ToolDir>/<Export>.md → 按语言覆盖工具提示词（C-3）
 *   custom.md                 → 追加到末尾（无 locale 维度，语义不变）
 * 目录结构（项目级）：
 *   <workspace>/.liri/prompts/<locale>/<sectionId>.md
 *   <workspace>/.liri/prompts/<locale>/tools/<ToolDir>/<Export>.md
 * 包内资源（只读基线）：
 *   app/prompts/<locale>/sections/<sectionId>.md（C-1 冻结导出，manifest.json 驱动键范围）
 *   app/prompts/<locale>/tools/<ToolDir>/<Export>.md
 */

import { readFileSync, existsSync } from 'fs';
import { basename, join, resolve } from 'path';
import {
  resolvePyappHome,
  resolveProjectRoot,
  WORKSPACE_CONFIG_DIR_NAME,
} from '@modules/core';
import { SECTION_NAMES, getSectionCacheLocale } from '@modules/constants';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('prompt:version-manager');

const PROMPT_VERSION_CACHE_TTL_MS = 30_000; // 30s

/** C-2：整段覆盖内容上限（内置最大段约 6KB；64KB 宽松防失控），超限视为不可信输入不注入 */
const MAX_OVERRIDE_CHARS = 65_536;

/** C-2：custom.md 追加段文件名（P3-10 语义不变） */
const CUSTOM_APPENDIX_FILE = 'custom.md';

// ─── C-2：manifest 驱动的可覆盖键范围 ───────────────────────────────────────

/**
 * 包内资源根（`app/prompts/`）。
 *
 * 三种运行形态的候选顺序（C-3b 发布链路修复，2026-10-18）：
 *   ① 源码：`app/src/services/prompt` 上溯 3 级 → `app/prompts`
 *   ② bundle：`dist/pkg/liri.js` 同级 → `dist/pkg/prompts`
 *   ③ compile：`dist/liri_terminal(.exe)` 同级 → `dist/prompts`
 *
 * 选**第一个真实存在**的目录；都不存在时退回源码候选（保持原有失败/兜底语义）。
 */
export function resolvePromptResourceRoot(candidates: string[]): string {
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

const PROMPT_RESOURCE_ROOT = resolvePromptResourceRoot([
  resolve(import.meta.dir, '../../../prompts'),
  resolve(import.meta.dir, 'prompts'),
  resolve(process.execPath, '..', 'prompts'),
]);

/** C-5：包内资源根的只读访问（校验器 / CLI 与解析链共用同一路径推导，避免重复实现） */
export function getPromptResourceRoot(): string {
  return PROMPT_RESOURCE_ROOT;
}

let _manifestKeys: { sections: Set<string>; tools: Set<string> } | null = null;

/** C-5：manifest 条目（校验器 / CLI 只读消费；`file` 相对资源根） */
export interface PromptManifestEntry {
  id: string;
  layer: string;
  kind: string;
  locale: string;
  file?: string;
  sha256?: string;
  reason?: string;
}

/**
 * C-5：读取包内 manifest（源语言 = 键范围唯一事实源）。
 * 缺失 / 解析失败 ⇒ `null`（调用方决定回退或报 `MANIFEST_MISSING`）。
 * `root` 可覆盖（校验器测试用），缺省包内资源根。
 */
export function readPromptManifest(
  locale = 'zh-CN',
  root = PROMPT_RESOURCE_ROOT
): PromptManifestEntry[] | null {
  const manifestPath = join(root, locale, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      entries?: PromptManifestEntry[];
    };
    return Array.isArray(raw.entries) ? raw.entries : null;
  } catch (error) {
    // @ignore-catch manifest 损坏 ⇒ null，由调用方按缺失处理
    logger.warning('prompt:manifest 解析失败', { error: String(error) });
    return null;
  }
}

/** C-5：条目 → 用户/项目覆盖的相对路径（系统段去 `sections/` 前缀，工具层原样） */
export function promptOverrideRel(entry: PromptManifestEntry): string {
  if (!entry.file) return '';
  return entry.layer === 'system' ? basename(entry.file) : entry.file;
}

/**
 * C-5：列出**实际存在的**用户 / 项目覆盖（`liri prompt diff` 的唯一数据来源）。
 * 不做内容校验（那是解析链的职责），只回答「哪些键被外置覆盖了」。
 */
export interface PromptOverrideHit {
  id: string;
  scope: 'user' | 'project';
  path: string;
  content: string;
}

export function listPromptOverrides(locale = 'zh-CN'): PromptOverrideHit[] {
  const entries = readPromptManifest();
  if (!entries) return [];

  const userDir = join(resolvePyappHome(), 'prompts');
  const projectDir = join(
    resolveProjectRoot(),
    WORKSPACE_CONFIG_DIR_NAME,
    'prompts'
  );
  const hits: PromptOverrideHit[] = [];

  for (const entry of entries) {
    const rel = promptOverrideRel(entry);
    if (!rel) continue;

    // 与解析链同序：locale 子目录优先，旧扁平路径兜底
    const userPath =
      [join(userDir, locale, rel), join(userDir, rel)].find((p) =>
        existsSync(p)
      ) ?? null;
    if (userPath) {
      hits.push({
        id: entry.id,
        scope: 'user',
        path: userPath,
        content: readSectionFile(userPath) ?? '',
      });
      continue;
    }

    const projectPath = join(projectDir, locale, rel);
    if (existsSync(projectPath)) {
      hits.push({
        id: entry.id,
        scope: 'project',
        path: projectPath,
        content: readSectionFile(projectPath) ?? '',
      });
    }
  }

  return hits;
}

/**
 * C-2/C-3：manifest 驱动键范围的**单次读取**（系统段 + 工具提示词）。
 *
 * - `sections` = `layer === 'system'` 的 `section:<name>` → `<name>`
 * - `tools` = `layer === 'tools'` 的 `tool:<ToolDir>/<Export>` 原样键
 * - manifest 读取失败 ⇒ `sections` 回退 infra `SECTION_NAMES`（与 manifest 同集，防启动期阻断）；
 *   `tools` 保持空集 ⇒ `resolveToolPrompt` 恒返回内置兜底（行为零变化，fail-safe）
 * 结果缓存（包内资源随包发布，进程内不变）。
 */
function getManifestKeys(): { sections: Set<string>; tools: Set<string> } {
  if (_manifestKeys) return _manifestKeys;
  const sections = new Set<string>();
  const tools = new Set<string>();
  for (const entry of readPromptManifest() ?? []) {
    if (entry.layer === 'system' && entry.id.startsWith('section:')) {
      sections.add(entry.id.slice('section:'.length));
    } else if (entry.layer === 'tools' && entry.id.startsWith('tool:')) {
      tools.add(entry.id);
    }
  }
  if (sections.size === 0) {
    for (const name of SECTION_NAMES) sections.add(name);
  }
  _manifestKeys = { sections, tools };
  return _manifestKeys;
}

// ─── C-2：母语回退链 ────────────────────────────────────────────────────────

/**
 * 资源缺失时的回退顺序。
 *
 * `en-US` 的段落/工具提示词（C-4）与 `tool-params.json`（C-3b）均已落地；
 * 若某键在 en-US 资源中缺失，`['en-US']` 不含 zh-CN ⇒ 直接落到**源码兜底**
 * （源码文本即 zh-CN 原文），与源语言行为一致，不会误读其它语言资源。
 */
const LOCALE_FALLBACKS: Record<string, readonly string[]> = {
  'zh-TW': ['zh-TW', 'zh-CN', 'en-US'],
  'zh-CN': ['zh-CN', 'en-US'],
  'en-US': ['en-US'],
  'ja-JP': ['ja-JP', 'en-US'],
  'ko-KR': ['ko-KR', 'en-US'],
};

function fallbackChain(locale: string): readonly string[] {
  return LOCALE_FALLBACKS[locale] ?? [locale, 'en-US'];
}

// ─── C-2：覆盖解析缓存（30s TTL，与 P3-10 缓存同寿命；TTL 到期即生效 ⇒「热更」同一验收） ───

const _overrideCache = new Map<
  string,
  { value: string | null; time: number }
>();

/** 读文件（非空校验）；不存在 / 空 / 不可读 ⇒ null（@ignore-catch 不可读等同无覆盖） */
function readSectionFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * C-2「覆盖后校验」：读到的覆盖内容须非空且 ≤ MAX_OVERRIDE_CHARS；
 * 违规 ⇒ warn（不静默吞）+ null（降级到链的下一级）。
 */
function validatedOverride(path: string): string | null {
  const content = readSectionFile(path);
  if (!content) return null;
  if (content.length > MAX_OVERRIDE_CHARS) {
    logger.warning('prompt:override 覆盖文件超长，忽略', {
      path,
      length: content.length,
      limit: MAX_OVERRIDE_CHARS,
    });
    return null;
  }
  return content;
}

/**
 * C-2：六级解析链（单段落 id）——
 * ① 用户覆盖 `~/.pyapp/prompts/<locale>/<id>.md`（旧扁平 `<id>.md` 兼容）
 * → ② 项目覆盖 `<workspace>/.liri/prompts/<locale>/<id>.md`
 * → ③ 演化覆盖：**无独立 IO** —— `promptEvolution` 段的内置 compute 直读受管
 *    overlay（`utils/promptEvolution`），即该级的现状实现；对其它段不生效
 * → ④ 包内资源 + ⑤ 母语回退（zh-TW→zh-CN→en-US）`app/prompts/<locale>/sections/<id>.md`
 * → ⑥ 内置兜底：返回 `fallback`（= 内置 compute 结果，由调用方承担）。
 *
 * 仅 manifest 键范围内的段可被覆盖（strategyExtra / localToolUse 等旁路段不进链）。
 * 结果按 `sys:<locale>:<id>` 缓存 30s：TTL 到期即生效，不重复写。
 */
export function resolvePrompt(
  sectionId: string,
  fallback: string,
  locale = 'zh-CN'
): string {
  if (!getManifestKeys().sections.has(sectionId)) return fallback;
  return resolveFromChain(
    `sys:${locale}:${sectionId}`,
    `${sectionId}.md`,
    join('sections', `${sectionId}.md`),
    fallback,
    locale
  );
}

/**
 * C-3：工具提示词解析（T2）—— 与 `resolvePrompt` 共用同一六级链与 30s TTL，
 * 仅相对路径不同（`tools/<ToolDir>/<Export>.md`）与键范围不同（manifest `layer === 'tools'`）。
 *
 * @param toolDir   工具目录名（= `app/src/tools/<ToolDir>`）
 * @param exportName `prompt.ts` 的导出名（如 `getDescription` / `FILE_EDIT_TOOL_PROMPT`）
 * @param fallback  内置兜底文本（= 源文件常量；包内资源缺失时原样返回 ⇒ 行为零变化）
 * @param locale    缺省取当前段落缓存 locale（与 `sectionCacheKey` 同一状态，避免两套 locale）
 */
export function resolveToolPrompt(
  toolDir: string,
  exportName: string,
  fallback: string,
  locale: string = getSectionCacheLocale()
): string {
  const id = `tool:${toolDir}/${exportName}`;
  if (!getManifestKeys().tools.has(id)) return fallback;
  // 工具层的覆盖路径与包内路径同构（`tools/<Dir>/<Export>.md`），无需像系统段那样区分
  const rel = join('tools', toolDir, `${exportName}.md`);
  return resolveFromChain(`tool:${locale}:${id}`, rel, rel, fallback, locale);
}

/**
 * 六级链 + 30s 缓存（`resolvePrompt` / `resolveToolPrompt` 的共同实现）。
 *
 * @param overrideRel 用户/项目覆盖的相对路径（系统段与 C-2 契约一致：`<id>.md`，
 *                    **不含** `sections/` 前缀 —— 改动会让已发布的覆盖文件静默失效）
 * @param bundledRel  包内资源的相对路径（系统段为 `sections/<id>.md`）
 */
function resolveFromChain(
  cacheKey: string,
  overrideRel: string,
  bundledRel: string,
  fallback: string,
  locale: string
): string {
  const now = Date.now();
  const hit = _overrideCache.get(cacheKey);
  if (hit && now - hit.time < PROMPT_VERSION_CACHE_TTL_MS) {
    return hit.value ?? fallback;
  }

  const value = walkPromptChain(overrideRel, bundledRel, locale);
  _overrideCache.set(cacheKey, { value, time: now });
  return value ?? fallback;
}

/**
 * 链实现（见 `resolvePrompt` JSDoc 的分级说明）；全部 miss ⇒ null（调用方用内置兜底）。
 * `overrideRel` 是用户/项目覆盖的相对路径；`bundledRel` 是包内资源的相对路径。
 */
function walkPromptChain(
  overrideRel: string,
  bundledRel: string,
  locale: string
): string | null {
  // ① 用户覆盖（locale 子目录优先，旧扁平路径兜底兼容 P3-10 存量数据）
  const userDir = join(resolvePyappHome(), 'prompts');
  const userOverride =
    validatedOverride(join(userDir, locale, overrideRel)) ??
    validatedOverride(join(userDir, overrideRel));
  if (userOverride) return userOverride;

  // ② 项目覆盖（.liri 名取 core/paths 的唯一事实源）
  const projectOverride = validatedOverride(
    join(
      resolveProjectRoot(),
      WORKSPACE_CONFIG_DIR_NAME,
      'prompts',
      locale,
      overrideRel
    )
  );
  if (projectOverride) return projectOverride;

  // ③ 演化覆盖 — 由 promptEvolution 段内置实现（见 resolvePrompt JSDoc）

  // ④⑤ 包内资源（母语回退链）
  for (const lang of fallbackChain(locale)) {
    const bundled = readSectionFile(
      join(PROMPT_RESOURCE_ROOT, lang, bundledRel)
    );
    if (bundled) return bundled;
  }

  // ⑥ 内置兜底
  return null;
}

// ─── C-3b / T2：工具级资源（参数描述 + 工具级描述）──────────────────────────

/** 工具级资源形态：`tool-params.json` 用 `params`；`tool-descriptions.json` 用 `descriptions` */
interface ToolParamResource {
  schemaVersion?: number;
  locale?: string;
  params?: Record<string, string>;
  descriptions?: Record<string, string>;
}

/**
 * 工具级资源文件清单（**单一真源**：解析链 / 校验器 / CLI 导出与 diff 共用）。
 * `field` 是 JSON 内承载 键→文本 映射的字段名。
 */
export const TOOL_RESOURCE_FILES = [
  { file: 'tool-params.json', field: 'params', label: '工具参数描述' },
  {
    file: 'tool-descriptions.json',
    field: 'descriptions',
    label: '工具级描述',
  },
] as const;

/** 工具级资源的**外置覆盖**命中（用户 / 项目） */
export interface ToolResourceOverrideHit {
  scope: 'user' | 'project';
  file: string;
  label: string;
  path: string;
  /** 覆盖文件里的键数（不可解析时 0） */
  count: number;
}

/**
 * 列出工具级资源（参数描述 / 工具级描述）的用户 / 项目覆盖。
 *
 * 为什么需要：解析链 ①② 支持这两份 JSON 的覆盖，但 `listPromptOverrides` 只扫 manifest
 * 登记的 `.md` ⇒ `prompt diff` 看不到它们。此处按同一覆盖目录推导（不复制解析链逻辑）。
 *
 * @param roots 覆盖目录（测试可注入；缺省 `~/.pyapp/prompts` 与 `<workspace>/.liri/prompts`）
 */
export function listToolResourceOverrides(
  locale = 'zh-CN',
  roots: { userDir?: string; projectDir?: string } = {}
): ToolResourceOverrideHit[] {
  const dirs: Array<{ scope: 'user' | 'project'; dir: string }> = [
    {
      scope: 'user',
      dir: roots.userDir ?? join(resolvePyappHome(), 'prompts'),
    },
    {
      scope: 'project',
      dir:
        roots.projectDir ??
        join(resolveProjectRoot(), WORKSPACE_CONFIG_DIR_NAME, 'prompts'),
    },
  ];

  const hits: ToolResourceOverrideHit[] = [];
  for (const { scope, dir } of dirs) {
    for (const resource of TOOL_RESOURCE_FILES) {
      const path = join(dir, locale, resource.file);
      if (!existsSync(path)) continue;
      const map = readToolResource(
        path,
        // 键含 path：不同覆盖目录（测试 / 切换 HOME）不得共用缓存
        `toolres:${scope}:${locale}:${resource.file}:${path}`
      );
      hits.push({
        scope,
        file: resource.file,
        label: resource.label,
        path,
        count: map ? Object.keys(map).length : 0,
      });
    }
  }
  return hits;
}

/** 工具级资源缓存（30s TTL，与段落覆盖同寿命） */
const _toolParamCache = new Map<
  string,
  { value: Record<string, string> | null; time: number }
>();

/** 读取一份工具级资源（`tool-params.json` / `tool-descriptions.json`；缺失或解析失败 ⇒ null；30s 缓存） */
function readToolResource(
  path: string,
  cacheKey: string
): Record<string, string> | null {
  const now = Date.now();
  const hit = _toolParamCache.get(cacheKey);
  if (hit && now - hit.time < PROMPT_VERSION_CACHE_TTL_MS) {
    return hit.value;
  }

  let value: Record<string, string> | null = null;
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as ToolParamResource;
      const entries = raw?.params ?? raw?.descriptions;
      if (entries && typeof entries === 'object') {
        value = entries;
      }
    } catch (error) {
      // @ignore-catch 资源损坏 ⇒ 视为无资源，回退源码描述
      logger.warning('prompt:工具级资源解析失败，回退源码描述', {
        path,
        error: String(error),
      });
    }
  }
  _toolParamCache.set(cacheKey, { value, time: now });
  return value;
}

/**
 * C-3b：解析工具**参数描述**（T2 字段级）—— 用户 → 项目 → 包内 → 母语回退 → 源码兜底。
 *
 * 资源形态：`prompts/<locale>/tool-params.json`（单文件，键 = `<toolName>.<paramPath>`）。
 * `paramPath` 支持嵌套：`items`（数组元素）/ `items.<key>`（元素对象字段）。
 *
 * 与整段提示词的差异：参数描述是**短文本**，且必须与 schema 的字段名一一对应，
 * 因此用 JSON 而非逐条 `.md`；`en-US` 未提供时回退 `zh-CN`（当前源码文本），行为零变化。
 *
 * @param toolName 工具 wire 名（如 `file_edit`）
 * @param paramPath 参数路径（如 `filePath` / `items.description`）
 * @param fallback 源码中的原描述（无资源时原样返回）
 */
export function resolveToolParam(
  toolName: string,
  paramPath: string,
  fallback: string,
  locale: string = getSectionCacheLocale()
): string {
  const key = `${toolName}.${paramPath}`;

  // ① 用户（locale 子目录）
  const userMap = readToolResource(
    join(resolvePyappHome(), 'prompts', locale, 'tool-params.json'),
    `toolparam:user:${locale}`
  );
  if (userMap?.[key]) return userMap[key];

  // ② 项目
  const projectMap = readToolResource(
    join(
      resolveProjectRoot(),
      WORKSPACE_CONFIG_DIR_NAME,
      'prompts',
      locale,
      'tool-params.json'
    ),
    `toolparam:project:${locale}`
  );
  if (projectMap?.[key]) return projectMap[key];

  // ③④ 包内 + 母语回退
  for (const lang of fallbackChain(locale)) {
    const bundledMap = readToolResource(
      join(PROMPT_RESOURCE_ROOT, lang, 'tool-params.json'),
      `toolparam:bundled:${lang}`
    );
    const hit = bundledMap?.[key];
    if (hit) return hit;
  }

  // ⑤ 源码兜底
  return fallback;
}

/**
 * T2 工具级描述解析（2026-10-18）—— 与参数描述同链、同 TTL、同回退语义：
 * 用户 → 项目 → 包内 → 母语回退 → **源码兜底**（`info.description` 原样返回）。
 *
 * 资源形态：`prompts/<locale>/tool-descriptions.json`（键 = 工具 wire 名）。
 *
 * 为什么集中在资源里而不逐工具改类：`getToolSchemas()` 是模型侧唯一出口，
 * 在此单点替换即可覆盖全部工具（避免 75 个类各自维护 getter 与 locale 时序，
 * 也避免与 S-P4 删除的 `*_TOOL_PROMPT` 重新绑定）。
 *
 * @param toolName 工具 wire 名（如 `file_edit`）
 * @param fallback 源码描述（无资源时原样返回 ⇒ 行为零变化）
 */
export function resolveToolDescription(
  toolName: string,
  fallback: string,
  locale: string = getSectionCacheLocale()
): string {
  // ① 用户（locale 子目录）
  const userMap = readToolResource(
    join(resolvePyappHome(), 'prompts', locale, 'tool-descriptions.json'),
    `tooldesc:user:${locale}`
  );
  if (userMap?.[toolName]) return userMap[toolName];

  // ② 项目
  const projectMap = readToolResource(
    join(
      resolveProjectRoot(),
      WORKSPACE_CONFIG_DIR_NAME,
      'prompts',
      locale,
      'tool-descriptions.json'
    ),
    `tooldesc:project:${locale}`
  );
  if (projectMap?.[toolName]) return projectMap[toolName];

  // ③④ 包内 + 母语回退
  for (const lang of fallbackChain(locale)) {
    const bundledMap = readToolResource(
      join(PROMPT_RESOURCE_ROOT, lang, 'tool-descriptions.json'),
      `tooldesc:bundled:${lang}`
    );
    const hit = bundledMap?.[toolName];
    if (hit) return hit;
  }

  // ⑤ 源码兜底
  return fallback;
}

/**
 * 获取所有追加段落（P3-10 语义不变：`custom.md` 追加到提示词末尾，无 locale 维度）
 */
export function getPromptAppendices(): string[] {
  const path = join(resolvePyappHome(), 'prompts', CUSTOM_APPENDIX_FILE);
  const content = readSectionFile(path);
  return content ? [content] : [];
}

/**
 * 清除覆盖解析缓存（含 C-2 六级链缓存）
 */
export function clearPromptCache(): void {
  _overrideCache.clear();
  _toolParamCache.clear();
}
