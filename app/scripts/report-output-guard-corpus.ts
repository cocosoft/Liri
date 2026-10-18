#!/usr/bin/env bun
/**
 * G-8（2026-10-18）—— `OUTPUT_GUARD` 前置条件**可观测报表**（非 CI 门禁）。
 *
 * 背景（清单 §6 G-8 / 评审门禁 `.trae/specs/default-off-switches-review-gates.md` §2-#1）：
 * 翻转 `OUTPUT_GUARD` 默认值的前置条件①②须**可观测**：
 *   ① 护栏接入点 ≥4，且含「流式 chunk / 工具回传 / 文件写入」；
 *   ② 本仓语料「会改写内容的文件数」≤5 且持续 ≥1 发布周期
 *      （§10.3 的 47 为 2026-10-07 实测基线；此前量化脚本取证后即删，本脚本固化为可复跑报表）。
 *
 * 口径（全部实测，禁推断）：
 *   - 接入点：扫 `app/src/**\/*.ts` 中 `getOutputGuardRegistry(` / `runRegisteredOutputGuards(`
 *     调用点，排除注册表定义（`core/outputGuard/`）、桶转出（`core/index.ts`）、
 *     组合根（`chat/outputGuards/`）；按文件路径标注类别（终稿 / 流式 chunk / 工具回传 / 文件写入）。
 *   - 语料 FP：`app/src` + `client/src` + `app/docs` 的 `**\/*.{ts,tsx,md}`，
 *     逐文件跑 `sensitiveDataService.sanitize()`（与护栏同源的打码器），文本变化即计为「会改写」；
 *     打印样本清单（默认前 20 条，供人工核对 FP/真阳性）。
 *
 * 用法（app 目录下）：`bun run report:output-guard-corpus`
 * **不作为 CI 门禁**（阈值是否达标属评审裁定，脚本只负责让读数可读）。
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { sensitiveDataService } from '../src/security/services/SensitiveDataService';

/** 仓库根（脚本位于 app/scripts/，上两级即仓根） */
const REPO_ROOT = join(__dirname, '..', '..');

/** 语料根（与 §10.3 同口径） */
const CORPUS_ROOTS = ['app/src', 'client/src', 'app/docs'];
/** 语料扩展名（与 §10.3 同口径） */
const CORPUS_EXTS = new Set(['.ts', '.tsx', '.md']);

/** 评审阈值（§2-#1①②） */
const MIN_ENTRY_POINTS = 4;
const MAX_REWRITE_FILES = 5;
/** 样本打印上限 */
const SAMPLE_LIMIT = 20;

// ---------------------------------------------------------------------------
// ① 接入点扫描
// ---------------------------------------------------------------------------

/** 接入点类别（评审口径要求的三类 + 既有终稿） */
type EntryKind = '终稿' | '流式 chunk' | '工具回传' | '文件写入' | '未归类';

interface EntryPoint {
  file: string;
  line: number;
  kind: EntryKind;
}

/** 按路径 + 行上下文归类（锚定 G-8 落点；新接入点若走新路径需在此登记） */
function classifyEntry(file: string, lineText: string): EntryKind {
  if (file.includes('streamMessageFlow')) {
    return lineText.includes('chunkOutputGuards') ? '流式 chunk' : '终稿';
  }
  if (file.includes('ChatOrchestrator')) return '终稿';
  if (file.includes('MessageService')) return '工具回传';
  if (file.includes('FileWriteTool') || file.includes('FileEditTool')) {
    return '文件写入';
  }
  return '未归类';
}

/** 注释行不计入接入点（如 `finalOutputGuard.ts` 头注对注入方式的描述） */
function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  );
}

/** 排除：注册表定义 / 桶转出 / 组合根（非执行接入点） */
function isEntryExcluded(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  return (
    norm.includes('core/outputGuard/') ||
    norm.endsWith('core/index.ts') ||
    norm.includes('chat/outputGuards/')
  );
}

