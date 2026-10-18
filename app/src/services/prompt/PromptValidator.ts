/**
 * C-5（2026-10-18）提示词资源校验器 —— **单一实现**。
 *
 * 被以下消费方共用（避免四处各写一份校验逻辑）：
 * - `scripts/lint-prompt-parity.ts` / `lint-prompt-budget.ts` / `lint-prompt-t1.ts`
 * - `liri prompt validate`
 * - `tests/prompt-locale/*`
 *
 * 校验项（对应清单 §4 C-5「校验器」）：
 * - **manifest ↔ 目录**：条目文件存在、目录无多余产物（源语言）；
 * - **locale 覆盖度**：目标 locale 逐条存在且非空、目录无多余产物；
 * - **占位符守恒**：`{command}` / `${toolName}` 等不得丢（`PLACEHOLDER_MISSING` 为 error）；
 * - **T1 标签守恒**：工具 wire 名 / `<think>` / `[FILE_OPERATION]` / `<create|modify|delete>`
 *   不得被翻译（`T1_MISSING` 为 error）；
 * - **长度阈值**：目标 locale 的 token 估算 > 1.5× 源 ⇒ warning，> 2× ⇒ error。
 *
 * 口径说明：长度按 **token 估算**而非字符数 —— 中文 1 字 ≈ 1.2-1.5 token，
 * 英文 ~4 字符 ≈ 1 token；按字符比较会得出 2.2-3.0× 的假超标（C-4 实测）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  getPromptResourceRoot,
  readPromptManifest,
  TOOL_RESOURCE_FILES,
} from './PromptVersionManager';

/** T1：工具 wire 名（禁译） */
export const PROMPT_T1_TOOL_NAMES: readonly string[] = [
  'read_file',
  'write_file',
  'edit_file',
  'grep',
  'glob',
  'bash',
  'web_search',
  'web_fetch',
  'todo_write',
  'ask_user_question',
  'save_conversation',
  'knowledge_save',
  'create_project',
  'write_project_file',
  'doc_generate',
  'file_write',
  'file_convert',
  'pdf',
];

/** T1：协议标签 / 枚举（禁译） */
export const PROMPT_T1_TAGS: readonly string[] = [
  '<think>',
  '</think>',
  '[FILE_OPERATION]',
  '<create|modify|delete>',
];

export type PromptIssueCode =
  | 'MANIFEST_MISSING'
  | 'FILE_MISSING'
  | 'FILE_ORPHAN'
  | 'FILE_EMPTY'
  | 'PLACEHOLDER_MISSING'
  | 'PLACEHOLDER_EXTRA'
  | 'T1_MISSING'
  | 'T1_EXTRA'
  | 'LENGTH_RATIO'
  /** C-5：T1 协议文件出现 localize 调用（`t(` / `resolvePrompt(`）—— 由 t1 门禁源码扫描产生 */
  | 'T1_LOCALIZED'
  /** C-5：源码仍硬编码提示词正文（由 hardcoded 门禁上报，降噪期不阻断） */
  | 'HARDCODED_PROMPT'
  /** C-3b/T2：工具级资源（`tool-params.json` / `tool-descriptions.json`）问题 */
  | 'TOOL_RESOURCE_MISSING'
  | 'TOOL_RESOURCE_INVALID'
  | 'TOOL_KEY_DRIFT'
  | 'TOOL_VALUE_EMPTY'
  | 'TOOL_VALUE_UNTRANSLATED'
  | 'TOOL_PLACEHOLDER_MISSING'
  | 'TOOL_T1_MISSING';

export interface PromptIssue {
  code: PromptIssueCode;
  severity: 'error' | 'warning';
  /** manifest id（如 `section:identity`）或相对文件路径 */
  entry: string;
  message: string;
}

