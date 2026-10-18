#!/usr/bin/env bun
/**
 * G-6（2026-10-18）—— **`tool_search` 未命中率 / 二次搜索率**取证（非 CI 门禁）。
 *
 * 背景（清单 §6 G-6）：`ToolSearchTool` 为关键词/名称打分（无向量检索），工具面 75+。
 * 是否引入 embedding 语义检索，**先看真实会话的未命中率**（阈值：> 20% 才立项评估）。
 *
 * 口径（全部来自**真实会话事件日志**，禁按文案推断）：
 *   - 样本：`~/.pyapp/data/sessions/**\/events.jsonl`（可用 `TOOL_SEARCH_LOG_ROOT` 或第 1 个参数
 *     指定根目录），跳过 `events.tail`（非完整日志）；
 *   - 调用：`assistant/tool_call` 且 `data.name === 'tool_search'`（`TOOL_SEARCH_TOOL_NAME`）；
 *   - 结果：`tool/result` 且 `data.callSeq` 命中该调用的 `callSeq`；`data.result` 为 JSON 字符串，
 *     读 `matches`（出参契约 `ToolSearchOutputSchema`）；
 *   - **未命中** = 结果可解析且 `matches.length === 0`（`isError:true` 单列，不计入分母）；
 *   - **二次搜索** = 同一 `turn` 内第 2 次及以后的 `tool_search` 调用；
 *   - **未命中后重搜** = 某次未命中之后、同 turn 内仍有 `tool_search` 的占比。
 *
 * 用法（app 目录下）：`bun run analyze:tool-search`
 * **不作为 CI 门禁**（依赖本机会话数据；无样本时如实报告"无样本"）。
 */
import {
  createReadStream,
  existsSync,
  readdirSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { TOOL_NAME_CONSTANTS } from '../src/tools/toolNameConstants';

/** 工具名（与 `tools/utils/toolSearch.ts` 的 `TOOL_SEARCH_TOOL_NAME` 同值；脚本不引运行时模块） */
const TOOL_SEARCH_NAME = 'tool_search';

/** 判定阈值（清单 §6 G-6：> 20% 未命中才评估 embedding） */
const MISS_RATE_THRESHOLD = 0.2;

/**
 * 已知工具名（来自 D11-B 唯一来源 `TOOL_NAME_CONSTANTS`）。
 *
 * 用途：把"未命中"拆成**可行动**与**不可由检索解决**两类 —— 日志不含会话当时的注册表快照，
 * 只能按"查询串是否含某个已知工具名"做保守分桶（见 `classifyMiss`；不拆词元，
 * 避免 image/file/read 这类通用词把几乎所有英文查询都算成"已知"）。
 */
const KNOWN_TOOL_NAMES = Object.keys(TOOL_NAME_CONSTANTS).map((n) =>
  n.toLowerCase()
);

/** 抽样审计开关（`TOOL_SEARCH_SAMPLE=1`）：打印前 10 条「调用 + 结果」原文，供人工核对口径 */
const SAMPLE = process.env.TOOL_SEARCH_SAMPLE === '1';
let sampled = 0;

function maybeSample(label: string, payload: unknown): void {
  if (!SAMPLE || sampled >= 10) return;
  sampled += 1;
  console.log(
    `  [sample ${sampled}] ${label}: ${JSON.stringify(payload).slice(0, 400)}`
  );
}

interface Call {
  seq: number;
  callSeq?: number;
  turn: number | null;
  query: string;
}

/** 未命中分桶（口径见文件头；`select-*` 属"按名选择"面，不属语义检索面） */
type MissBucket =
  | 'select-syntax'
  | 'select-unknown'
  | 'keyword-known-name'
  | 'keyword-no-known-name';

function classifyMiss(query: string): MissBucket {
  const q = query.trim();
  if (/^select:/i.test(q)) {
    const body = q.slice('select:'.length);
    // 出参契约是 `select:a,b`；用空格分隔多个目标 / 重复 `select:` ⇒ 语法误用
    return /\s/.test(body) || /select:/i.test(body)
      ? 'select-syntax'
      : 'select-unknown';
  }
  const lower = q.toLowerCase();
  return KNOWN_TOOL_NAMES.some((n) => lower.includes(n))
    ? 'keyword-known-name'
    : 'keyword-no-known-name';
}

interface SessionStats {
  file: string;
  calls: number;
  resolved: number;
  misses: number;
  errors: number;
  unresolved: number;
  repeatCalls: number;
  missThenRetry: number;
  turnMarkers: number;
  missQueries: string[];
  /** 未命中分桶（E-2 后的 G-6 口径修正：剔除"工具不存在/语法误用"对 embedding 需求的误报） */
  buckets: Record<MissBucket, number>;
  /**
   * 注册表规模**代理指标**（出参里的 `total_deferred_tools`；日志无完整注册表快照）。
   * 用途：判断空结果是否发生在"工具极少"的会话（此时 embedding 同样无从召回）。
   */
  deferredCounts: number[];
}

/** 默认会话根（`~/.pyapp/data/sessions`；含多分区） */
function defaultRoot(): string {
  const envRoot = process.env.TOOL_SEARCH_LOG_ROOT?.trim();
  if (envRoot) return envRoot;
  const arg = process.argv[2]?.trim();
  if (arg) return arg;
  return join(homedir(), '.pyapp', 'data', 'sessions');
}

/** 递归收集 `events.jsonl`（深度 ≤ 3：`<root>/<partition>/<session>/events.jsonl`） */
function collectLogs(root: string, depth = 0): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isFile() && ent.name === 'events.jsonl') {
      out.push(p);
      continue;
    }
    if (!ent.isDirectory() || depth >= 3) continue;
    out.push(...collectLogs(p, depth + 1));
  }
  return out;
}

