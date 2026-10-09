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
    {
        id: 'long-task-pdl-assembly-unavailable',
        why:
            '`long_task_pdl` 的运行时语义是「**简单任务**快速路径」（`ChatManager._shouldUsePlanDrivenLoop`：简单/非危险 ⇒ PDL 快速路径，复杂/危险 ⇒ 经典 PDCA 阶段链）—— ' +
            '**与 pattern 名「long_task」相反**。装配层**刻意**登记为 unavailable（`patternAssembler` 自陈「D2 = 以运行时为准」）。' +
            '若有人以「补齐装配」为由给它接 route，会让**简单任务**误走长任务装配 ⇒ R07-1 取证（2026-10-07）要求：此处改动必须**人工决策 + 更新本断言**，不得静默「修好」',
        code: {
            file: 'app/src/query/patternAssembler.ts',
            // 正向：刻意 unavailable 形态（仅 reason、无 route）仍在位
            contains: /long_task_pdl:\s*\{\s*reason:/,
            // 负向：一旦出现 route ⇒ 说明被「补齐装配」（高风险误改）
            notContains: /long_task_pdl:\s*\{[^}]*\broute:/,
        },
        docs: [],
    },
    {
        id: 'a2a-enabled-default-off',
        why:
            'A2A 对外面必须**默认关闭**（spec G4「未显式启用时不得监听对外」）—— 只认 `=== \'true\'`，' +
            '**禁止**改成 `!== \'false\'` 之类"默认开"形态（R07-4 默认值固化，2026-10-07）',
        code: {
            file: 'app/src/infrastructure/http/handlers/routes/a2a-routes.ts',
            contains: /env\(ENV_A2A_ENABLED\)\s*===\s*'true'/,
            // 负向：任何"默认开"写法（!== 'false' / !== undefined 等）即漂移
            notContains: /env\(ENV_A2A_ENABLED\)\s*!==\s*'false'/,
        },
        docs: [
            {
                file: '.trae/specs/a2a-external-exposure.md',
                contains: /G4（默认关闭 \/ fail-closed）/,
            },
        ],
    },
    {
        id: 'a2a-auth-fail-closed',
        why:
            'A2A 鉴权必须 **fail-closed**：`A2A_API_KEYS` **无有效钥**（未配置/空白/全过期/全非法）⇒ **一律拒绝**，' +
            '**刻意不**回退到既有 API 的"未配密钥即放行（本地信任基线）"（对外面 ≠ 本机 API；spec T6）—— ' +
            '若有人为"本地调试方便"加回退，等于对外裸奔（R07-4，2026-10-07；多钥版见 a2a-multikey-rotation.md）',
        code: {
            file: 'app/src/infrastructure/http/handlers/routes/a2a-routes.ts',
            contains: /if\s*\(keys\.length === 0\)\s*return\s+false;/,
        },
        docs: [
            {
                file: '.trae/specs/a2a-external-exposure.md',
                contains: /未配置 ⇒ \*\*401\*\*/,
            },
        ],
    },
];

/**
 * 安全相关功能开关清单（R07-2，2026-10-07）
 *
 * **单一事实源 = 本表**，与 `.trae/rules/project_rules.md` §1.4 的同名表格**逐项对偶**：
 * 一项断言 = 代码侧 `featureFlags.ts` 的**字面默认值** ∩ 文档侧 `project_rules.md` 的**同值行**。
 *
 * 目的：让「安全开关默认值」成为**受 CI 约束的事实** —— 误翻转（尤其 `OUTPUT_GUARD`：
 * 见 `.trae/specs/guardrails-dual-side.md` §9.2 的 FP 量化与 P1–P5 前置）会**立即阻断 CI**，
 * 而不是等线上行为变化才被察觉。
 *
 * ⚠️ 改默认值 ⇒ **同批**更新 ① 本表 ② `featureFlags.ts` ③ `project_rules.md` §1.4，三者缺一即失败。
 */