export interface ValidatePromptOptions {
  /** 资源根（缺省 `app/prompts`；测试可指向临时目录） */
  root?: string;
  /** 源语言（键范围事实源） */
  sourceLocale?: string;
  /** 待校验 locale（缺省：root 下除源语言外、含 `sections/` 的目录） */
  locales?: readonly string[];
  /** 长度比告警阈值（token 口径） */
  warnRatio?: number;
  /** 长度比拒绝阈值（token 口径） */
  rejectRatio?: number;
}

export interface ValidatePromptResult {
  issues: PromptIssue[];
  /** 实际校验的 locale（便于 CLI 打印） */
  locales: readonly string[];
}

/** 近似 token 估算（CJK 1 字 ≈ 1.5 token；拉丁 ~4 字符 ≈ 1 token） */
export function estimatePromptTokens(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? [])
    .length;
  const latin = text.length - cjk;
  return Math.round(cjk * 1.5 + latin / 4);
}

/** 占位符集合：`{word}` / `${word}`（含 snake_case / 点号） */
export function extractPromptPlaceholders(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /\$\{([A-Za-z_][\w.]*)\}|\{([A-Za-z_][\w.]*)\}/g
  )) {
    out.add(m[1] ?? m[2]);
  }
  return out;
}

/** T1 协议文本集合（工具名 + 标签） */
export function extractPromptT1Markers(text: string): Set<string> {
  const found = new Set<string>();
  for (const name of PROMPT_T1_TOOL_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(text)) found.add(name);
  }
  for (const tag of PROMPT_T1_TAGS) {
    if (text.includes(tag)) found.add(tag);
  }
  return found;
}

/** 递归列出目录下所有 `.md`（返回带 `/` 的相对路径，已排序） */
export function listPromptMdFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...listPromptMdFiles(full, base));
    } else if (name.name.endsWith('.md')) {
      out.push(relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8').trim() : '';
}

/** root 下可作为「目标 locale」的目录（含 `sections/`，且非源语言） */
function discoverLocales(root: string, sourceLocale: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        d.name !== sourceLocale &&
        existsSync(join(root, d.name, 'sections'))
    )
    .map((d) => d.name)
    .sort();
}

/** 校验单对 locale 的占位符 / T1 / 长度（返回 issue；不抛错） */
function validatePair(
  sourceText: string,
  targetText: string,
  entryId: string,
  warnRatio: number,
  rejectRatio: number
): PromptIssue[] {
  const issues: PromptIssue[] = [];

  const sourcePlaceholders = extractPromptPlaceholders(sourceText);
  const targetPlaceholders = extractPromptPlaceholders(targetText);
  for (const p of sourcePlaceholders) {
    if (!targetPlaceholders.has(p)) {
      issues.push({
        code: 'PLACEHOLDER_MISSING',
        severity: 'error',
        entry: entryId,
        message: `占位符 {${p}} 在译文中缺失`,
      });
    }
  }
  for (const p of targetPlaceholders) {
    if (!sourcePlaceholders.has(p)) {
      issues.push({
        code: 'PLACEHOLDER_EXTRA',
        severity: 'warning',
        entry: entryId,
        message: `译文含源文没有的占位符 {${p}}`,
      });
    }
  }

  const sourceT1 = extractPromptT1Markers(sourceText);
  const targetT1 = extractPromptT1Markers(targetText);
  for (const marker of sourceT1) {
    if (!targetT1.has(marker)) {
      issues.push({
        code: 'T1_MISSING',
        severity: 'error',
        entry: entryId,
        message: `T1 协议标记 ${marker} 在译文中缺失（禁译）`,
      });
    }
  }
  for (const marker of targetT1) {
    if (!sourceT1.has(marker)) {
      issues.push({
        code: 'T1_EXTRA',
        severity: 'warning',
        entry: entryId,
        message: `译文含源文没有的 T1 标记 ${marker}`,
      });
    }
  }

  const sourceTokens = estimatePromptTokens(sourceText);
  const targetTokens = estimatePromptTokens(targetText);
  if (sourceTokens > 0) {
    const ratio = targetTokens / sourceTokens;
    if (ratio > rejectRatio) {
      issues.push({
        code: 'LENGTH_RATIO',
        severity: 'error',
        entry: entryId,
        message: `token 比 ${ratio.toFixed(2)}× > 拒绝阈值 ${rejectRatio}×`,
      });
    } else if (ratio > warnRatio) {
      issues.push({
        code: 'LENGTH_RATIO',
        severity: 'warning',
        entry: entryId,
        message: `token 比 ${ratio.toFixed(2)}× > 告警阈值 ${warnRatio}×`,
      });
    }
  }

  return issues;
}

