#!/usr/bin/env bun
/**
 * verify-p38-reply-shadow.ts — P38「reply 影子双跑」端到端验证（2026-11-10）
 *
 * 为什么需要脚本：P38 观察期依赖「渠道审批 → 回传 → 影子写」这条真实链路，手工搭台
 * （本地接收端 + daemon + 审批项 + 读库）步骤多、易漂移。本脚本把该流程固化，供评审/
 * 回归一键复跑。
 *
 * 链路（全部真实，不做 mock）：
 *   本地 HTTP 接收端（/ok ⇒ 200，/fail ⇒ 500）
 *   → 隔离数据目录起 `daemon`（`WEBHOOK_LISTEN_PORT` 启用 webhook 通道）
 *   → 创建两条带 `channelId='webhook'` 的审批项（`/ok` 与 `/fail` 各一，子进程播种）
 *   → `POST /v1/inbox/:id/reply` 触发**真实**回传 + 影子写
 *   → 断言 `effect_queue` 两行 `kind='reply'`、`realDelivered` 为 1 / 0
 *   → 计算差异率（总 2 / 分子 1 ⇒ 50%）
 *
 * 用法（app 目录下）：
 *   bun run verify:p38                 # 自动挑空闲端口，跑完清理
 *   bun run verify:p38 -- --keep       # 保留临时目录与日志（排障用）
 *   bun run verify:p38 -- --http-port=19099 --receiver-port=19097 --webhook-port=19098
 *
 * 退出码：0 = PASS；1 = FAIL（打印诊断）；2 = 参数/环境错误。
 */

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Database } from 'bun:sqlite';

interface Args {
  keep: boolean;
  httpPort: number;
  receiverPort: number;
  webhookPort: number;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const num = (name: string, fallback: number): number => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    const v = hit ? Number(hit.slice(name.length + 3)) : NaN;
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
  };
  return {
    keep: argv.includes('--keep'),
    // 0 = 自动挑空闲端口（默认；避免与残留实例/其它服务撞端口）
    httpPort: num('http-port', 0),
    receiverPort: num('receiver-port', 0),
    webhookPort: num('webhook-port', 0),
  };
}

/** 取一个当前空闲的本地端口（立即释放，交给后续进程绑定） */
async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * 按端口精确终止监听进程（Windows 专用兜底）。
 *
 * 为什么需要：`bun src/main.ts` 在 Windows 会 re-exec 出真正跑服务的子进程，
 * `child.kill()` 可能只终止 launcher ⇒ daemon 存活、sqlite 句柄不释放。
 */
