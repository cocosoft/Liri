/**
 * 学习种子 → evals 语料（M3，2026-11-15；**手工执行**）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3-S4 / §5-M3。
 *
 * 链路：`approved-cases.jsonl`（人工批准产出的种子）
 *   → 本脚本（默认**只预览**；`--write` 才落盘）
 *   → `packages/evals/src/evals/tasks/learning-cases.json`（入库）
 *   → `evals --gate`。
 *
 * 安全边界：
 * - **默认不写**：产物会入库，先看预览再决定；含密钥/隐私的种子请人工脱敏或直接删除该行；
 * - **不编造期望**：`expectation` 为空/已撤销/无 `input` 的种子一律跳过（CS04/CS06）；
 * - **不自动登记基线**：新任务会被 `checkGate` 以「基线中未登记该任务」阻断 ——
 *   跑一次记录 `pass^1` 再登记 `baseline.json` 是人的第二道门。
 *
 * 用法：
 *   bun run scripts/gen-learning-eval-cases.ts                 # 预览（读默认种子文件）
 *   bun run scripts/gen-learning-eval-cases.ts -- --write      # 落盘到 evals 语料
 *   bun run scripts/gen-learning-eval-cases.ts -- --in=<jsonl> --out=<json>
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { resolveDataSubDir } from '@openliri/infra/environment';
import {
  checkCaseBaseline,
  LEARNING_CASES_FILE,
  selectLearningCaseRecords,
  type LearningCaseRecord,
} from '@modules/evals/tasks/learning-cases';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`用法：
  bun run scripts/gen-learning-eval-cases.ts
      # 预览：读种子台账，报告可成题 / 跳过条数（不写文件）
  bun run scripts/gen-learning-eval-cases.ts -- --write
      # 落盘到 packages/evals/src/evals/tasks/learning-cases.json
  bun run scripts/gen-learning-eval-cases.ts -- --in=<jsonl> --out=<json> --baseline=<json>

跳过规则：已撤销 / 已过期 / expectation 为空 / input 为空。
落盘后：bun run eval -- --gate（未在 baseline.json 登记的题会被门禁阻断）。`);
  process.exit(0);
}

/** 取 `--name=value` 值 */
function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : undefined;
}

const write = args.includes('--write');
const inPath =
  argValue('in') ||
  join(resolveDataSubDir('learning-candidates'), 'approved-cases.jsonl');
const outPath =
  argValue('out') ||
  resolve(
    import.meta.dir,
    '../../packages/evals/src/evals/tasks',
    LEARNING_CASES_FILE
  );
const baselinePath =
  argValue('baseline') ||
  resolve(import.meta.dir, '../../packages/evals/src/evals/baseline.json');

if (!existsSync(inPath)) {
  console.error(`未找到种子文件：${inPath}`);
  console.error('先执行 /learn approve <id> 产出种子，或用 --in=<jsonl> 指定路径。');
  process.exit(1);
}

const records: LearningCaseRecord[] = [];
let invalidLines = 0;
for (const line of readFileSync(inPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    records.push(JSON.parse(trimmed) as LearningCaseRecord);
  } catch {
    // @ignore-catch —— 坏行计数后如实上报（不猜内容）
    invalidLines++;
  }
}

const { eligible, skipped } = selectLearningCaseRecords(records);
const reasonCount = (reason: string) =>
  skipped.filter((s) => s.reason === reason).length;

console.log(`种子文件：${inPath}`);
console.log(
  `读取 ${records.length} 条（坏行 ${invalidLines}）｜可成题 ${eligible.length} 条`
);
console.log(
  `跳过 ${skipped.length} 条：已撤销 ${reasonCount('revoked')} / 已过期 ${reasonCount('expired')} / 无期望 ${reasonCount('no-expectation')} / 无输入 ${reasonCount('no-input')}`
);
for (const item of skipped) {
  console.log(`  - ${item.id}：${item.reason}`);
}

// 基线登记核对（M5：纯读侧，不跑模型）—— 未登记会被 checkGate 以「基线中未登记该任务」阻断
if (existsSync(baselinePath)) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as {
    tasks?: Record<string, unknown>;
  };
  const report = checkCaseBaseline(records, Object.keys(baseline.tasks ?? {}));
  console.log(
    `\n基线登记：应入语料 ${report.total} 条，已登记 ${report.registered}，未登记 ${report.blocked.length}`
  );
  for (const taskId of report.blocked) {
    console.log(`  - ${taskId}（会被 --gate 阻断）`);
  }
  if (report.blocked.length > 0) {
    console.log(
      '  登记方式：跑一次记录 pass^1 后写进 baseline.json 的 tasks（人工操作，本脚本不改基线）。'
    );
  }
} else {
  console.log(`\n基线文件不存在，跳过登记核对：${baselinePath}`);
}

if (!write) {
  if (eligible.length > 0) {
    console.log('\n预览（--write 才落盘）：');
    for (const record of eligible) {
      console.log(
        `  ${record.id}  ${record.category}  期望片段：${(record.expectation ?? '').slice(0, 60)}`
      );
    }
  }
  console.log('\n提示：确认无隐私/密钥后执行 --write 落盘。');
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
const body = `${JSON.stringify(
  eligible.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    turnNumber: r.turnNumber,
    category: r.category,
    score: r.score,
    input: r.input,
    expectation: r.expectation,
  })),
  null,
  2
)}\n`;
const tmp = `${outPath}.tmp`;
writeFileSync(tmp, body, 'utf-8');
renameSync(tmp, outPath);

console.log(`\n已写入：${outPath}（${eligible.length} 条）`);
console.log(
  '下一步：bun run eval -- --gate —— 新任务会被「基线中未登记该任务」阻断，' +
    '跑一次记录 pass^1 后在 packages/evals/src/evals/baseline.json 登记。'
);
process.exit(0);
