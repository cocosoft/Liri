/**
 * logger `module` 名规范 —— 纯核心（2026-10-31，台账「logger 命名口径」项）
 *
 * 口径（用户裁定：**只对新增/改动强制，不批量重命名存量**）：
 *  - 合规 = **`域:子域` 结构**：名字至少含一个 `:`，且每段只由 `[A-Za-z0-9_-]` 组成；
 *  - 存量 1000+ 个 PascalCase 历史名（`AIContextInjector` / `BootRegistry` …）冻结进基线，
 *    **不阻断**、也不改名（`module` 是运维检索维度，批量改名会改变检索口径）；
 *  - 新增（文件,名字）对不在基线内 ⇒ 阻断，提示改用 `域:子域`。
 *
 * 与 `state-literal-baseline.json` 同哲学（Register-or-Fail / 棘轮只增不减）。
 */

export interface LoggerHit {
  /** logger module 名（`getLogger('...')` 的字面量） */
  name: string;
  /** repo 相对 POSIX 路径 */
  file: string;
}

export interface LoggerNameBaseline {
  version: 1;
  /** 非合规名 → 已报备的文件列表（只增不减） */
  names: Record<string, string[]>;
}

/** `getLogger('…')` / `createLogger('…')` 的字符串字面量（仅单引号/双引号，模板串不收） */
const LOGGER_CALL_RE = /(?:getLogger|createLogger)\(\s*(['"])([^'"]+)\1\s*\)/g;

/** 名字是否合规（`域:子域` 结构） */
export function isConformingLoggerName(name: string): boolean {
  if (!name.includes(':')) return false;
  return name
    .split(':')
    .every((seg) => seg.length > 0 && /^[A-Za-z0-9_-]+$/.test(seg));
}

/** 提取一个文件里的全部 logger 名（去重，保持文件内顺序） */
export function extractLoggerNames(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  LOGGER_CALL_RE.lastIndex = 0;
  while ((m = LOGGER_CALL_RE.exec(text)) !== null) {
    const name = m[2];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** 收集全仓命中（只保留**不合规**的，合规名无需报备） */
export function collectLoggerHits(
  files: readonly { file: string; text: string }[]
): LoggerHit[] {
  const hits: LoggerHit[] = [];
  for (const f of files) {
    for (const name of extractLoggerNames(f.text)) {
      if (!isConformingLoggerName(name)) hits.push({ name, file: f.file });
    }
  }
  return hits;
}

/** 命中 → 基线形态（按名聚合文件，文件内排序去重） */
export function toBaselineNames(
  hits: readonly LoggerHit[]
): Record<string, string[]> {
  const byName = new Map<string, Set<string>>();
  for (const h of hits) {
    const set = byName.get(h.name) ?? new Set<string>();
    set.add(h.file);
    byName.set(h.name, set);
  }
  const out: Record<string, string[]> = {};
  for (const name of [...byName.keys()].sort()) {
    out[name] = [...(byName.get(name) as Set<string>)].sort();
  }
  return out;
}

/**
 * 与基线做差：返回**新增**（阻断）与**已消失**（提示下调，不阻断）。
 */
export function diffBaseline(
  hits: readonly LoggerHit[],
  baseline: LoggerNameBaseline
): { newHits: LoggerHit[]; staleHits: LoggerHit[] } {
  const newHits = hits.filter(
    (h) => !(baseline.names[h.name] ?? []).includes(h.file)
  );
  const hitKeys = new Set(hits.map((h) => `${h.name}\u0000${h.file}`));
  const staleHits: LoggerHit[] = [];
  for (const [name, files] of Object.entries(baseline.names)) {
    for (const file of files) {
      if (!hitKeys.has(`${name}\u0000${file}`)) staleHits.push({ name, file });
    }
  }
  return { newHits, staleHits };
}