/** 解析单文件，返回该会话的统计（逐行流式，避免大日志一次性入内存） */
async function analyzeFile(file: string): Promise<SessionStats> {
  const stats: SessionStats = {
    file,
    calls: 0,
    resolved: 0,
    misses: 0,
    errors: 0,
    unresolved: 0,
    repeatCalls: 0,
    missThenRetry: 0,
    turnMarkers: 0,
    missQueries: [],
    buckets: {
      'select-syntax': 0,
      'select-unknown': 0,
      'keyword-known-name': 0,
      'keyword-no-known-name': 0,
    },
    deferredCounts: [],
  };

  /** callSeq → 调用（同文件内配对；`callSeq` 缺省时退化为按 `toolCallId` 不可得 ⇒ 记 unresolved） */
  const byCallSeq = new Map<number, Call>();
  const perTurn = new Map<number, Call[]>();
  let currentTurn: number | null = null;

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let ev: { type?: string; seq?: number; data?: Record<string, unknown> };
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (ev.type === 'turn/start') {
      const t = ev.data?.['turn'];
      currentTurn = typeof t === 'number' ? t : null;
      if (currentTurn !== null) stats.turnMarkers += 1;
      continue;
    }
    if (ev.type === 'assistant/tool_call') {
      const name = ev.data?.['name'];
      if (name !== TOOL_SEARCH_NAME) continue;
      const args = ev.data?.['args'] as { query?: unknown } | undefined;
      const call: Call = {
        seq: typeof ev.seq === 'number' ? ev.seq : 0,
        callSeq:
          typeof ev.data?.['callSeq'] === 'number'
            ? (ev.data['callSeq'] as number)
            : undefined,
        turn: currentTurn,
        query: typeof args?.query === 'string' ? args.query : '',
      };
      stats.calls += 1;
      if (call.callSeq !== undefined) byCallSeq.set(call.callSeq, call);
      if (call.turn !== null) {
        const list = perTurn.get(call.turn) ?? [];
        list.push(call);
        perTurn.set(call.turn, list);
      }
      // 无 turn 标记（老日志）⇒ 不参与"二次搜索"统计（逐调用独立，不臆测先后关系）
      continue;
    }
    if (ev.type === 'tool/result') {
      const callSeq = ev.data?.['callSeq'];
      if (typeof callSeq !== 'number') continue;
      const call = byCallSeq.get(callSeq);
      if (!call) continue;
      byCallSeq.delete(callSeq);
      if (ev.data?.['isError'] === true) {
        stats.errors += 1;
        continue;
      }
      const raw = ev.data?.['result'];
      if (typeof raw !== 'string') {
        stats.unresolved += 1;
        continue;
      }
      let parsed: { matches?: unknown; total_deferred_tools?: unknown };
      try {
        parsed = JSON.parse(raw) as {
          matches?: unknown;
          total_deferred_tools?: unknown;
        };
      } catch {
        stats.unresolved += 1;
        continue;
      }
      if (typeof parsed.total_deferred_tools === 'number') {
        stats.deferredCounts.push(parsed.total_deferred_tools);
      }
      if (!Array.isArray(parsed.matches)) {
        stats.unresolved += 1;
        continue;
      }
      stats.resolved += 1;
      maybeSample('tool_search 结果', {
        query: call.query,
        matchCount: parsed.matches.length,
        matches: parsed.matches.slice(0, 5),
        resultPreview: raw.slice(0, 200),
      });
      if (parsed.matches.length === 0) {
        stats.misses += 1;
        missedSeqs.add(call.seq);
        stats.buckets[classifyMiss(call.query)] += 1;
        if (stats.missQueries.length < 20) {
          stats.missQueries.push(call.query.slice(0, 120));
        }
      }
    }
  }

  stats.unresolved += byCallSeq.size;

  // 二次搜索：同一 turn 内第 2 次及以后；未命中后同 turn 内仍有后续搜索
  for (const calls of perTurn.values()) {
    const ordered = [...calls].sort((a, b) => a.seq - b.seq);
    if (ordered.length > 1) stats.repeatCalls += ordered.length - 1;
    for (let i = 0; i < ordered.length - 1; i++) {
      if (missedSeqs.has(ordered[i].seq)) stats.missThenRetry += 1;
    }
  }

  return stats;
}

