/**
 * P38-b-2 影子双跑「差异率」统计（2026-11-05）
 *
 * 用法：
 *   bun run reply-shadow:rate              # 读默认库（`resolveDbPath()`）
 *   bun run reply-shadow:rate -- --db <p>  # 指定库（隔离实例/历史快照）
 *
 * 口径（方案 §5「双跑对照」）：
 * - **分母** = `effect_queue` 中 `kind='reply'` 的影子行数（每条 = 一次真实回传结束后的对照写）；
 * - **分子** = 其中 `payload.realDelivered=false` 的行（真实投递失败，而影子仍入队 ⇒ 两侧分叉）；
 * - **差异率** = 分子 / 分母，观察期内应趋近 0。
 *
 * 为什么从库而不是从日志：日志随轮转/重启丢失（制品保留 14 天），而观察期要跨周复算；
 * `realDelivered` 是影子载荷的**观察字段**，见 `src/tasks/effects/replyShadow.ts`。
 *
 * 只读：不写库、不派发、不改任何状态。
 */
import { Database } from 'bun:sqlite';

import { resolveDbPath } from '@openliri/infra/environment/paths';

import { judgeObservationPeriod } from '../src/tasks/effects/observationWindow';

const REPLY_KIND = 'reply';

interface BucketRow {
  realDelivered: number | null;
  status: string;
  c: number;
  minCreatedAt: number;
  maxCreatedAt: number;
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function main(): void {
  const dbPath = argValue(process.argv.slice(2), '--db') ?? resolveDbPath();
  console.log('=== P38 reply 影子双跑差异率 ===');
  console.log(`库：${dbPath}`);

  const db = new Database(dbPath, { readonly: true });
  try {
    let rows: BucketRow[];
    try {
      rows = db
        .query(
          `SELECT json_extract(payload_json, '$.realDelivered') AS realDelivered,
                  status,
                  COUNT(*) AS c,
                  MIN(created_at) AS minCreatedAt,
                  MAX(created_at) AS maxCreatedAt
             FROM effect_queue
            WHERE kind = ?
            GROUP BY realDelivered, status`
        )
        .all(REPLY_KIND) as BucketRow[];
    } catch (err) {
      console.log(`无法读取 effect_queue：${String(err)}`);
      console.log('结论：队列尚未初始化（还没有任何 effects 记录）。');
      return;
    }

    const total = rows.reduce((sum, r) => sum + r.c, 0);
    if (total === 0) {
      console.log('总影子记录：0');
      console.log(
        '结论：观察期尚未开始 —— 没有任何「渠道审批 → 回传」样本（需先有渠道入站消息并完成审批回传）。'
      );
      const empty = judgeObservationPeriod({ samples: 0, days: 0 });
      console.log(`观察期判定：${empty.status} —— ${empty.reason}`);
      return;
    }

    const failed = rows
      .filter((r) => r.realDelivered === 0)
      .reduce((sum, r) => sum + r.c, 0);
    const legacy = rows
      .filter((r) => r.realDelivered === null)
      .reduce((sum, r) => sum + r.c, 0);
    const counts = new Map<string, number>();
    for (const r of rows)
      counts.set(r.status, (counts.get(r.status) ?? 0) + r.c);
    const minAt = Math.min(...rows.map((r) => r.minCreatedAt));
    const maxAt = Math.max(...rows.map((r) => r.maxCreatedAt));

    console.log(`总影子记录：${total}`);
    console.log(`真实投递失败（分子）：${failed}`);
    console.log(`差异率：${pct(failed / total)}（观察项，未门禁化）`);
    console.log(
      `状态分布：${[...counts.entries()].map(([s, c]) => `${s}=${c}`).join(' / ')}`
    );
    console.log(`观察窗口：${iso(minAt)} ~ ${iso(maxAt)}`);
    // 2026-11-10：观察期进度（一周判定需要"覆盖天数 + 样本量"，只看总量不够）
    const daily = db
      .query(
        `SELECT date(created_at/1000,'unixepoch','localtime') AS day, COUNT(*) AS c
           FROM effect_queue WHERE kind = ? GROUP BY day ORDER BY day`
      )
      .all(REPLY_KIND) as Array<{ day: string; c: number }>;
    console.log(
      `覆盖天数：${daily.length} 天（${daily.map((d) => `${d.day}=${d.c}`).join(' / ')}）`
    );
    const judgement = judgeObservationPeriod({
      samples: total,
      days: daily.length,
    });
    console.log(`观察期判定：${judgement.status} —— ${judgement.reason}`);
    if (legacy > 0) {
      console.log(
        `⚠️ 另有 ${legacy} 行为观察字段上线前写入（无 realDelivered），不计入分子/分母`
      );
    }
    console.log(
      failed === 0
        ? '结论：影子与真实投递一一对应（差异率 0）。'
        : `结论：存在 ${failed} 处分叉，需逐条解释（真实失败但影子会重试）。`
    );
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main();

  // lint:exit（台账 N-16 / N-49）：入口脚本必须显式退出。
  // 本脚本虽 `db.close()` 后无长驻句柄，但守卫按「入口必须显式 exit」统一要求 ——
  // 一旦将来引入定时器 / 连接池，缺 exit 会表现为"命令卡住不返回"。
  process.exit(0);
}
