/**
 * D-2（2026-10-18）「零消费者常量」守卫（清单 §5 D-2 第 2 条）。
 *
 * 判据：`app/src/constants/` 的每个 `export const` 必须在**定义行之外**至少被引用一次
 * （含同目录常量之间的互相引用，如 `USER_AGENT` 用 `APP_VERSION`）；否则它是「假真源」
 * —— 承接 `common.ts` 里记录的 `DEFAULT_LOCALE`/`DEFAULT_TIMEZONE` 历史（原零消费者，改值也不生效）。
 *
 * **推进方式 = 基线只减不增**（与 `hardcode-gate-baseline.json` 同模式）：
 * - 当前零消费者集合必须与 `zero-consumer-baseline.json` **完全一致**；
 * - 新增零消费者 ⇒ 失败（要么接上消费者，要么登记基线并写明理由）；
 * - 已接上消费者的旧条目 ⇒ 也失败（提示从基线删除，防止基线腐化）。
 * - 播种 / 下调：`ZERO_CONSUMER_BASELINE_WRITE=1 bun test tests/constants/zeroConsumerConsts.test.ts`
 *
 * 计数口径：全仓标识符出现次数 − 1（该常量的定义行）。
 * `index.ts`（barrel 转发）与 `*.generated.ts` 不计入语料（barrel 不是消费者）；
 * 只收集**计数口径可识别**的名字（全大写、≥3 字符）—— 小写 / 混合大小写导出
 * 无法被 `\b[A-Z][A-Z0-9_]{2,}\b` 匹配，纳入即永久假阳性。
 *
 * D-2 下调（2026-10-18）：基线 **169 → 1**。168 条零消费者已按域删除
 * （messages / figures / xml / betas / common / apiLimits / toolLimits / keys / product / system）；
 * 唯一保留 `CYBER_RISK_INSTRUCTION` —— 安全指令文本，按 `code-deletion.md` CD07
 * 「安全域不得以零静态引用为删除依据」保留，待安全评审后接线或另立下线计划。
 */
import { describe, it, expect } from 'bun:test';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { join, resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dir, '../..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const CONSTANTS_DIR = join(APP_ROOT, 'src', 'constants');
const BASELINE_PATH = join(import.meta.dir, 'zero-consumer-baseline.json');

/** 递归收集源码文件（跳过构建产物与依赖目录；barrel / 生成文件不参与计数） */
function collectSources(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.git' ||
      entry.name === 'target'
    )
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(full, out);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      // barrel 只是转发，生成文件不可手改 ⇒ 都不算消费者
      if (entry.name === 'index.ts') continue;
      if (entry.name.endsWith('.generated.ts')) continue;
      out.push(full);
    }
  }
}

/**
 * 常量名 → 定义文件（排除 barrel 与生成文件）
 *
 * D-2（2026-10-18）：**只收集计数口径能识别的名字**（全大写、≥3 字符）。
 * 计数用 `\b[A-Z][A-Z0-9_]{2,}\b` —— 小写/混合大小写导出（如 `sectionCache`、
 * `localToolUseSection`、`Liri_20250219_BETA_HEADER`）**永远不可能被匹配**，
 * 若仍纳入收集，就会成为「永久零消费者」假阳性（此前 3 条基线即由此产生）。
 */
function collectConstNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of readdirSync(CONSTANTS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    if (file === 'index.ts' || file.endsWith('.generated.ts')) continue;
    const source = readFileSync(join(CONSTANTS_DIR, file), 'utf-8');
    for (const m of source.matchAll(
      /^export\s+const\s+([A-Z][A-Z0-9_]{2,})\b/gm
    )) {
      names.set(m[1], file);
    }
  }
  return names;
}

/** 全仓标识符出现次数（一次扫描建表；含 `constants/` 以计入常量间互引） */
function buildIdentifierCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  const files: string[] = [];
  collectSources(join(APP_ROOT, 'src'), files);
  collectSources(join(APP_ROOT, 'tests'), files);
  collectSources(join(REPO_ROOT, 'client', 'src'), files);
  collectSources(join(REPO_ROOT, 'scripts'), files);

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    for (const line of source.split('\n')) {
      // 注释不是消费者：跳过行注释 / 块注释正文（行内注释保留，宁可少判死）
      const trimmed = line.trim();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      )
        continue;
      for (const m of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
        counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** 当前零消费者常量（名 → 定义文件） */
function findZeroConsumers(): Map<string, string> {
  const names = collectConstNames();
  const counts = buildIdentifierCounts();
  const zero = new Map<string, string>();
  for (const [name, file] of names) {
    // 定义行本身占 1 次 ⇒ 出现次数 > 1 才算有消费者
    if ((counts.get(name) ?? 0) <= 1) zero.set(name, file);
  }
  return zero;
}

function readBaseline(): string[] {
  if (!existsSync(BASELINE_PATH)) return [];
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as string[];
  return Array.isArray(raw) ? raw : [];
}

describe('D-2 零消费者常量（基线只减不增）', () => {
  it('当前零消费者集合与基线一致（新增 ⇒ 阻断；已接线 ⇒ 需下调基线）', () => {
    const zero = findZeroConsumers();
    const current = [...zero.keys()].sort();

    // 播种 / 下调：显式环境变量才写文件（避免测试无意改基线）
    if (process.env.ZERO_CONSUMER_BASELINE_WRITE === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
      console.log(`[zero-consumer] 🌱 已写入基线：${current.length} 条`);
      return;
    }

    const baseline = new Set(readBaseline());
    const added = current.filter((name) => !baseline.has(name));
    const removed = [...baseline].filter((name) => !zero.has(name)).sort();

    if (added.length > 0) {
      console.log(
        `未登记的零消费者常量（${added.length}）—— 接上消费者或登记基线：\n` +
          added.map((name) => `  ${name}  (${zero.get(name)})`).join('\n')
      );
    }
    if (removed.length > 0) {
      console.log(
        `已接上消费者的历史条目（${removed.length}）—— 请从基线删除：\n  ` +
          removed.join('\n  ')
      );
    }

    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });
});
