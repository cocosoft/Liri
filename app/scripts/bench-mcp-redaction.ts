#!/usr/bin/env bun
/**
 * G-4（2026-10-18）—— **MCP 安全过滤（脱敏）开销压测：先量化，后决定**（非 CI 门禁）。
 *
 * 背景（清单 §6 G-4）：`McpToolWrapper` / `MCPServerManager` 在工具返回路径内联**同步**
 * `filterMCPToolResult` + `redactMcpPayload`（JSON 序列化往返）。是否抽成异步拦截器，
 * 必须**先有数据**（CS03：不为"架构好看"提前引入中间件链）。
 *
 * 判定规则（清单原文）：**P95 增量 > 5 ms 或 > 5% 工具总延迟** ⇒ 才抽异步拦截器；
 * 否则把结论写回清单并关闭本项。
 *
 * 测什么（三个载荷尺寸梯度 1KB / 100KB / 1MB）：
 *   F1 纯函数开销：`filterMCPToolResult`（文本剥离）与 `redactMcpPayload`（JSON 往返）的
 *      P50 / P95 / mean（毫秒）；分「无密钥」（快路径，无 JSON.parse）与「含 16 个假密钥」
 *      （慢路径，触发 parse）两种。
 *   F2 占比：脱敏 P95 ÷ **工具总延迟**。
 *      - 真机口径（`MCP_E2E=1`）：接真实 stdio 参考服务器（`@modelcontextprotocol/server-everything`），
 *        测 `echo` 往返 P50/P95，作为"工具总延迟"的真实下界（本地 stdio，无网络）；
 *      - 未启用时**不臆造分母**（JSON.stringify 不是"工具总延迟"）⇒ 占比记 N/A，只按绝对毫秒判定。
 *
 * 用法（app 目录下）：
 *   `bun run bench:mcp-redaction`
 *   `$env:MCP_E2E='1'; bun run bench:mcp-redaction`   # 追加真实服务器往返对照
 * **不作为 CI 门禁**（受机器负载影响）。
 */
import {
  filterMCPToolResult,
  redactMcpPayload,
} from '../src/services/mcp/MCPSecurityFilter';

const KB = 1024;
const MB = 1024 * 1024;

/** 假密钥（命中 `stripCredentials` 的 `sk-(?:ant|proj)-…` 规则；固定假值，非真实凭据） */
const FAKE_KEY = `sk-proj-${'G'.repeat(40)}`;
/** 每份载荷埋入的假密钥数量（模拟"含凭据的结果"，触发 JSON.parse 慢路径） */
const SECRETS = 16;

/** 阈值（清单 §6 G-4 原文） */
const THRESHOLD_MS = 5;
const THRESHOLD_RATIO = 0.05;

interface Stat {
  p50: number;
  p95: number;
  mean: number;
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const round = (n: number): number => Math.round(n * 1000) / 1000;

/** 构造指定字节数的文本载荷；`secretCount` 个假密钥置于开头（不被截断） */
function makeText(bytes: number, secretCount: number): string {
  const head = Array.from({ length: secretCount }, () => FAKE_KEY).join(' ');
  const need = Math.max(0, bytes - head.length);
  const filler = 'abcdefghij'.repeat(Math.ceil(need / 10));
  return `${head}\n${filler}`.slice(0, bytes);
}

/** 构造与 MCP 返回同形的最小载荷（文本 + 结构化 data） */
function makePayload(text: string): unknown {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { echo: text.slice(0, 4096) },
  };
}

function bench(fn: () => unknown, warmup: number, iters: number): Stat {
  for (let i = 0; i < warmup; i++) fn();
  const ds: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    ds.push(performance.now() - t0);
  }
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return { p50: pct(ds, 0.5), p95: pct(ds, 0.95), mean };
}

/** 每个尺寸的重复次数（1MB 少跑，避免压测本身太慢） */
function itersFor(bytes: number): { warmup: number; iters: number } {
  if (bytes >= MB) return { warmup: 2, iters: 40 };
  if (bytes >= 100 * KB) return { warmup: 5, iters: 300 };
  return { warmup: 20, iters: 2000 };
}

/** 真实 stdio MCP 服务器（与 `tests/mcp/realServerE2E.test.ts` 同源配置） */
const MCP_SERVER = 'everything';
const MCP_CONFIG = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-everything'],
  scope: 'local',
} as const;

/** 轮询等待 SDK 客户端就绪（`initialize` 内部批量刷新 clientCache，存在时序窗口） */
async function waitForClient(timeoutMs = 60_000) {
  const { mcpConnectionManager } =
    await import('../src/services/mcp/MCPConnectionManager.js');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = mcpConnectionManager.getSdkClient(MCP_SERVER);
    if (client) return client;
    if (Date.now() >= deadline) return undefined;
    await new Promise<void>((r) => setTimeout(r, 100));
  }
}

/**
 * F2 真机口径：真实服务器 `echo` 往返（本地 stdio ⇒ 无网络，作为工具总延迟下界）。
 * 返回每个尺寸的 P50/P95；任一尺寸失败 ⇒ 返回 null（结论按离线口径，并如实标注）。
 */
