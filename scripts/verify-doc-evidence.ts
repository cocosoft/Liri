/**
 * 文档证据核验器 (Doc Evidence Verifier) — D6 文档防腐机制
 *
 * 背景：《Liri 缺陷查补计划》D6 —— 仓库内的评估/分析文档常带 `路径:行号` 论断，
 * 代码一改这些论断就变成**错误结论**，而文档仍被读者（含 AI）当事实引用。
 * 本脚本把"文档结论必须可复核"从人工纪律升级为**可自动校验的机制**。
 *
 * 用法（工作目录 = 仓库根，或由 LIRI_PROJECT_DIR 指定）：
 *   bun run scripts/verify-doc-evidence.ts
 *   bun run scripts/verify-doc-evidence.ts --fix-banner     # 对核验失败的文档自动打"已过期"横幅
 *   bun run scripts/verify-doc-evidence.ts --symbols        # 额外校验"行内标识符是否仍在被引文件中"
 *   bun run scripts/verify-doc-evidence.ts --paths=app/src/docs,app/docs
 *   cd app; bun run verify:docs                             # 等价入口（npm script）
 *
 * **证据形态**（只有这类引用才判 FAIL，避免把普通链接/示例路径误判为失效证据）：
 *   A. 带显式行号：`path/to/file.ts:123`（或 `:123-145`）—— 默认口径
 *   B. 带仓库顶层前缀：`app/...`、`client/...`、`scripts/...`、`.trae/...`、`dev_docs/...` —— 仅 `--strict` 时算证据
 * 其余（裸文件名、`./x.md`、教程占位路径等）先按"文档所在目录"解析，再查同名索引；未解析计 SKIP/WARN（非证据、不阻断）。
 *
 * 判定级别：
 *   FAIL  — 证据形态引用无法定位（文件不存在）或行号超出文件范围（硬失效）
 *   WARN  — 路径形态引用无法定位（疑似失效，但不足以判定为证据）；或 --symbols 下标识符全部消失
 *   SKIP  — 裸名/相对链接未解析（普通文档互链、示例路径）
 *   退出码：0 = 无 FAIL（WARN 仅提示）；1 = 存在 FAIL；2 = 待检查目录为空（空转守卫，绝不报"通过"）
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";

// ============ 配置 ============

/** 默认待核验文档目录（仓库相对路径） */
const DEFAULT_DOC_DIRS = ["app/src/docs", "app/docs"];
/** 兜底解析"裸文件名"时的源码搜索根 */
const SOURCE_ROOTS = [
  "app/src",
  "app/native/src",
  "client/src",
  "scripts",
  "src",
];
/** 视作"仓库顶层前缀"的证据形态前缀 */
const REPO_PREFIXES = [
  "app/",
  "client/",
  "scripts/",
  "src/",
  ".trae/",
  "dev_docs/",
];
/** 排除目录 */
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  "build",
  ".trae",
]);
/** 证据引用正则：路径（可含目录）+ 可选 `:行` 或 `:起-止` */
const EVIDENCE_PATTERN = new RegExp(
  `([A-Za-z0-9_@\\-./\\\\]+\\.(?:ts|tsx|mjs|cjs|jsx|jsonl|json|ya?ml|js|md|rs|py|sh|toml))(?:[:#](\\d+)(?:\\s*[-–~]\\s*(\\d+))?)?`,
  "g",
);
/** 行内标识符（用于 --symbols 校验） */
const IDENTIFIER_PATTERN = /`([A-Za-z_][A-Za-z0-9_]{3,})`/g;
/** 横幅标记（幂等更新用） */
const BANNER_MARKER = "<!-- verify-doc-evidence:banner -->";

// ============ 类型定义 ============

type RefKind = "evidence" | "path" | "loose";

interface RefResult {
  raw: string;
  line: number;
  /** 文档中的行号（1 起） */
  docLine: number;
  kind: RefKind;
  resolved?: string;
  status: "ok" | "fail" | "warn" | "skip";
  detail?: string;
}

interface DocResult {
  doc: string;
  refs: RefResult[];
  failCount: number;
  warnCount: number;
}

// ============ 参数解析 ============

const argv = process.argv.slice(2);
const fixBanner = argv.includes("--fix-banner");
const checkSymbols = argv.includes("--symbols");
const strictMode = argv.includes("--strict");
const pathsArg = argv.find((a) => a.startsWith("--paths="));
const docDirs = pathsArg
  ? pathsArg
      .slice("--paths=".length)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
  : DEFAULT_DOC_DIRS;

const rootDir = (process.env.LIRI_PROJECT_DIR || process.cwd()).replace(
  /\\/g,
  "/",
);