function scanEntryPoints(): EntryPoint[] {
  const srcRoot = join(REPO_ROOT, 'app', 'src');
  const out: EntryPoint[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
        continue;
      }
      if (!ent.isFile() || !p.endsWith('.ts')) continue;
      const rel = relative(REPO_ROOT, p);
      if (isEntryExcluded(rel)) continue;
      const lines = readFileSync(p, 'utf-8').split('\n');
      lines.forEach((lineText, idx) => {
        if (isCommentLine(lineText.trim())) return;
        if (
          lineText.includes('getOutputGuardRegistry(') ||
          lineText.includes('runRegisteredOutputGuards(')
        ) {
          out.push({
            file: rel.replace(/\\/g, '/'),
            line: idx + 1,
            kind: classifyEntry(rel.replace(/\\/g, '/'), lineText),
          });
        }
      });
    }
  };
  walk(srcRoot);
  return out;
}

// ---------------------------------------------------------------------------
// ② 语料 FP 扫描
// ---------------------------------------------------------------------------

function collectCorpusFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        // 与 §10.3 同口径：不排除 __tests__；但排除构建产物与依赖目录
        if (ent.name === 'node_modules' || ent.name === 'dist') continue;
        walk(p);
        continue;
      }
      if (!ent.isFile()) continue;
      const dot = ent.name.lastIndexOf('.');
      if (dot < 0) continue;
      if (CORPUS_EXTS.has(ent.name.slice(dot))) out.push(p);
    }
  };
  for (const root of CORPUS_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const entryPoints = scanEntryPoints();
const corpusFiles = collectCorpusFiles();

const rewritten: string[] = [];
for (const file of corpusFiles) {
  let content: string;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }
  if (sensitiveDataService.sanitize(content) !== content) {
    rewritten.push(relative(REPO_ROOT, file).replace(/\\/g, '/'));
  }
}

const kinds = new Set(entryPoints.map((e) => e.kind));
const requiredKinds: EntryKind[] = ['流式 chunk', '工具回传', '文件写入'];
const missingKinds = requiredKinds.filter((k) => !kinds.has(k));

console.log('============================================================');
console.log('G-8 · OUTPUT_GUARD 前置条件可观测报表');
console.log('============================================================');
console.log('');
console.log(`① 护栏接入点（阈值 ≥${MIN_ENTRY_POINTS} 且三类齐全）`);
console.log(`   实测接入点数：${entryPoints.length}`);
for (const e of entryPoints) {
  console.log(`     [${e.kind}] ${e.file}:${e.line}`);
}
console.log(
  `   类别覆盖：${[...kinds].join(' / ') || '(无)'}` +
    (missingKinds.length > 0 ? `；缺：${missingKinds.join(' / ')}` : '')
);
console.log(
  `   判定：${
    entryPoints.length >= MIN_ENTRY_POINTS && missingKinds.length === 0
      ? '达标'
      : '未达标'
  }`
);
console.log('');
console.log(
  `② 语料 FP 改写（阈值 ≤${MAX_REWRITE_FILES} 文件，持续 ≥1 发布周期）`
);
console.log(`   语料文件总数：${corpusFiles.length}`);
console.log(
  `   会改写内容的文件数：${rewritten.length}` +
    `（改写面 ${((rewritten.length / Math.max(corpusFiles.length, 1)) * 100).toFixed(2)}%；` +
    ` 2026-10-07 基线 47）`
);
console.log(
  `   判定：${rewritten.length <= MAX_REWRITE_FILES ? '达标' : '未达标'}`
);
if (rewritten.length > 0) {
  console.log(`   样本（前 ${SAMPLE_LIMIT} 条，供人工核对 FP/真阳性）：`);
  for (const f of rewritten.slice(0, SAMPLE_LIMIT)) {
    console.log(`     ${f}`);
  }
  if (rewritten.length > SAMPLE_LIMIT) {
    console.log(`     … 其余 ${rewritten.length - SAMPLE_LIMIT} 条略`);
  }
}
console.log('');
console.log('（本报表只观测读数；默认值不变，翻转属评审 + 用户裁定。）');
process.exit(0);