// ─── C-3b / T2：工具级资源（`tool-params.json` / `tool-descriptions.json`）───

// 文件清单与字段名：单一真源在 PromptVersionManager（解析链 / 校验器 / CLI 共用）

/** VFS / URL 标识符（authority 可能含中文，属 T1 禁译）—— 判 CJK 前剔除 */
const TOOL_RESOURCE_VFS_RE = /[a-zA-Z][\w+.-]*:\/\/\S*/g;

/** 目标语言是否残留未翻译中文（已排除 VFS/URL 标识符） */
function hasUntranslatedCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(
    text.replace(TOOL_RESOURCE_VFS_RE, '')
  );
}

interface ToolResourceFile {
  params?: Record<string, string>;
  descriptions?: Record<string, string>;
}

/** 读取工具级资源；返回 `null` 表示文件缺失或不可解析 */
function readToolResourceMap(
  path: string,
  field: 'params' | 'descriptions'
): { ok: boolean; map: Record<string, string> | null } {
  if (!existsSync(path)) return { ok: false, map: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as ToolResourceFile;
    const map = raw?.[field];
    return map && typeof map === 'object'
      ? { ok: true, map }
      : { ok: false, map: null };
  } catch {
    // @ignore-catch 解析失败由调用方转成 TOOL_RESOURCE_INVALID（校验器不抛错）
    return { ok: false, map: null };
  }
}