// ============ 工具函数 ============

function toAbs(p: string): string {
  return join(rootDir, p);
}

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}

function relFromRoot(p: string): string {
  return norm(relative(rootDir, p));
}

/** 递归收集 markdown 文档 */
function collectMarkdown(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collectMarkdown(full, out);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push(norm(full));
    }
  }
}

/** 递归收集文件 → basename 索引（兜底解析裸文件名；含文档目录，便于解析文档互链） */
function buildBasenameIndex(extraDirs: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        walk(full);
      } else {
        const list = index.get(entry.name) ?? [];
        list.push(norm(full));
        index.set(entry.name, list);
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(toAbs(root));
  for (const docDir of extraDirs) walk(toAbs(docDir));
  return index;
}

/**
 * 判定引用形态：只有 evidence 形态才会判 FAIL
 *
 * 默认口径（低误报）：**带显式行号**才算证据 —— 教程/示例文档里的路径（如 `src/tools/MyTool/MyTool.ts`）
 * 往往是有意为之的占位示例，不应被当作失效证据。需要更严口径时用 `--strict`
 * （把仓库顶层前缀的路径也算证据）。
 */
function classifyRef(raw: string, startLine?: number): RefKind {
  const normalized = norm(raw);
  // 模块别名（@modules/... 等）是导入标识符，不是文件系统路径
  if (normalized.startsWith("@")) return "loose";
  if (startLine !== undefined) return "evidence";
  const hasRepoPrefix = REPO_PREFIXES.some((p) => normalized.startsWith(p));
  if (strictMode && hasRepoPrefix) return "evidence";
  if (hasRepoPrefix) return "path";
  if (normalized.includes("/") && !normalized.startsWith("./")) return "path";
  return "loose";
}

/** 解析引用到真实文件 */
function resolveRef(
  raw: string,
  docDir: string,
  basenameIndex: Map<string, string[]>,
): { path?: string; ambiguous?: boolean } {
  const normalized = norm(raw).replace(/^\.\//, "");
  const candidates = [
    join(docDir, normalized), // 文档同目录（markdown 链接语义）
    toAbs(normalized),
    toAbs(join("app/src", normalized)),
    toAbs(join("app", normalized)),
  ];
  for (const candidate of candidates) {
    const c = norm(candidate);
    if (existsSync(c)) return { path: c };
  }
  const hits = basenameIndex.get(basename(normalized)) ?? [];
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length > 1) return { ambiguous: true };
  return {};
}

function countLines(file: string): number {
  return readFileSync(file, "utf-8").split("\n").length;
}

// ============ 核验单篇 ============

