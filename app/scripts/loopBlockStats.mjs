#!/usr/bin/env bun
/**
 * 事件循环阻塞 · 统计脚本（方案 §3-P3 交付物，2026-09-22）
 *
 * 作用：**不读代码、不改行为**地从既有日志产出 A/B 基线表 ——
 *   ① 阻塞事件数/小时；② lag 分布（分位 + 分桶）；③ 阻塞前最后一条日志的模块（前置关联）；
 *   ④ 探针捕获的阶段级归因汇总（`current` / `suspects` / P4 的 activeRequests）。
 *
 * 用法：
 *   bun scripts/loopBlockStats.mjs                 # 全量
 *   bun scripts/loopBlockStats.mjs --since=2026-09-22T01:00:00Z
 *
 * A/B 用法（P3 的"对比"部分，需用户改 env 重启实例后各跑一段）：
 *   基线： bun scripts/loopBlockStats.mjs > baseline.txt
 *   对照： LOOP_PROBE=off <某子系统开关>=0 … 后再跑同一条命令，比较"阻塞事件数/小时"。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.pyapp', 'data', 'logs');
const sinceArg = process.argv.find((a) => a.startsWith('--since='));
const SINCE = sinceArg ? Date.parse(sinceArg.slice(8)) : 0;

const files = readdirSync(LOG_DIR)
  .filter((f) => f.startsWith('app.log'))
  .map((f) => join(LOG_DIR, f))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

const LAG_RE = /Event Loop 滞后: (\d+)ms/;
const lagEvents = [];
const incidents = [];
/** 最近一条普通日志（用于"阻塞前最后一条日志"前置关联） */
const recentModules = new Map();
/** 按小时计数：阻塞事件 / 各模块日志量（用于 P3 的统计对比） */
const blocksByHour = new Map();
const modByHour = new Map();

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (const raw of lines) {
    if (!raw.trim().startsWith('{')) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    const ts = Date.parse(e.timestamp ?? '');
    if (Number.isNaN(ts) || ts < SINCE) continue;

    if (e.module === 'diagnostics:loop-probe') {
      if (e.message?.includes('阻塞事件')) incidents.push({ ts, ...e.meta });
      continue;
    }
    if (typeof e.message === 'string' && LAG_RE.test(e.message)) {
      const lagMs = Number(LAG_RE.exec(e.message)[1]);
      // 阻塞前最近一条日志（同一进程、30s 窗口内）
      let prev = null;
      for (const [mod, t] of recentModules) {
        if (ts - t <= 30_000 && ts - t >= 0) {
          if (!prev || t > prev.t) prev = { mod, t };
        }
      }
      lagEvents.push({ ts, lagMs, prevModule: prev?.mod ?? '(无近期日志)' });
      const hk = Math.floor(ts / 3_600_000);
      blocksByHour.set(hk, (blocksByHour.get(hk) ?? 0) + 1);
      continue;
    }
    if (e.module) {
      recentModules.set(e.module, ts);
      const hk = Math.floor(ts / 3_600_000);
      let hm = modByHour.get(e.module);
      if (!hm) {
        hm = new Map();
        modByHour.set(e.module, hm);
      }
      hm.set(hk, (hm.get(hk) ?? 0) + 1);
    }
  }
}

const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const sorted = lagEvents.map((x) => x.lagMs).sort((a, b) => a - b);

console.log(`=== ① 规模 ===`);
console.log(`日志文件 ${files.length} 个；阻塞事件 ${lagEvents.length} 次；探针归因 ${incidents.length} 次`);
if (lagEvents.length > 0) {
  const span = lagEvents[lagEvents.length - 1].ts - lagEvents[0].ts;
  const hours = span / 3_600_000;
  console.log(
    `覆盖 ${hours.toFixed(1)} 小时 ⇒ **${(lagEvents.length / hours).toFixed(1)} 次/小时**（A/B 对比就用这个数）`
  );
}

console.log(`\n=== ② lag 分布（ms）===`);
console.log(
  `min=${sorted[0]} p25=${q(sorted, 0.25)} 中位=${q(sorted, 0.5)} p75=${q(sorted, 0.75)} max=${sorted[sorted.length - 1]}`
);
const buckets = new Map();
for (const v of sorted) {
  const k = `${Math.floor(v / 1000) * 1000 / 1000}~${Math.floor(v / 1000) + 1}s`;
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`最密桶: ${top.map(([k, v]) => `${k}=${v}`).join('  ')}`);

console.log(`\n=== ③ 阻塞前最后一条日志的模块（Top10）===`);
const byMod = new Map();
for (const e of lagEvents) byMod.set(e.prevModule, (byMod.get(e.prevModule) ?? 0) + 1);
for (const [m, c] of [...byMod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${c}\t${m}`);
}

console.log(`\n=== ④ 探针阶段级归因（每次一条）===`);
for (const i of incidents) {
  const t = new Date(i.ts).toISOString().slice(11, 19);
  console.log(
    `  ${t}Z lag=${i.lagMs}ms current=${i.current ?? '(阶段外)'} ` +
      `suspects=${(i.suspects ?? []).map((s) => `${s.name}:${s.durationMs}`).join(',') || '-'} ` +
      `req=${i.activeRequests ?? '?'} handle=${i.activeHandles ?? '?'}`
  );
}
const outside = incidents.filter((i) => !i.current).length;
if (incidents.length > 0) {
  console.log(
    `  ⇒ 落在**任何阶段之外**的: ${outside}/${incidents.length}` +
      `（该比例越高，越指向 P2 未覆盖的路径或 native/GC）`
  );
  const withReq = incidents.filter((i) => (i.activeRequests ?? 0) > 0).length;
  // ⚠ 口径：`activeRequests` 是本轮（2026-09-22）才加的字段 ⇒ **旧事件日志里没有它**。
  // 必须把"字段缺失"与"=0"分开统计，否则会把旧事件误报成"0 个在飞请求"（并据此误判 A 类）。
  const known = incidents.filter((i) => typeof i.activeRequests === 'number').length;
  console.log(
    `  ⇒ 阻塞时 activeRequests > 0 的: ${withReq}/${known}（>0 倾向 C 类 native/IO）` +
      `；另有 ${incidents.length - known}/${incidents.length} 条为**旧事件（该字段未采集）**`
  );
}

// === ⑤ P3 统计对比（env 开关 A/B 之前的"自然实验"替代）===
// 比较"各子系统活动度"与"阻塞数/小时"的共变强度，用于缩小嫌疑范围。
const hours = [...blocksByHour.keys()];
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
};

console.log(`\n=== ⑤ 小时粒度相关（n=${hours.length} 小时）===`);
const rows = [];
for (const [mod, hm] of modByHour) {
  if (hm.size < 3) continue;
  const xs = hours.map((h) => hm.get(h) ?? 0);
  if (xs.every((v) => v === 0)) continue;
  const ys = hours.map((h) => blocksByHour.get(h) ?? 0);
  const r = pearson(xs, ys);
  if (!Number.isNaN(r)) rows.push({ mod, r, activeHours: hm.size });
}
rows.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
for (const x of rows.slice(0, 10)) {
  console.log(`  r=${x.r.toFixed(2)}  活跃小时=${x.activeHours}  ${x.mod}`);
}
console.log(
  '  口径：**相关 ≠ 因果**（如周期 logger 天然与"应用在用"同增）；仅用于在 env 开关 A/B 前缩小嫌疑范围。'
);
console.log(
  '  A/B 用法：基线用本脚本输出；对照需按 env 逐一切断子系统后各跑一段，再比"次/小时"（见脚本头注释）。'
);
