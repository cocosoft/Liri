/**
 * 硬编码治理 · 重复事实源检测（方案 §8 阶段①「仅上报」）
 *
 * (a) **同名常量**（`const UPPER_SNAKE =`）定义于 ≥2 文件；
 * (b) **同值 URL/host 字面量**（scheme://host[:port] / localhost:port / 127.0.0.1）
 *     出现于 ≥2 文件。
 *
 * 白名单（真源）内的文件不上报（见下方 TRUTH_SOURCE_FRAGMENTS，可逐条注释）。
 * 结果：仅上报，不阻断（永远 `process.exit(0)`）。
 *
 * 运行：cd app && bun run lint:consts
 */

import {
  collectFiles,
  isCommentLine,
  matchesWhitelist,
  readLines,
  report,
  toRel,
} from './lib/hardcodeScan';

/**
 * 真源白名单（等同值 / 同名常量若**定义于此**，属唯一事实源，不视为重复）。
 * 片段匹配（`rel.includes(frag)`），统一 `/` 分隔 —— 可在此按需增删。
 */
const TRUTH_SOURCE_FRAGMENTS = [
  'core/paths.ts', // 后端路径真源
  'core/ports.ts', // 后端端口真源
  'core/endpoints.ts', // 后端端点真源
  'client/src/services/endpoints.ts', // 前端端点真源
  'client/src/constants/locale.ts', // 前端 locale 真源
  'client/src/constants/events.ts', // 前端事件名真源
  'client/src/constants/storage.ts', // 前端存储键真源
  'client/src/constants/capabilities.ts', // 前端能力名真源
  'tests/', // 仓库级测试目录
  '__tests__/', // 测试目录（collectFiles 已跳过，双保险）
  '.test.', // *.test.*
  '.spec.', // *.spec.*
];

/** 常量定义：`[\export ]const UPPER_SNAKE =`（≥3 字符，全大写/数字/下划线） */
const CONST_DEF_RE = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*=/;

/** 字符串字面量（单/双/反引号，内容不含引号与换行） */
const STRING_LITERAL_RE = /['"`]([^'"`\n]+)['"`]/g;

/** URL（scheme + host + 可选端口）—— 按 `scheme://host[:port]` 聚合 */
const URL_RE = /https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g;

/** 本机 host（localhost / 127.0.0.1 + 可选端口） */
const LOCAL_HOST_RE = /(?:localhost|127\.0\.0\.1)(?::\d+)?/g;

interface Hit {
  file: string;
  line: number;
}

function push(map: Map<string, Hit[]>, key: string, hit: Hit): void {
  const list = map.get(key);
  if (list) list.push(hit);
  else map.set(key, [hit]);
}

/** 扫描：返回「同名常量」与「同值字面量」两张聚合表 */
function collect(files: string[]): {
  consts: Map<string, Hit[]>;
  values: Map<string, Hit[]>;
} {
  const consts = new Map<string, Hit[]>();
  const values = new Map<string, Hit[]>();
  for (const abs of files) {
    const rel = toRel(abs);
    if (matchesWhitelist(rel, TRUTH_SOURCE_FRAGMENTS)) continue;
    const lines = readLines(abs);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const def = line.match(CONST_DEF_RE);
      if (def) push(consts, def[1], { file: rel, line: i + 1 });
      for (const lit of line.matchAll(STRING_LITERAL_RE)) {
        for (const m of lit[1].matchAll(URL_RE)) {
          push(values, m[0], { file: rel, line: i + 1 });
        }
        for (const m of lit[1].matchAll(LOCAL_HOST_RE)) {
          push(values, m[0], { file: rel, line: i + 1 });
        }
      }
    }
  }
  return { consts, values };
}

/** 仅保留「出现于 ≥2 个**不同文件**」的聚合项 */
function duplicates(
  map: Map<string, Hit[]>
): Array<{ key: string; hits: Hit[]; files: string[] }> {
  const out: Array<{ key: string; hits: Hit[]; files: string[] }> = [];
  for (const [key, hits] of map) {
    const files = [...new Set(hits.map((h) => h.file))];
    if (files.length >= 2) out.push({ key, hits, files });
  }
  return out;
}

function main(): void {
  const files = collectFiles();
  const { consts, values } = collect(files);
  const constDups = duplicates(consts);
  const valueDups = duplicates(values);

  const findings: string[] = [];
  for (const d of constDups) {
    findings.push(
      `${d.hits[0].file}:${d.hits[0].line}  同名常量 ${d.key} 定义于 ` +
        `${d.files.length} 文件（${d.files.join(', ')}）`
    );
  }
  for (const d of valueDups) {
    findings.push(
      `${d.hits[0].file}:${d.hits[0].line}  同值字面量 ${d.key} 出现于 ` +
        `${d.files.length} 文件（${d.files.join(', ')}）`
    );
  }

  report('consts', findings, [
    `[lint:consts] 扫描 ${files.length} 个文件（白名单外），同名常量重复 ` +
      `${constDups.length} 组 / 同值字面量重复 ${valueDups.length} 组`,
  ]);
  process.exit(0);
}

main();
