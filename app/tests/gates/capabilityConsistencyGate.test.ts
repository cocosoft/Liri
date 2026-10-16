/**
 * 能力声明静态一致性门禁（`lint:capabilities`）**自证 + 接线钉死 + 负向夹具**。
 *
 * 立论（同 `hardcodeGateBlocking.test.ts` / `gateSelfProof.test.ts`）：
 * 「CI 绿」只说明**当时没报**，不说明门禁**真的会报**、也不说明它**真的在跑**。本文件钉三件事：
 *   ① **反向对照**：真源（`capabilities.default.yaml` ↔ 代码 `ALL_TASK_TYPES`）当前**零不一致**
 *      —— 这是门禁的**绿本底**，也是"夹具合法样例"的真实版；
 *   ② **负向夹具**：对 C1–C7 每条规则各构造一个最小违规样例 ⇒ **必须**被精确判出
 *      （防"门禁恒真/规则被误排除"）—— 尤以 C3 为**实证回归样例**：`code` 是已废弃 token
 *      （`capability-task-mapping-unify.md` 记录 `code`→`coding` 的改名，但当时只改了
 *      `taskMappings`，`capabilities[].taskTypes` 的 4 处遗留在 2026-10-16 才被本门禁核出）；
 *   ③ **接线**：`app/package.json#ci` 与 `.github/workflows/ci.yml` 都必须真的调用它
 *      （否则"进 CI"只是纸面承诺）。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkCapabilityConsistency,
  loadCapabilityDoc,
  type CapabilityDoc,
} from '../../scripts/lint-capabilities';
import { ALL_TASK_TYPES } from '../../src/ai/modelRouter';

const REPO_ROOT = join(process.cwd(), '..');

/** 最小合法文档（C1–C7 全不触发）；夹具均为它的**单点扰动** */
function legalDoc(): CapabilityDoc {
  return {
    categories: [{ key: 'core', sortOrder: 1 }],
    capabilities: [
      { key: 'streaming', category: 'core', taskTypes: ['chat'], sortOrder: 1 },
      {
        key: 'vision',
        category: 'core',
        taskTypes: ['vision'],
        sortOrder: 2,
        dependencies: ['streaming'],
      },
    ],
    taskMappings: [
      {
        taskType: 'chat',
        requiredCapabilities: ['streaming'],
        optionalCapabilities: [],
        sortOrder: 1,
      },
      {
        taskType: 'vision',
        requiredCapabilities: ['vision'],
        optionalCapabilities: [],
        sortOrder: 2,
      },
    ],
  };
}

/** 夹具用的任务类型集（与 `legalDoc()` 对齐，不依赖真实 `ALL_TASK_TYPES`） */
const FIXTURE_TASKS = ['chat', 'vision'];

/** 判据返回的规则号集合（便于断言"判出了哪条规则"） */
function rulesOf(doc: CapabilityDoc, tasks: readonly string[]): string[] {
  return checkCapabilityConsistency(doc, tasks).map((i) => i.rule);
}

describe('lint:capabilities 反向对照：真源当前零不一致（绿本底）', () => {
  it('真源 ↔ ALL_TASK_TYPES ⇒ 无 C1–C7 违规', () => {
    expect(
      checkCapabilityConsistency(loadCapabilityDoc(), ALL_TASK_TYPES)
    ).toEqual([]);
  });

  it('真源规模非空（防"扫了个空也绿"）', () => {
    const doc = loadCapabilityDoc();
    expect(doc.capabilities?.length ?? 0).toBeGreaterThan(0);
    expect(doc.taskMappings?.length ?? 0).toBeGreaterThan(0);
    expect(ALL_TASK_TYPES.length).toBeGreaterThan(0);
  });
});

describe('lint:capabilities 负向夹具：C1–C7 每条规则**必须**判出', () => {
  it('合法夹具零违规（防"恒报"假红）', () => {
    expect(checkCapabilityConsistency(legalDoc(), FIXTURE_TASKS)).toEqual([]);
  });

  it('C1：taskMappings 出现代码中不存在的任务类型 ⇒ 判出', () => {
    const doc = legalDoc();
    doc.taskMappings![0].taskType = 'chat_typo';
    expect(rulesOf(doc, FIXTURE_TASKS)).toContain('C1');
  });

  it('C2：required/optional 引用未定义能力 ⇒ 判出', () => {
    const doc = legalDoc();
    doc.taskMappings![1].optionalCapabilities = ['not_a_capability'];
    expect(rulesOf(doc, FIXTURE_TASKS)).toContain('C2');
  });

  it('C3【实证回归样例】：capabilities[].taskTypes 写 `code`（已废弃 token） ⇒ 判出', () => {
    const doc = legalDoc();
    doc.capabilities![0].taskTypes = ['chat', 'code'];
    expect(rulesOf(doc, FIXTURE_TASKS)).toContain('C3');
  });

  it('C4：dependencies 引用未定义能力 ⇒ 判出', () => {
    const doc = legalDoc();
    doc.capabilities![1].dependencies = ['ghost_capability'];
    expect(rulesOf(doc, FIXTURE_TASKS)).toContain('C4');
  });

  it('C5：category 未在 categories 中定义 ⇒ 判出', () => {
    const doc = legalDoc();
    doc.capabilities![0].category = 'nonexistent_category';
    expect(rulesOf(doc, FIXTURE_TASKS)).toContain('C5');
  });

  it('C6：能力 key / 任务 taskType / sortOrder 重复 ⇒ 判出', () => {
    const dupKey = legalDoc();
    dupKey.capabilities!.push({
      key: 'streaming',
      category: 'core',
      taskTypes: [],
      sortOrder: 9,
    });
    expect(rulesOf(dupKey, FIXTURE_TASKS)).toContain('C6');

    const dupTask = legalDoc();
    dupTask.taskMappings!.push({ taskType: 'chat', sortOrder: 9 });
    expect(rulesOf(dupTask, FIXTURE_TASKS)).toContain('C6');

    const dupOrder = legalDoc();
    dupOrder.taskMappings![1].sortOrder = 1;
    expect(rulesOf(dupOrder, FIXTURE_TASKS)).toContain('C6');
  });

  it('C7：代码任务类型缺映射行（漏登记） ⇒ 判出', () => {
    const doc = legalDoc();
    doc.taskMappings = doc.taskMappings!.filter((m) => m.taskType !== 'vision');
    // 只余 chat 映射 ⇒ 代码侧的 vision 无映射行
    expect(rulesOf(doc, FIXTURE_TASKS)).toEqual(['C7']);
  });
});

describe('lint:capabilities 接线钉死（不得只存在于纸面）', () => {
  it('`app/package.json#ci` 聚合脚本包含 lint:capabilities', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'app', 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['lint:capabilities']).toBeDefined();
    expect(pkg.scripts.ci).toContain('lint:capabilities');
  });

  it('CI `static-check` 作业真的调用 scripts/lint-capabilities.ts', () => {
    const ci = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    expect(ci).toContain('scripts/lint-capabilities.ts');
  });
});