const SAFETY_SWITCHES = [
    { name: 'VERIFIER_FAIL_CLOSED', def: true, why: '验证器失败必须判失败（不静默通过）' },
    { name: 'PERMISSION_CHECKS', def: true, why: '工具执行前权限校验不得默认关闭' },
    { name: 'SECURITY_SCAN', def: true, why: '输入安全扫描不得默认关闭' },
    { name: 'SECURITY_AUDIT', def: true, why: '安全审计留痕不得默认关闭' },
    { name: 'SANDBOX', def: true, why: '沙箱隔离不得默认关闭' },
    { name: 'UNATTENDED_MODE', def: false, why: '无人值守必须默认关（须显式开启）' },
    {
        name: 'OUTPUT_GUARD',
        def: false,
        why: '输出护栏存在高 FP（MIT 协议头邮箱 / 密钥字段）与静默改写代价，未满足 §9.2 P1–P5 前不得默认开',
    },
    { name: 'OUTPUT_GUARD_BLOCK', def: false, why: '阻断模式须显式开启（仅在 OUTPUT_GUARD 开启后生效）' },
    {
        name: 'OUTPUT_GUARD_KEEP_ORIGINAL',
        def: false,
        why: '护栏改写审计默认**不落原文**（P26-2 P4）：开 = 未打码内容落入本地事件日志',
    },
    { name: 'RESOURCE_GOVERNOR', def: false, why: '跨会话抢占/排队须显式开启（默认关 = 零行为变更）' },
    { name: 'PRO_SECURITY_SUITE', def: false, why: '高级安全套件须显式开启' },
    // A2/A4/A5（2026-10-09）：Bash 安全姿态开关。
    // A2 于 2026-10-09 由用户裁定**翻转为安全基线**（默认 true；第九轮审查 §七）——
    // **仍保留本断言**（`def: true`）：防止其被静默翻回默认关（R07-2 默认值固化）。
    {
        name: 'BASH_APPROVED_REVALIDATE',
        def: true,
        why: '已批准命令安全复检已是**安全基线**（第九轮审查 §七；关 = 已批准命令跳过整套硬拦截）—— 回退须显式改本断言 + project_rules',
    },
    {
        name: 'BASH_INTERPRETER_GUARD',
        def: false,
        why: '解释器命令人工确认须显式开启（默认关 = 白名单内直接放行）',
    },
    { name: 'BASH_APPROVAL_STRICT', def: false, why: '批准严格模式（禁用命令名级放行）须显式开启' },
    // PR2（2026-10-09）：两段式取消灰度开关（默认关 = 保留既有"超时即释放"行为）
    { name: 'EXECUTION_TWO_PHASE_CANCEL', def: false, why: '两段式取消（未确认则保留 lease）须显式开启' },
];

/** 由清单派生的断言（避免 11 条近重复手写条目） */
const SAFETY_ASSERTIONS = SAFETY_SWITCHES.map((s) => ({
    id: `safety-switch-default-${s.name}`,
    why: `安全相关开关默认值须与 project_rules.md §1.4 清单一致（R07-2）—— ${s.why}`,
    code: {
        file: 'app/src/core/featureFlags.ts',
        contains: new RegExp(`^\\s*${s.name}:\\s*${s.def},`, 'm'),
    },
    docs: [
        {
            file: '.trae/rules/project_rules.md',
            contains: new RegExp(`\\|\\s*\`${s.name}\`\\s*\\|\\s*\`${s.def}\``),
        },
    ],
}));

/** 触发条件登记表（单一事实源；见 `.trae/specs/default-off-switches-review-gates.md`） */
const REVIEW_GATE_REGISTRY = '.trae/specs/default-off-switches-review-gates.md';

/**
 * 「登记完整性」断言（2026-10-09，`P0-触发条件补全方案` §四-4.1）：
 * **每个默认关项**（默认关的安全开关 + 模式门控 `SELF_VERIFY_PATTERN`）必须在触发条件
 * 登记表中有条目 —— 防"永久搁置"（`development-workflow.md §2.14 规则 5` / R12-1）。
 *
 * ⚠️ 只查「**有没有登记**」；**不查触发条件内容**（散文语义不可机械化 —— §2.14 规则 5 明文
 * "本条不是门禁"）。
 */
const REGISTRATION_REQUIRED_FLAGS = [
    ...SAFETY_SWITCHES.filter((s) => s.def === false).map((s) => s.name),
    'SELF_VERIFY_PATTERN',
];

const REGISTRATION_ASSERTIONS = [
    {
        // 存在性守卫放在 **code 侧**（缺失 ⇒ **失败**，而非 docs 侧的"跳过"）
        // —— 否则删除/改名登记表会被静默跳过，"登记完整性"形同虚设。
        id: 'default-off-registry-exists',
        why: '触发条件登记表必须存在且可核对（R12-1 / §2.14 规则 5）',
        code: {
            file: REVIEW_GATE_REGISTRY,
            contains: /默认关项/,
        },
    },
    ...REGISTRATION_REQUIRED_FLAGS.map((name) => ({
        id: `default-off-registered-${name}`,
        why: `默认关项必须在触发条件登记表有条目（防"永久搁置"）—— ${name}`,
        code: {
            file: 'app/src/core/featureFlags.ts',
            contains: new RegExp(`^\\s*${name}:\\s*false,`, 'm'),
        },
        docs: [
            {
                file: REVIEW_GATE_REGISTRY,
                contains: new RegExp(`\\|\\s*\`${name}\`\\s*\\|`),
            },
        ],
    })),
];

/** 全部断言（漂移点 + 安全开关清单 + 默认关项登记完整性） */
const ALL_ASSERTIONS = [
    ...ASSERTIONS,
    ...SAFETY_ASSERTIONS,
    ...REGISTRATION_ASSERTIONS,
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

    for (const a of ALL_ASSERTIONS) {
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

    console.log(
        `断言 ${ALL_ASSERTIONS.length} 条（漂移点 ${ASSERTIONS.length} + 安全开关 ${SAFETY_ASSERTIONS.length} + 登记完整性 ${REGISTRATION_ASSERTIONS.length}）｜文档侧 已校验 ${checkedDocs} 处 · 跳过 ${skippedDocs} 处`
    );
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