function killListenerByPort(port: number): void {
  if (process.platform !== 'win32') return;
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force }`,
    ],
    { stdio: 'ignore' }
  );
}

/** 轮询直到 `probe()` 为真（返回产物）或超时 */
async function waitFor<T>(
  label: string,
  timeoutMs: number,
  probe: () => Promise<T | null>
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() >= deadline) {
      throw new Error(`等待超时：${label}（${timeoutMs}ms）`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

interface EffectRow {
  key: string;
  status: string;
  realDelivered: number | null;
}

/** 读影子行；表未建 ⇒ 返回 null（继续等） */
function readShadows(dbPath: string): EffectRow[] | null {
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    return db
      .query(
        `SELECT key, status, json_extract(payload_json,'$.realDelivered') AS realDelivered
           FROM effect_queue WHERE kind = 'reply'`
      )
      .all() as EffectRow[];
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // 已关闭
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const httpPort = args.httpPort || (await freePort());
  const receiverPort = args.receiverPort || (await freePort());
  const webhookPort = args.webhookPort || (await freePort());
  const appDir = join(import.meta.dir, '..');
  const home = join(tmpdir(), `liri-p38-verify-${randomUUID().slice(0, 8)}`);
  const dataDir = join(home, 'data');
  const dbPath = join(dataDir, 'app.db');
  mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    LIRI_HOME: home,
    LIRI_DATA_DIR: dataDir,
    PERMISSION_MODE: 'bypass',
    WEBHOOK_LISTEN_PORT: String(webhookPort),
    // 影子模式：开关保持关闭（打开则由订阅者派发，不再是"双跑对照"）
    FEATURE_EFFECT_REPLY_MIGRATION: 'false',
  };

  console.log('=== P38 reply 影子双跑端到端验证 ===');
  console.log(`隔离目录：${home}`);
  console.log(
    `端口：http=${httpPort} · webhook=${webhookPort} · receiver=${receiverPort}`
  );

  const received: Array<{ path: string; text: string }> = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      let text = '';
      try {
        text = String((JSON.parse(body) as { text?: unknown }).text ?? '');
      } catch {
        text = body;
      }
      received.push({ path, text });
      const ok = path === '/ok';
      res.writeHead(ok ? 200 : 500, { 'Content-Type': 'text/plain' });
      res.end(ok ? 'ok' : 'boom');
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(receiverPort, '127.0.0.1', resolve)
  );
  console.log(`[1/6] 本地接收端已启动（${receiverPort}）`);

  const server = spawn(
    'bun',
    ['src/main.ts', 'daemon', `--http-port=${httpPort}`],
    { cwd: appDir, env, stdio: 'ignore' }
  );

  try {
    const base = `http://127.0.0.1:${httpPort}`;
    await waitFor('daemon 就绪且 webhook 通道已注册', 120_000, async () => {
      try {
        const res = await fetch(`${base}/v1/channels/health`);
        if (!res.ok) return null;
        const body = (await res.json()) as {
          channels?: Array<{ channelId?: string }>;
        };
        return body.channels?.some((c) => c.channelId === 'webhook')
          ? true
          : null;
      } catch {
        return null;
      }
    });
    console.log('[2/6] daemon 就绪，webhook 通道已注册');

    // 创建审批项：交给**子进程**播种（`InboxManager` 持 sqlite 句柄，留在主进程会让临时目录删不掉）
    const probe = spawnSync('bun', ['run', 'scripts/p38-inbox-probe.ts'], {
      cwd: appDir,
      env: { ...env, P38_RECEIVER_BASE: `http://127.0.0.1:${receiverPort}` },
      encoding: 'utf8',
    });
    const probeOut = (probe.stdout ?? '').trim().split('\n').filter(Boolean);
    const last = probeOut[probeOut.length - 1] ?? '';
    if (probe.status !== 0) {
      throw new Error(
        `审批项播种失败（exit=${String(probe.status)}）：${(probe.stderr ?? '').slice(-400)}`
      );
    }
    const { okId, failId } = JSON.parse(last) as {
      okId: string;
      failId: string;
    };
    console.log(`[3/6] 已创建审批项：ok=${okId} · fail=${failId}`);

    for (const id of [okId, failId]) {
      const res = await fetch(`${base}/v1/inbox/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: 'approve' }),
      });
      if (!res.ok) throw new Error(`回复审批失败：${id} ⇒ HTTP ${res.status}`);
    }
    console.log('[4/6] 两条审批已回复（触发真实回传 + 影子写）');

    const rows = await waitFor(
      'effect_queue 出现 2 行 reply 影子记录',
      30_000,
      async () => {
        const now = readShadows(dbPath);
        return now && now.length >= 2 ? now : null;
      }
    );
    console.log(`[5/6] 影子记录 ${rows.length} 行`);

    const okRow = rows.find((r) => r.key.endsWith(okId));
    const failRow = rows.find((r) => r.key.endsWith(failId));
    const failures: string[] = [];
    if (!okRow) failures.push('缺少 /ok 影子行');
    if (!failRow) failures.push('缺少 /fail 影子行');
    if (okRow && okRow.realDelivered !== 1) {
      failures.push(
        `/ok realDelivered 应为 1，实际 ${String(okRow.realDelivered)}`
      );
    }
    if (failRow && failRow.realDelivered !== 0) {
      failures.push(
        `/fail realDelivered 应为 0，实际 ${String(failRow.realDelivered)}`
      );
    }
    const failed = rows.filter((r) => r.realDelivered === 0).length;
    const rate =
      rows.length > 0 ? ((failed / rows.length) * 100).toFixed(1) : '0.0';
    console.log(
      `[6/6] 差异率：总 ${rows.length} / 分子 ${failed} / ${rate}%（端到端 2 样本）`
    );

    // 交叉印证：接收端确实收到了 POST（失败端点按 maxRetries 重试）
    const okPosts = received.filter((r) => r.path === '/ok').length;
    const failPosts = received.filter((r) => r.path === '/fail').length;
    console.log(
      `      接收端：/ok ${okPosts} 次 · /fail ${failPosts} 次（含重试）`
    );
    if (okPosts < 1) failures.push('接收端未收到 /ok 的 POST');
    if (failPosts < 2) failures.push('/fail 未发生重试（期望 ≥2 次 POST）');

    if (failures.length > 0) {
      console.error('\n❌ FAIL');
      for (const f of failures) console.error(`  - ${f}`);
      console.error(
        `  诊断：数据目录 ${home}（app.log 在 ${join(dataDir, 'logs')}）`
      );
      process.exitCode = 1;
      return;
    }
    console.log('\n✅ PASS —— reply 影子双跑端到端链路与差异率取数均正常');
  } finally {
    try {
      server.kill('SIGKILL');
    } catch {
      // 已退出
    }
    // Windows：`bun src/main.ts` 可能 re-exec，按监听端口再兜底杀一次
    killListenerByPort(httpPort);
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    if (args.keep) {
      console.log(`\n临时目录已保留：${home}`);
    } else {
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(home, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      } catch {
        console.log(`临时目录清理失败（可手动删）：${home}`);
      }
    }
  }
}

await main();
// lint:exit（台账 N-16 / N-49）：入口脚本必须显式退出
process.exit(process.exitCode ?? 0);