/** 全局未命中调用 seq 集合（同文件内有效；seq 在同文件单调 ⇒ 用文件+seq 复合键） */
const missedSeqs = new Set<number>();

async function main(): Promise<void> {
  const root = defaultRoot();
  console.log(
    '=== G-6 tool_search 未命中率 / 二次搜索率（真实会话，非门禁）==='
  );
  console.log(`日志根：${root}`);
  if (!existsSync(root)) {
    console.log('目录不存在 ⇒ 无样本（如实报告，不臆造指标）。');
    return;
  }
  const files = collectLogs(root);
  console.log(`发现 events.jsonl：${files.length} 个\n`);
  if (files.length === 0) {
    console.log('无事件日志 ⇒ 无样本。');
    return;
  }

  let totalCalls = 0;
  let totalResolved = 0;
  let totalMisses = 0;
  let totalErrors = 0;
  let totalUnresolved = 0;
  let totalRepeat = 0;
  let totalMissRetry = 0;
  let sessionsWithCalls = 0;
  let filesWithTurnMarkers = 0;
  const allMissQueries: string[] = [];
  const totalBuckets: Record<MissBucket, number> = {
    'select-syntax': 0,
    'select-unknown': 0,
    'keyword-known-name': 0,
    'keyword-no-known-name': 0,
  };
  const allDeferred: number[] = [];

  for (const file of files) {
    // 每个文件重置 miss seq 集合（seq 只在文件内可比）
    missedSeqs.clear();
    const s = await analyzeFile(file);
    if (s.calls === 0) continue;
    sessionsWithCalls += 1;
    if (s.turnMarkers > 0) filesWithTurnMarkers += 1;
    totalCalls += s.calls;
    totalResolved += s.resolved;
    totalMisses += s.misses;
    totalErrors += s.errors;
    totalUnresolved += s.unresolved;
    totalRepeat += s.repeatCalls;
    totalMissRetry += s.missThenRetry;
    for (const k of Object.keys(totalBuckets) as MissBucket[]) {
      totalBuckets[k] += s.buckets[k];
    }
    allDeferred.push(...s.deferredCounts);
    if (allMissQueries.length < 20) {
      allMissQueries.push(
        ...s.missQueries.slice(0, 20 - allMissQueries.length)
      );
    }
  }

  const missRate = totalResolved > 0 ? totalMisses / totalResolved : undefined;
  const repeatRate = totalCalls > 0 ? totalRepeat / totalCalls : undefined;
  const missRetryRate =
    totalMisses > 0 ? totalMissRetry / totalMisses : undefined;

  console.log('--- 样本 ---');
  console.log(
    `含 tool_search 的会话：${sessionsWithCalls} / ${files.length}` +
      `（含 turn 标记：${filesWithTurnMarkers}）`
  );
  console.log(
    `调用 ${totalCalls} 次：可判定 ${totalResolved} · 错误 ${totalErrors} · 无法判定 ${totalUnresolved}`
  );

  console.log('\n--- 指标 ---');
  console.log(
    `未命中率：${missRate === undefined ? 'N/A（无可判定结果）' : `${(missRate * 100).toFixed(1)}%（${totalMisses}/${totalResolved}）`}`
  );
  console.log(
    `二次搜索率：${repeatRate === undefined ? 'N/A' : `${(repeatRate * 100).toFixed(1)}%（${totalRepeat}/${totalCalls}）`}`
  );
  console.log(
    `未命中后重搜率：${missRetryRate === undefined ? 'N/A' : `${(missRetryRate * 100).toFixed(1)}%（${totalMissRetry}/${totalMisses}）`}`
  );
  console.log(
    '\n未命中分桶（口径见文件头；用于剔除"工具不存在/语法误用"的误报）：'
  );
  console.log(
    `  · select 语法误用（空格分隔多目标）：${totalBuckets['select-syntax']}`
  );
  console.log(`  · select 按名选择未知名：${totalBuckets['select-unknown']}`);
  console.log(
    `  · 关键词未命中且查询含已知工具名（**可行动**）：${totalBuckets['keyword-known-name']}`
  );
  console.log(
    `  · 关键词未命中且不含已知工具名（多为"工具不存在"，embedding 不解决）：${totalBuckets['keyword-no-known-name']}`
  );
  const actionable = totalBuckets['keyword-known-name'];
  const actionableRate =
    totalResolved > 0 ? actionable / totalResolved : undefined;
  console.log(
    `  关键词"含已知工具名"候选未命中率（**未证明属检索漏召回**）：${
      actionableRate === undefined
        ? 'N/A'
        : `${(actionableRate * 100).toFixed(1)}%（${actionable}/${totalResolved}）`
    }`
  );
  if (allDeferred.length > 0) {
    const sorted = [...allDeferred].sort((a, b) => a - b);
    const pick = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const tiny = allDeferred.filter((n) => n <= 2).length;
    console.log(
      `  注册表规模代理（total_deferred_tools，n=${allDeferred.length}）：` +
        `p50 ${pick(0.5)} / p95 ${pick(0.95)} / max ${sorted[sorted.length - 1]}；` +
        `≤2 的调用 ${tiny}/${allDeferred.length}（${((tiny / allDeferred.length) * 100).toFixed(1)}%）`
    );
  }
  if (allMissQueries.length > 0) {
    console.log('\n未命中查询样本（最多 20 条）：');
    for (const q of allMissQueries) console.log(`  · ${q || '(空 query)'}`);
  }

  console.log('\n--- 结论 ---');
  if (missRate === undefined || actionableRate === undefined) {
    console.log(
      '无可用样本 ⇒ 未达"立项评估 embedding"的取证条件；按清单规则**默认关闭**（不做向量检索）。'
    );
    return;
  }
  console.log(
    `原始未命中率 ${(missRate * 100).toFixed(1)}%；` +
      `其中"关键词含已知工具名"候选 ${(actionableRate * 100).toFixed(1)}%（其余为 select 未知名/语法误用/工具不存在）。`
  );
  console.log(
    '判定：**不立项（不引入 embedding 语义检索）**。理由：' +
      '① `select:` 未知名与"不含已知工具名"两类合计占多数 —— 这些工具在**代码库里就不存在**，' +
      '向量检索同样无从召回（CS03：不为不存在的工具建索引）；' +
      '② `select:` 语法误用是**模型用法问题**，应由既有 hint 引导（已实现）解决，而非检索模型；' +
      '③ 剩余"含已知工具名"的候选**不能证明是检索漏召回** —— 日志没有会话当时的注册表快照，' +
      '而抽样显示空结果大量发生在 `total_deferred_tools` 极小的会话（工具**未注册**，任何检索都搜不到）。'
  );
  console.log(
    `重开条件（写死）：在**注册表完整**（工具数 ≥ 50）的会话中累计 ≥ 50 次 tool_search，` +
      `且关键词未命中率 > ${MISS_RATE_THRESHOLD * 100}% ⇒ 再评估复用 knowledge/semantic 的 embedding 通道` +
      '（不新增独立向量库、不改 tool_search 契约）。'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('统计运行失败：', err);
    process.exit(1);
  });