function verifyDoc(
  docPath: string,
  basenameIndex: Map<string, string[]>,
): DocResult {
  const content = readFileSync(docPath, "utf-8");
  const lines = content.split("\n");
  const docDir = dirname(docPath);
  const refs: RefResult[] = [];
  const seen = new Set<string>();

  lines.forEach((lineText, idx) => {
    // 先剔除 URL 与 `~` 家目录路径：它们不是仓库内证据，
    // 否则 https://bun.sh 会被匹配成 `//bun.sh`、~/.pyapp 会被匹配成 `/.py`
    const sanitized = lineText
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/~[\\/]/g, " ");

    for (const match of sanitized.matchAll(EVIDENCE_PATTERN)) {
      const raw = match[1];
      const startLine = match[2] ? parseInt(match[2], 10) : undefined;
      const key = `${raw}:${startLine ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const kind = classifyRef(raw, startLine);
      const ref: RefResult = {
        raw,
        line: startLine ?? 0,
        docLine: idx + 1,
        kind,
        status: "ok",
      };
      const { path: resolved, ambiguous } = resolveRef(
        raw,
        docDir,
        basenameIndex,
      );

      if (ambiguous) {
        ref.status = "skip";
        ref.detail = "同名文件多个，无法判定（建议写全路径）";
        refs.push(ref);
        continue;
      }
      if (!resolved) {
        // 形态决定严重度：证据形态 FAIL；路径形态 WARN；裸名/相对链接 SKIP
        if (kind === "evidence") {
          ref.status = "fail";
          ref.detail = "被引文件不存在";
        } else if (kind === "path") {
          ref.status = "warn";
          ref.detail = "无法定位（疑似失效引用，亦可能为示例路径）";
        } else {
          ref.status = "skip";
          ref.detail = "未解析（普通链接/示例路径）";
        }
        refs.push(ref);
        continue;
      }
      ref.resolved = relFromRoot(resolved);

      if (startLine !== undefined) {
        const total = countLines(resolved);
        if (startLine > total) {
          ref.status = "fail";
          ref.detail = `引用行号 ${startLine} 超出文件范围（当前共 ${total} 行）`;
          refs.push(ref);
          continue;
        }
      }

      if (checkSymbols) {
        const identifiers = [...lineText.matchAll(IDENTIFIER_PATTERN)].map(
          (m) => m[1],
        );
        const fileText = readFileSync(resolved, "utf-8");
        const found = identifiers.filter((id) => fileText.includes(id));
        if (identifiers.length > 0 && found.length === 0) {
          ref.status = "warn";
          ref.detail = `行内标识符（${identifiers.join(", ")}）在被引文件中均未找到`;
        }
      }
      refs.push(ref);
    }
  });

  return {
    doc: docPath,
    refs,
    failCount: refs.filter((r) => r.status === "fail").length,
    warnCount: refs.filter((r) => r.status === "warn").length,
  };
}

/** 幂等写入/更新"已过期"横幅（紧跟 H1 标题之后） */
function upsertBanner(docPath: string, failCount: number): void {
  const content = readFileSync(docPath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  const banner = `${BANNER_MARKER}\n> ⚠️ **证据核验失败：${failCount} 处引用已失效（核验日期 ${today}）** —— 本文件为历史快照，结论可能已过期；引用前请回源核对，失败明细见 \`bun run verify:docs\`。`;

  const lines = content.split("\n");
  const bannerStart = lines.findIndex((l) => l.includes(BANNER_MARKER));
  if (bannerStart >= 0) {
    let end = bannerStart + 1;
    while (end < lines.length && lines[end].trim() !== "") end++;
    const next = [
      ...lines.slice(0, bannerStart),
      ...banner.split("\n"),
      ...lines.slice(end),
    ];
    writeFileSync(docPath, next.join("\n"), "utf-8");
    return;
  }

  const h1 = lines.findIndex((l) => l.startsWith("# "));
  const insertAt = h1 >= 0 ? h1 + 1 : 0;
  const next = [
    ...lines.slice(0, insertAt),
    "",
    ...banner.split("\n"),
    ...lines.slice(insertAt),
  ];
  writeFileSync(docPath, next.join("\n"), "utf-8");
}

// ============ 执行 ============

const docs: string[] = [];
for (const dir of docDirs) collectMarkdown(toAbs(dir), docs);

if (docs.length === 0) {
  console.error(
    `未找到任何待核验文档（项目根目录 = ${rootDir}）：${docDirs.join(" / ")}`,
  );
  console.error("请在仓库根运行，或用 --paths= 指定文档目录。");
  process.exit(2);
}

const basenameIndex = buildBasenameIndex(docDirs);
const results: DocResult[] = docs.map((d) => verifyDoc(d, basenameIndex));

let totalFail = 0;
let totalWarn = 0;
let totalRefs = 0;
let totalSkipped = 0;

console.log();
console.log(`文档证据核验（根目录 = ${rootDir}，文档 ${docs.length} 篇）`);
console.log("-".repeat(80));

for (const r of results) {
  const refs = r.refs.length;
  totalFail += r.failCount;
  totalWarn += r.warnCount;
  totalRefs += refs;
  totalSkipped += r.refs.filter((x) => x.status === "skip").length;

  if (refs === 0 || (r.failCount === 0 && r.warnCount === 0)) continue;
  const tag = r.failCount > 0 ? "[FAIL]" : "[WARN]";
  console.log(
    `${tag} ${relFromRoot(r.doc)} — 引用 ${refs} 处，失效 ${r.failCount}，告警 ${r.warnCount}`,
  );
  for (const ref of r.refs) {
    if (ref.status === "ok" || ref.status === "skip") continue;
    console.log(
      `        - doc:${ref.docLine} ${ref.raw}${ref.line ? `:${ref.line}` : ""} → ${ref.detail ?? ""}`,
    );
  }
  if (r.failCount > 0 && fixBanner) {
    upsertBanner(r.doc, r.failCount);
    console.log('        → 已写入"证据核验失败"横幅');
  }
}

console.log("-".repeat(80));
console.log(
  `合计：引用 ${totalRefs} 处 | 失效 ${totalFail} | 告警 ${totalWarn} | 跳过（非证据形态/歧义）${totalSkipped}`,
);

if (totalFail > 0) {
  console.log(
    "提示：失效引用说明文档结论已过期 —— 请修订论断，或重跑并加 --fix-banner 标注过期。",
  );
  process.exit(1);
}
if (totalWarn > 0) {
  console.log(
    "⚠️ 存在告警级引用（路径形态无法定位，可能为示例路径）—— 不阻断门禁，建议人工确认。",
  );
}
console.log("✅ 未发现失效证据引用。");
process.exit(0);
