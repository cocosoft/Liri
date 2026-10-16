/**
 * 硬编码治理 · host/端口字面量白名单检测（方案 §8 阶段②「白名单收敛」）
 *
 * 报 `localhost` / `127.0.0.1` / `0.0.0.0` 与**固定端口**（`:\d{4,5}`）字面量。
 * 白名单（真源）内的文件不上报；`.md` 文档/示例不在扫描内（扩展名天然排除）。
 * 输出**按文件聚合计数**，便于后续收敛。
 *
 * 结果：**棘轮式（只减不增）** —— 稳定键 = `<相对路径>`，计数 = 该文件命中数；
 * 与基线 `.trae/architecture/hardcode-gate-baseline.json` 的 `lint:endpoints` 分节
 * 比对；**新增键（新文件）/ 计数扩大 ⇒ `process.exit(1)`**。
 * 播种（初始化 / 下调）：`HARDCODE_GATE_BASELINE_WRITE=1`；负向自证：
 * `HARDCODE_GATE_BASELINE=<临时副本>`。
 *
 * 运行：cd app && bun run lint:endpoints
 */

import {
  collectFiles,
  type GateCounts,
  isCommentLine,
  matchesWhitelist,
  ratchet,
  readLines,
  report,
  toRel,
} from './lib/hardcodeScan';

/**
 * 真源白名单（同 lint-consts.ts：等同值 host/端口若**定义于此**，属唯一事实源）。
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

/** 本机 host 字面量 */
const LOCAL_HOST_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/g;

/** 固定端口字面量（4~5 位，非时间片段的粗筛） */
const FIXED_PORT_RE = /:\d{4,5}(?!\d)/g;

interface Hit {
  line: number;
  kind: string;
}

function main(): void {
  const files = collectFiles();
  const findings: string[] = [];
  const counts: GateCounts = {};
  let hitFiles = 0;
  let total = 0;

  for (const abs of files) {
    const rel = toRel(abs);
    if (matchesWhitelist(rel, TRUTH_SOURCE_FRAGMENTS)) continue;
    const lines = readLines(abs);
    const hits: Hit[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      for (const m of line.matchAll(LOCAL_HOST_RE)) {
        hits.push({ line: i + 1, kind: m[0] });
      }
      for (const m of line.matchAll(FIXED_PORT_RE)) {
        hits.push({ line: i + 1, kind: `端口${m[0]}` });
      }
    }
    if (hits.length === 0) continue;

    hitFiles++;
    total += hits.length;
    // 棘轮稳定键 = 相对路径，计数 = 该文件命中数
    counts[rel] = hits.length;
    const kinds = new Map<string, number>();
    for (const h of hits) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
    const kindStr = [...kinds.entries()].map(([k, n]) => `${k}×${n}`).join(' ');
    const lineList = [...new Set(hits.map((h) => h.line))].join(',');
    findings.push(
      `${rel}:${hits[0].line}  命中 ${hits.length} 处（${kindStr}）` +
        ` 行 ${lineList}`
    );
  }

  findings.sort();
  report('endpoints', findings, [
    `[lint:endpoints] 扫描 ${files.length} 个文件（白名单外），命中 ` +
      `${hitFiles} 文件 / ${total} 处`,
  ]);
  ratchet('endpoints', counts);
}

main();
// 兜底显式收尾（`lint:exit` 门禁要求）：正常路径已在 `ratchet()` 内部退出（其返回类型为
// `never`）；此处保证「若日后 `ratchet` 不再自退出，入口仍显式结束」，不会挂在长驻句柄上。
process.exit(0);