/** 把键集合差/空值/中文残留汇总成少量 issue（避免 359 条逐条刷屏） */
function validateToolResource(
  root: string,
  sourceLocale: string,
  locale: string,
  resource: (typeof TOOL_RESOURCE_FILES)[number]
): PromptIssue[] {
  const issues: PromptIssue[] = [];
  const sourcePath = join(root, sourceLocale, resource.file);
  const source = readToolResourceMap(sourcePath, resource.field);

  if (!existsSync(sourcePath)) {
    issues.push({
      code: 'TOOL_RESOURCE_MISSING',
      severity: 'error',
      entry: `${sourceLocale}/${resource.file}`,
      message: `${resource.label}源资源缺失（键范围事实源）`,
    });
    return issues;
  }
  if (!source.ok || !source.map) {
    issues.push({
      code: 'TOOL_RESOURCE_INVALID',
      severity: 'error',
      entry: `${sourceLocale}/${resource.file}`,
      message: `${resource.label}源资源不可解析（需含 \`${resource.field}\` 对象）`,
    });
    return issues;
  }

  // 源语言自身：存在 + 可解析已校验，无需再做译文对照
  if (locale === sourceLocale) return issues;

  const targetPath = join(root, locale, resource.file);
  if (!existsSync(targetPath)) {
    issues.push({
      code: 'TOOL_RESOURCE_MISSING',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message: `${resource.label}译文缺失`,
    });
    return issues;
  }
  const target = readToolResourceMap(targetPath, resource.field);
  if (!target.ok || !target.map) {
    issues.push({
      code: 'TOOL_RESOURCE_INVALID',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message: `${resource.label}译文不可解析（需含 \`${resource.field}\` 对象）`,
    });
    return issues;
  }

  const sourceKeys = Object.keys(source.map);
  const targetMap = target.map;
  const missing = sourceKeys.filter((key) => !(key in targetMap));
  const extra = Object.keys(targetMap).filter((key) => !(key in source.map!));
  if (missing.length > 0 || extra.length > 0) {
    issues.push({
      code: 'TOOL_KEY_DRIFT',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message:
        `键集与源语言不一致：缺 ${missing.length} 条` +
        `${missing.length ? `（${missing.slice(0, 3).join(', ')}…）` : ''}` +
        `，多 ${extra.length} 条` +
        `${extra.length ? `（${extra.slice(0, 3).join(', ')}…）` : ''}`,
    });
  }

  const empty = sourceKeys.filter((key) => !targetMap[key]?.trim());
  if (empty.length > 0) {
    issues.push({
      code: 'TOOL_VALUE_EMPTY',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message: `空译文 ${empty.length} 条（${empty.slice(0, 3).join(', ')}…）`,
    });
  }

  const untranslated = sourceKeys.filter(
    (key) => targetMap[key] && hasUntranslatedCjk(targetMap[key])
  );
  if (untranslated.length > 0) {
    issues.push({
      code: 'TOOL_VALUE_UNTRANSLATED',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message: `残留中文 ${untranslated.length} 条（${untranslated.slice(0, 3).join(', ')}…）`,
    });
  }

  // 占位符 / T1 协议标识同理：源文出现 ⇒ 译文必须保留（禁译/禁删）。
  // 聚合上报（每条类别一个 issue + 样例），与键集/空值/中文残留同口径。
  const placeholderMissing: string[] = [];
  const t1Missing: string[] = [];
  for (const key of sourceKeys) {
    const sourceText = source.map![key];
    const targetText = targetMap[key];
    if (!targetText) continue;

    const sourcePlaceholders = extractPromptPlaceholders(sourceText);
    if (sourcePlaceholders.size > 0) {
      const targetPlaceholders = extractPromptPlaceholders(targetText);
      const missing = [...sourcePlaceholders].filter(
        (p) => !targetPlaceholders.has(p)
      );
      if (missing.length > 0) placeholderMissing.push(`${key}(${missing})`);
    }

    const sourceT1 = extractPromptT1Markers(sourceText);
    if (sourceT1.size > 0) {
      const targetT1 = extractPromptT1Markers(targetText);
      const missing = [...sourceT1].filter((m) => !targetT1.has(m));
      if (missing.length > 0) t1Missing.push(`${key}(${missing})`);
    }
  }
  if (placeholderMissing.length > 0) {
    issues.push({
      code: 'TOOL_PLACEHOLDER_MISSING',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message:
        `占位符缺失 ${placeholderMissing.length} 条` +
        `（${placeholderMissing.slice(0, 3).join('；')}…）`,
    });
  }
  if (t1Missing.length > 0) {
    issues.push({
      code: 'TOOL_T1_MISSING',
      severity: 'error',
      entry: `${locale}/${resource.file}`,
      message:
        `T1 协议标识缺失 ${t1Missing.length} 条` +
        `（${t1Missing.slice(0, 3).join('；')}…）`,
    });
  }

  return issues;
}

/**
 * 校验提示词资源。返回**全部**问题（含 warning），由各门禁按 code/severity 过滤。
 */
