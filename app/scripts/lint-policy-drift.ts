/**
 * lint:policy-drift — 沙箱危险清单 × 命令注册表 对拍（P5-4，2026-11-12）
 *
 * 背景：漂移审计（方案 §13）发现 `DangerousCommandChecker` 与 auto 档曾各有一套档位
 * （`killall` / `umount` / `swapon` … 沙箱 deny、auto 仅 ask）。本脚本把两边的
 * **命令清单**拉通对比，输出差异表，防止以后再次漂移。
 *
 * 口径：**只报警不阻断**（exit 0）。原因：沙箱层允许比 auto 更严（CD07 纵深防御），
 * 差异里有一部分是刻意分层；硬失败会逼着把分层也"对齐"掉。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTO_MODE_HARD_DENY_TOKENS } from '../../packages/infra/src/security/patterns/autoModeCommandTokens';
import { expandTokenAliases } from '../../packages/infra/src/security/patterns/commandAliases';
import { sandboxPath } from '../../scripts/lib/sandboxPaths';

/** 负向自证可注入路径（坏输入必须 exit 1，不得假绿） */
const SANDBOX_FILE =
  process.env['POLICY_DRIFT_SANDBOX_FILE'] ||
  sandboxPath(
    resolve(import.meta.dir, '..', '..'),
    'utils',
    'DangerousCommandChecker.ts'
  );

let text = '';
try {
  text = readFileSync(SANDBOX_FILE, 'utf8');
} catch {
  console.error(`❌ 无法读取沙箱清单：${SANDBOX_FILE}`);
  process.exit(1);
}

const autoDeny = new Set(
  AUTO_MODE_HARD_DENY_TOKENS.flatMap((token) => {
    const trimmed = token.trim().toLowerCase();
    return [trimmed, ...expandTokenAliases(trimmed)];
  })
);

const sandboxCommands = new Set<string>();
const blockStart = text.indexOf('DANGEROUS_PATTERNS');
const blockEnd = blockStart >= 0 ? text.indexOf('\n];', blockStart) : -1;
const block =
  blockStart >= 0 && blockEnd > blockStart ? text.slice(blockStart, blockEnd) : '';
// AR-3：解析不到清单不得当成"0 差异"。常量被改名 / 改成对象数组 / 引号风格变化
// 时，若继续走下面的空集合分支，会打印"✅ 已对齐"并以 0 退出（假绿）。
if (!block) {
  console.error(
    `❌ 解析不到 DANGEROUS_PATTERNS 数组（${SANDBOX_FILE}）—— 结构变更即视为门禁失败，不得假绿`
  );
  process.exit(1);
}
for (const match of block.matchAll(/'([^']+)'|"([^"]+)"/g)) {
  const token = (match[1] ?? match[2] ?? '').trim().toLowerCase();
  if (/^[a-z][a-z0-9_-]*$/.test(token)) sandboxCommands.add(token);
}
// 清单异常小（当前 33 条）说明抽取口径已失效，同样不得当成"已对齐"。
const SANDBOX_MIN_TOKENS = 10;
if (sandboxCommands.size < SANDBOX_MIN_TOKENS) {
  console.error(
    `❌ 沙箱清单只抽到 ${sandboxCommands.size} 条（下限 ${SANDBOX_MIN_TOKENS}）—— 抽取口径可能失效`
  );
  process.exit(1);
}

const sandboxOnly = [...sandboxCommands]
  .filter((token) => !autoDeny.has(token))
  .sort();
const autoOnly = [...autoDeny]
  .filter((token) => /^[a-z][a-z0-9_-]*$/.test(token) && !sandboxCommands.has(token))
  .sort();

console.log(
  `[policy-drift] sandbox=${sandboxCommands.size} autoDeny=${autoDeny.size} ` +
    `sandboxOnly=${sandboxOnly.length} autoOnly=${autoOnly.length}`
);

if (sandboxOnly.length > 0) {
  console.warn(
    `⚠ 沙箱更严（auto 档不 deny）：${sandboxOnly.slice(0, 30).join(' ')}`
  );
}

if (sandboxOnly.length === 0) {
  console.log('✅ 两侧命令清单已对齐（不存在"沙箱严于 auto 档"的漂移）');
}