async function benchRoundTrip(
  sizes: Array<{ label: string; bytes: number }>
): Promise<Map<string, Stat> | null> {
  try {
    const { mcpConnectionManager } =
      await import('../src/services/mcp/MCPConnectionManager.js');
    await mcpConnectionManager.initialize({
      [MCP_SERVER]: MCP_CONFIG as never,
    });
    const client = await waitForClient();
    if (!client) {
      console.warn('[真机口径] 未能取得 SDK Client（连接失败）⇒ 跳过往返对照');
      return null;
    }
    const out = new Map<string, Stat>();
    for (const { label, bytes } of sizes) {
      const message = makeText(bytes, 0);
      const ds: number[] = [];
      const iters = bytes >= MB ? 3 : bytes >= 100 * KB ? 10 : 20;
      for (let i = 0; i < iters; i++) {
        const t0 = performance.now();
        await client.callTool({
          name: 'echo',
          arguments: { message },
        });
        ds.push(performance.now() - t0);
      }
      out.set(label, {
        p50: pct(ds, 0.5),
        p95: pct(ds, 0.95),
        mean: ds.reduce((a, b) => a + b, 0) / ds.length,
      });
    }
    await mcpConnectionManager.closeAll();
    return out;
  } catch (err) {
    console.warn(`[真机口径] 往返压测失败 ⇒ 跳过：${String(err)}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log('=== G-4 MCP 脱敏开销压测（非门禁）===');
  console.log(
    `判定阈值：P95 增量 > ${THRESHOLD_MS} ms 或 > ${THRESHOLD_RATIO * 100}% 工具总延迟 ⇒ 才抽异步拦截器\n`
  );

  const sizes = [
    { label: '1KB', bytes: KB },
    { label: '100KB', bytes: 100 * KB },
    { label: '1MB', bytes: MB },
  ];

  const rows: Array<{
    label: string;
    clean: Stat;
    secrets: Stat;
    stringify: Stat;
  }> = [];

  for (const { label, bytes } of sizes) {
    const { warmup, iters } = itersFor(bytes);
    const cleanText = makeText(bytes, 0);
    const secretText = makeText(bytes, SECRETS);
    const cleanPayload = makePayload(cleanText);
    const secretPayload = makePayload(secretText);

    // 快路径：无密钥（`redactMcpPayload` 在 cleaned === jsonStr 时**不 parse**）
    const clean = bench(
      () => {
        filterMCPToolResult(cleanText);
        redactMcpPayload(cleanPayload);
      },
      warmup,
      iters
    );
    // 慢路径：含密钥（触发 JSON.parse 回解析）
    const secrets = bench(
      () => {
        filterMCPToolResult(secretText);
        redactMcpPayload(secretPayload);
      },
      warmup,
      iters
    );
    // 参照：同尺寸 JSON 序列化（脱敏的 JSON 往返中不可省的基线成本）
    const stringify = bench(() => JSON.stringify(secretPayload), warmup, iters);

    rows.push({ label, clean, secrets, stringify });
    console.log(
      `${label.padEnd(6)} 无密钥 p50 ${round(clean.p50)} ms / p95 ${round(clean.p95)} ms` +
        ` · 含 ${SECRETS} 密钥 p50 ${round(secrets.p50)} ms / p95 ${round(secrets.p95)} ms` +
        ` · JSON.stringify p50 ${round(stringify.p50)} ms`
    );
  }

  // F2 真机口径（可选）
  let trips: Map<string, Stat> | null = null;
  if (process.env.MCP_E2E === '1') {
    console.log(
      '\n[真机口径] 连接真实 stdio MCP 服务器（server-everything）测 echo 往返…'
    );
    trips = await benchRoundTrip(sizes);
    if (trips) {
      for (const { label } of sizes) {
        const t = trips.get(label);
        if (t) {
          console.log(
            `  ${label.padEnd(6)} echo 往返 p50 ${round(t.p50)} ms / p95 ${round(t.p95)} ms`
          );
        }
      }
    }
  } else {
    console.log('\n[真机口径] 未启用（`MCP_E2E=1` 时追加真实服务器往返对照）');
  }

  // 判定：取三种尺寸里最差的 P95；占比**只在有真机往返时**计算（不臆造分母）
  const worst = rows.reduce((a, b) => (b.secrets.p95 > a.secrets.p95 ? b : a));
  const trip = trips?.get(worst.label);
  const ratio = trip && trip.p50 > 0 ? worst.secrets.p95 / trip.p50 : undefined;

  console.log('\n--- 结论 ---');
  console.log(
    `最差尺寸 ${worst.label}：脱敏 p95 ${round(worst.secrets.p95)} ms；` +
      (trip
        ? `真实 echo 往返 p50 ${round(trip.p50)} ms ⇒ 占比 ${round((ratio as number) * 100)}%`
        : '真实 echo 往返未测（`MCP_E2E=1`）⇒ 占比 N/A（不臆造分母）')
  );
  const overMs = worst.secrets.p95 > THRESHOLD_MS;
  const overRatio = ratio !== undefined && ratio > THRESHOLD_RATIO;
  if (overMs || overRatio) {
    console.log(
      `判定：**超过阈值**（p95 > ${THRESHOLD_MS} ms 或 占比 > ${THRESHOLD_RATIO * 100}%）` +
        ' ⇒ 达到"抽异步拦截器"的触发条件（需另行评审改造）。'
    );
  } else {
    console.log(
      `判定：**未超过阈值**（p95 ≤ ${THRESHOLD_MS} ms${ratio !== undefined ? ` 且 占比 ≤ ${THRESHOLD_RATIO * 100}%` : ''}）` +
        ' ⇒ 触发条件不满足；不引入中间件链，记录结论并关闭 G-4（CS03）。'
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('压测运行失败：', err);
    process.exit(1);
  });