export function validatePromptResources(
  options: ValidatePromptOptions = {}
): ValidatePromptResult {
  const root = options.root ?? getPromptResourceRoot();
  const sourceLocale = options.sourceLocale ?? 'zh-CN';
  const warnRatio = options.warnRatio ?? 1.5;
  const rejectRatio = options.rejectRatio ?? 2;
  const locales = options.locales ?? discoverLocales(root, sourceLocale);
  const issues: PromptIssue[] = [];

  const manifest = readPromptManifest(sourceLocale, root);
  if (!manifest) {
    return {
      issues: [
        {
          code: 'MANIFEST_MISSING',
          severity: 'error',
          entry: `${sourceLocale}/manifest.json`,
          message: 'manifest.json 缺失或不可解析（键范围事实源）',
        },
      ],
      locales,
    };
  }

  // 只校验有实体文件的条目（dynamic 段只有 id + reason）
  const fileEntries = manifest.filter((e) => !!e.file);
  const expected = new Set(fileEntries.map((e) => e.file!));

  // ⓪ 工具级资源（C-3b / T2）：源语言存在性 + 每个目标 locale 的键集/空值/中文残留。
  // 与 manifest 无关（键范围来自同名字源文件），因此放在文件对照之前。
  for (const resource of TOOL_RESOURCE_FILES) {
    issues.push(
      ...validateToolResource(root, sourceLocale, sourceLocale, resource)
    );
    for (const locale of locales) {
      if (locale === sourceLocale) continue;
      issues.push(
        ...validateToolResource(root, sourceLocale, locale, resource)
      );
    }
  }

  // ① 源语言：条目文件存在且非空 + 目录无多余产物
  for (const entry of fileEntries) {
    const path = join(root, sourceLocale, entry.file!);
    const text = readText(path);
    if (!existsSync(path)) {
      issues.push({
        code: 'FILE_MISSING',
        severity: 'error',
        entry: entry.id,
        message: `源文件缺失：${sourceLocale}/${entry.file}`,
      });
    } else if (!text) {
      issues.push({
        code: 'FILE_EMPTY',
        severity: 'error',
        entry: entry.id,
        message: `源文件为空：${sourceLocale}/${entry.file}`,
      });
    }
  }
  for (const [subdir, prefix] of [
    ['sections', 'sections/'],
    ['tools', 'tools/'],
  ] as const) {
    for (const rel of listPromptMdFiles(join(root, sourceLocale, subdir))) {
      if (!expected.has(`${prefix}${rel}`)) {
        issues.push({
          code: 'FILE_ORPHAN',
          severity: 'warning',
          entry: `${sourceLocale}/${prefix}${rel}`,
          message: '目录中存在 manifest 未登记的文件',
        });
      }
    }
  }

  // ② 目标 locale：覆盖度 + 逐条对照
  for (const locale of locales) {
    for (const entry of fileEntries) {
      const rel = entry.file!;
      const targetPath = join(root, locale, rel);
      const targetText = readText(targetPath);
      if (!existsSync(targetPath)) {
        issues.push({
          code: 'FILE_MISSING',
          severity: 'error',
          entry: entry.id,
          message: `译文缺失：${locale}/${rel}`,
        });
        continue;
      }
      if (!targetText) {
        issues.push({
          code: 'FILE_EMPTY',
          severity: 'error',
          entry: entry.id,
          message: `译文为空：${locale}/${rel}`,
        });
        continue;
      }
      const sourceText = readText(join(root, sourceLocale, rel));
      issues.push(
        ...validatePair(
          sourceText,
          targetText,
          entry.id,
          warnRatio,
          rejectRatio
        )
      );
    }

    for (const [subdir, prefix] of [
      ['sections', 'sections/'],
      ['tools', 'tools/'],
    ] as const) {
      for (const rel of listPromptMdFiles(join(root, locale, subdir))) {
        if (!expected.has(`${prefix}${rel}`)) {
          issues.push({
            code: 'FILE_ORPHAN',
            severity: 'warning',
            entry: `${locale}/${prefix}${rel}`,
            message: '译文目录中存在源 manifest 未登记的文件',
          });
        }
      }
    }
  }

  return { issues, locales };
}

/** 统一的文本输出（`liri prompt validate` 与各 lint 脚本共用） */
export function formatPromptIssues(issues: readonly PromptIssue[]): string {
  if (issues.length === 0) return '✓ 提示词资源校验通过（0 issue）';
  return issues
    .map(
      (i) =>
        `${i.severity === 'error' ? '✗' : '⚠'} [${i.code}] ${i.entry}\n    ${i.message}`
    )
    .join('\n');
}
