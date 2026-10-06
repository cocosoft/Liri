/**
 * 文档↔代码 语义一致性检查脚本 (Doc–Code Semantic Consistency Check)
 *
 * 在 CI 中运行: node scripts/check-doc-code-consistency.js
 *
 * ## 背景（A13 / R11-1，2026-10-07）
 * 本仓曾**两次**出现「文档/注释断言的状态与代码相反」的双源漂移：
 *   ① `CHANGELOG.md` v0.4.66 的 D2 条目写「应当翻转但不能单独翻转」，而
 *      `app/src/tasks/topoBatches.ts` 缺省值**已**为 `'hard'`（台账 §20.6 记 Step 1+2 已落地）；
 *   ② `app/src/core/patterns/PatternRegistry.ts` 遗留注释称 `selectPattern` 对 complex 非研究
 *      **仍返回** `long_task_pdl`，而 `PatternSelector.ts` **已**如实返回 `null`（D4）。
 * 两处均靠**人工登记 + 订正**闭合，**无门禁** ⇒ 会复发（报告 11 §五-P0 / 报告 12 §2.5）。
 *
 * 本脚本把**关键语义事实**登记为「**代码侧 ∩ 文档侧**」断言：**任一侧不符即 `exit 1`（阻断）**。
 *
 * ## 设计约束（CS03：不做投机抽象）
 * - 断言表**只登记「已真实发生过的漂移点」+「高变更风险的关键常量」**，不追求全覆盖
 *   —— 覆盖面越大越脆弱、噪声越多，反而会被绕过。
 * - **文档侧文件缺失 ⇒ 跳过并告警**（如未纳入版本控制的台账），不误报；
 *   **代码侧文件缺失 ⇒ 失败**（说明登记表需同步）。
 *
 * 对应台账：`dev_docs/任务计划-20261004.md` §24-R11-1 / §25-A13
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 断言表。每项：
 *   id        唯一标识（失败信息用）
 *   why       为什么必须一致（漂移会怎样）
 *   code      代码侧：{ file, contains? | notContains? | absent? }
 *   docs      文档侧（可空/可多）：{ file, contains? | notContains? }；文件缺失 ⇒ 跳过
 */
const ASSERTIONS = [
    {
        id: 'dependsOnMode-default-hard',
        why: '缺省依赖模式必须为 hard（A3 / 13-P1-1 Step 2，2026-10-06 翻转）；回退 soft 会让「前驱失败不阻断」静默复发',
        code: {
            file: 'app/src/tasks/topoBatches.ts',
            contains: /opts\?\.defaultDependencyMode\s*\?\?\s*'hard'/,
        },
        docs: [{ file: 'CHANGELOG.md', contains: /最终状态＝已翻转/ }],
    },
    {
        id: 'a2a-discovery-path',
        why: 'A2A Agent Card 发现路径必须为 A2A v1.0 规范的 `/.well-known/agent-card.json`（CHANGELOG v0.4.65-A5）',
        code: {
            file: 'app/src/infrastructure/http/handlers/routes/a2a-routes.ts',
            contains: /'\/\.well-known\/agent-card\.json'/,
        },
        docs: [{ file: 'CHANGELOG.md', contains: /\/\.well-known\/agent-card\.json/ }],
    },
    {
        id: 'a2a-not-ready-503',
        why: '委派后端未就绪必须返回 503 + `Retry-After`（A12；501 语义为「永不支持」= 误导外部调用方）',
        code: {
            file: 'app/src/infrastructure/http/handlers/routes/a2a-routes.ts',
            contains: /json\(res,\s*503/,
        },
        docs: [{ file: '.trae/docs/api-spec.md', contains: /503[\s\S]{0,200}Retry-After/ }],
    },
    {
        id: 'skill-service-removed',
        why: '`skills/services/skillService.ts` 已删除（P2-8 ② B 类复核，2026-10-07）；复活即违反 `Skill.impl` 必填收敛',
        code: { file: 'app/src/skills/services/skillService.ts', absent: true },
        docs: [{ file: '.trae/rules/project_rules.md', contains: /skillService\.ts[^\n]*已于 2026-10-07/ }],
    },
    {
        id: 'pattern-registry-no-stale-debt',
        why: '`PatternRegistry` 必须保持 D4 订正版（描述层与选择层已一致）；旧措辞「已登记为预存语义债」若复现即为漂移回归',
        code: {
            file: 'app/src/core/patterns/PatternRegistry.ts',
            // 正向：订正后的表述在位（引用原文时含「仍返回本 pattern」字样，故不能只做负向匹配）
            contains: /矛盾\*\*已解除\*\*/,
            // 负向：旧陈述的**结论句**（订正版写作「原"预存语义债"消除」，故该短语仅存在于旧版）
            notContains: /已登记为预存语义债/,
        },
        docs: [],
    },
];

function readIfExists(rel) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, 'utf-8');
}

/** 检查单个「文件 × 规则」；返回错误串数组（空 = 通过） */
function checkRule(rule, label) {
    const errors = [];
    const content = readIfExists(rule.file);

    if (rule.absent) {
        if (content !== null) errors.push(`${label} 期望文件不存在，但实际存在：${rule.file}`);
        return errors;
    }

    if (content === null) {
        errors.push(`${label} 文件不存在：${rule.file}`);
        return errors;
    }
    if (rule.contains && !rule.contains.test(content)) {
        errors.push(`${label} 缺少应有的内容：/${rule.contains.source}/（文件 ${rule.file}）`);
    }
    if (rule.notContains && rule.notContains.test(content)) {
        errors.push(`${label} 含禁止的过期内容：/${rule.notContains.source}/（文件 ${rule.file}）`);
    }
    return errors;
}

function main() {
    console.log('=== 文档↔代码 语义一致性检查 (A13 / R11-1) ===\n');

    const failures = [];
    let checkedDocs = 0;
    let skippedDocs = 0;

    for (const a of ASSERTIONS) {
        failures.push(...checkRule(a.code, `[${a.id}] 代码侧`));

        for (const doc of a.docs || []) {
            if (readIfExists(doc.file) === null) {
                console.log(`  ⚠️  跳过（文档缺失，未纳入版本控制？）：${doc.file}  ← ${a.id}`);
                skippedDocs += 1;
                continue;
            }
            checkedDocs += 1;
            failures.push(...checkRule(doc, `[${a.id}] 文档侧`));
        }
    }

    console.log(`断言 ${ASSERTIONS.length} 条 ｜ 文档侧 已校验 ${checkedDocs} 处 · 跳过 ${skippedDocs} 处`);
    console.log('-'.repeat(60));

    if (failures.length === 0) {
        console.log('\n✅ 文档与代码语义一致');
        process.exit(0);
    }

    console.log(`\n❌ 检出 ${failures.length} 处不一致（漂移即阻断）:\n`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log('\n处置：以**代码为唯一事实源**订正文档/注释（勿反向改码迁就文档）；');
    console.log('若属有意变更，请**同批**更新对应文档并复核本脚本的断言表。');
    process.exit(1);
}

main();
