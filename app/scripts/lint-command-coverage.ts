/**
 * lint-command-coverage — 命令语义覆盖率棘轮（P4，2026-11-12）
 *
 * 目的：命令治理的"未分类"部分只能**减少**，不能悄悄增加。
 *
 * 断言（fail-closed，任何异常 ⇒ exit 1）：
 *  ① 每条 `CommandSpec` 至少声明 `token` / `equivalents` / `readonlySubcommands` 之一；
 *  ② **未声明 `kind`** 的 spec 数量不得超过基线（新增条目必须带语义分类）。
 *
 * 运行：`bun run lint:command-coverage`（CI / 本地）
 */
import { COMMAND_SPECS } from '../../packages/infra/src/security/patterns/commandSpecs';

/**
 * 基线：P1b 从历史硬拦表迁入的存量条目（当时只按名字分档，没有语义分类）。
 * **只能下调** —— 每给一批条目补上 `kind`，就同步调低此值。
 */
const BASELINE_WITHOUT_KIND = 0;

const total = COMMAND_SPECS.length;
const withoutKind = COMMAND_SPECS.filter((spec) => !spec.kind);
const empty = COMMAND_SPECS.filter(
  (spec) =>
    !spec.token &&
    (spec.equivalents?.length ?? 0) === 0 &&
    !spec.readonlySubcommands
);

const problems: string[] = [];
if (empty.length > 0) {
  problems.push(
    `有 ${empty.length} 条 spec 既无 token、也无 equivalents / readonlySubcommands`
  );
}
if (withoutKind.length > BASELINE_WITHOUT_KIND) {
  problems.push(
    `未声明 kind 的 spec 增至 ${withoutKind.length}（基线 ${BASELINE_WITHOUT_KIND}）`
  );
}

console.log(
  `[command-coverage] specs=${total} withoutKind=${withoutKind.length} baseline=${BASELINE_WITHOUT_KIND}`
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`❌ ${problem}`);
  process.exit(1);
}
console.log('✅ [command-coverage] 语义覆盖率未退化');
