// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * A7（2026-09-26，《Liri 优化方案》）：**从本仓代码派生题目**的登记处（人工挑定的任务源规格）。
 *
 * ⚠️ **本文件只登记"规格"，暂不把任务塞进 `allTasks`**：
 * 题源泄漏缺口（实测，2026-09-26：沙箱把 `LIRI_PROJECT_DIR` 指向真实仓库 ⇒ Agent 可直接读原始实现）
 * **已具备屏蔽机制** —— `materialize()` 产出的 `EvalTask` 自带 `shieldedPaths`（源文件绝对路径）
 * ⇒ 运行器注入 `PERMISSION_SHIELDED_PATHS`，`ToolRegistry.executeTool` 分派前拒绝引用该路径
 * （含其直接父目录）的调用，并做 fail-closed 校验（见 [`pathShield.ts`](../../tools/pathShield.ts)、
 * [`shieldPlan.ts`](../shieldPlan.ts)）。
 *
 * ⬆️ **规格数量：13 条**（第二批 2026-09-26：方案要求"先人工挑 10 条跑通流水线"；
 * 第三批同日 **+3 条**：为**补区分度**按上一条口径新选 —— 合并/组合语义、精确格式化契约、
 * 输入解析边界，均为**逻辑复杂但签名可机械提取**的纯函数）。
 * 选取口径（与流水线资格线一致）：**零运行时 import**、`export function` 形式（桩由签名机械生成）、
 * 参数与返回值**可由 JSON 表达**（执行器内联 JSON 字面量，且 `Set`/`Map` 序列化后无区分度 ⇒ 排除）、
 * 单条用例**输入必须小**（启动器命令行上限 28k 字符 ⇒ 排除需要超大输入才触发的分支，如 30k 字符截断）。
 * 第三批新增（2026-09-26 实测补记）两条口径：
 *   · **签名只引用内建 / JSON 类型** —— `stubFromSource` 会把参数与返回类型**原样**复制进桩，
 *     而桩文件是**零依赖**的 ⇒ 签名里若出现外部类型或**本文件内的接口**（如 `ToolCallItem[]`、
 *     `FormattedSymbol[]`、`AgentOutput`），模型必须额外处理"未定义类型"，属**与能力无关的噪声**。
 *   · **行为不得由常量表决定** —— 若正确输出取决于一张不可推断的清单（如 `BashAllowlistMatcher`
 *     的 40 条只读命令白名单、`knownEventTypes` 的 48 项事件类型），规格**无法在不抄答案的前提下
 *     写清** ⇒ 排除（这类题只会变成"猜常量表"）。
 *
 * **落地方式已定（2026-09-26，用户裁定）：保持 CLI `--source-tasks` 显式纳入，不并入默认题集。**
 * 两条**互为独立**的依据：① **形态**（见下方"机制约束"第 1 条 —— `allTasks` 是静态数组，
 * 字面接入只有两条更差的路）；② **难度 / 信噪**（见下"难度分层"）。
 * ⚠️ 早前记的"仍未接入 `allTasks` 的两条原因"（缺真实模型端到端 / 缺难度筛）**均已消解**：
 * 端到端已跑完 10 条并做过 k=4 复测，基线也按实测登记 ⇒ 此处不再是"因未做而搁置"，
 * 而是**基于实测数据做的取舍**。
 *
 * **难度分层判据（可复核；2026-09-26 落档）**：口径与 [`baseline.json`](../baseline.json) 的地板
 * **同源** —— 只用**已作答 attempt**（`EvalAttempt.failureKind === 'assert'`），**剔除**基建超时
 * （`'infra'`）；样本 = `deepseek-v4-flash`、`k=4`（报告 `dev_docs/evals/eval-2026-09-26T04-27-06-916Z.{md,json}`
 * ＋两题复测 `eval-2026-09-26T05-00-25-508Z`）。按 **answered 口径 `pass^1`** 分两层：
 *   · **无区分度（answered 100%）11 条**：`looks-like-complete-json` / `count-reasoning-chars` /
 *     `format-ms` / `sanitize-user-input` / `nest-arguments` / `truncate-symbol-name` /
 *     `analyze-schema`（**规格修复后**复测 4/4）/ `should-escalate-long-task` ＋
 *     **第三批 3 条**（`extract-command-info` / `format-agent-timing` / `dedupe-tool-call-blocks`，
 *     实测见下）
 *     ⇒ 对当前模型**不构成能力信号**，只宜作"**防塌陷 / 回归**"（这正是 `requirePassK:false` + 地板的语义）。
 *   · **有区分度 2 条**：`strip-bare-exploration`（answered 2 中过 1）·
 *     `compute-unified-diff`（answered 4 中过 1；**其后规格又修过**"逐字节输出契约" ⇒ 该数值**待复测**）。
 *   ⇒ **后果**：本批**不足以**充当"信号基线"（零区分度占多数 ⇒ 阈值几乎没有信息量），
 *   故**不并入默认题集**（这条与"形态"独立，两者都指向保持 CLI 显式纳入）。
 *
 * **第三批实测（2026-09-26："换题补区分度"已执行；结论未达预期，而这个负面结论比数字更重要）**：
 * 按"**逻辑复杂但签名可机械提取**"新选 3 条（合并优先级 / 精确格式化契约 / 输入解析边界），
 * `deepseek-v4-flash`、k=4 实测（报告 `eval-2026-09-26T06-22-19-496Z` ＋ 该题修复后复测
 * `eval-2026-09-26T06-30-32-873Z`）：**3/3 全部 answered 100%**，与第二批的 8 条**同质**。
 * ⇒ **可证伪的负面结论**：靠"在本仓纯函数里换更复杂的题"**提高不了区分度** —— 本流水线的
 * **资格线**（零依赖 / 参数与返回值可 JSON 化 / 输入小 / 行为能用散文无歧义写清）本身就把题目
 * 限制成"照着规格实现一个小纯函数"，而这恰是当前模型最稳的能力区间。
 * ⇒ 真正的下一步**不是换题，而是换来源**：接入需要**多文件改动 / 长链路 / 隐性不变量**的题目
 * （SWE-bench 风格的真实修复类任务），或把"过程约束"（L2 工具序列）纳入判据。**未做。**
 * ❗首测 `src-extract-command-info` 曾得 3/4，那次失败**不是能力信号**：`stubFromSource` 把
 * **内联对象返回类型**的花括号误当函数体 ⇒ 桩语法错误，模型原样保留即永不通过（已根因修复 +
 * fail-closed 自检，见 `sourceTask.ts#findFunctionBodyBrace`；修复后复测 4/4）。
 *
 * ⚠️ **"接入 `allTasks`"的机制约束与门槛（2026-09-26 实测确认，动手前必读）**：
 *
 * 1. **形态**：`tasks/index.ts` 的 `allTasks` 是**静态数组**，而本文件的规格要经
 *    `buildSourceTask()` **异步真实执行**才产出可用题目 ⇒ 字面"塞进 allTasks"只有两条路，且都更差：
 *    ① **自物化静态包装**（运行期才推导桩/golden）—— 会丢掉现有"**非 `ready` 一律拒跑**"的
 *    fail-closed 自检（坏题会到运行期才炸）；
 *    ② **预烘焙成生成物** —— 源文件一改就**静默过期**（golden/桩与实际实现不一致）。
 *    ⇒ **正确形态就是 CLI 的 `--source-tasks`**（异步物化 + 自检 + 屏蔽随任务下传），已实现。
 * 2. **门禁门槛**：`checkGate()` 对**未登记**基线文件的任务**直接判失败**
 *    （`基线中未登记该任务（新增任务须先登记基线）`），而 `evals/baseline.json` 现有 15 条
 *    **全部是 `{requirePassK: true, minPass1: 1}`**（即 100% 严阈值）；本批实测却只有 **8/10**
 *    （2 条为真实模型失败）⇒ **不能照抄该阈值**，也不能凭空写一个区间
 *    （`signal-baseline.json` 明写"expectedPassRange 必须由真实多轮 rollout 推导"，CS04/CS06）。
 *    ⇒ 若要纳入**默认题集**，必须先以 **k≥4 复测同一模型**得到实测阈值，再登记。
 *    ✅ **门槛已满足（2026-09-26）**：k=4 复测 + 10 条地板已登记进 [`baseline.json`](../baseline.json)
 *    ⇒ 传 `--source-tasks --gate` 不再因"未登记"被拒。但**门槛是必要条件、非充分条件** ⇒
 *    本批仍**不并入**默认题集（理由见上方"难度分层"）。
 * 3. **当前状态**：默认题集**不变**；用 `--source-tasks` 可显式纳入本次运行（不传该旗标即零影响）。
 *
 * 规格内容的两条自律：
 *   · `behavior` 写**可观察行为**（不抄实现里的正则/常量）—— 抄实现等于把答案写进提示词；
 *   · `cases` **只给输入**，期望输出由 `buildSourceTask()` 真实执行原始实现捕获。
 */

import type { SourceTaskSpec } from '../types.js';

export const sourceTaskSpecs: SourceTaskSpec[] = [
  {
    id: 'src-strip-bare-exploration',
    name: 'A7 派生：剥离裸探索段（本仓纯函数）',
    sourcePath: 'app/src/chat/services/bareExplorationStripper.ts',
    exportName: 'stripBareExploration',
    behavior: [
      '输入一段正文，返回**剥离了"裸探索叙述"**（模型把工具执行过程叙述直接泄漏进正文的句子）之后的文本。',
      '句子边界：句末标点（。！？；?!）之后，或换行之前。',
      'Markdown 结构行（标题 / 列表 / 引用 / 代码块 / 图片）属于正文标志，**不得**被判为探索句。',
      'fenced code block（``` … ```）内部的整段内容受保护，**不得**被剥离。',
      '保护规则：若剥离后**没有剩余可见内容**，必须**原样返回输入**（宁可漏过、不可错杀）。',
      '空输入或全空白输入，原样返回。',
    ],
    cases: [
      {
        name: 'exploration-only（应触发保护规则）',
        args: ['让我先看看这个文件。继续读下去。'],
      },
      { name: 'mixed-with-conclusion', args: ['结论如下。让我先读一下。\n'] },
      { name: 'markdown-structure-kept', args: ['# 标题\n让我先读一下。'] },
      { name: 'fence-protected', args: ['```\n让我先读一下。\n```\n'] },
      { name: 'empty', args: [''] },
    ],
  },

  {
    id: 'src-looks-like-complete-json',
    name: 'A7 派生：判断字符串是否为完整 JSON',
    sourcePath: 'app/src/query/shrink.ts',
    exportName: 'looksLikeCompleteJson',
    behavior: [
      '输入一个字符串，判断它是否**整体**能被 `JSON.parse` 接受。',
      '能被解析（含前后空白）⇒ 返回 `true`；否则（截断、多余尾巴、空串）⇒ `false`。',
      '`null` / `数字` / `字符串字面量` 等合法 JSON 标量同样算 `true`。',
      '空串或仅空白的字符串 ⇒ `false`。',
    ],
    cases: [
      { name: 'object', args: ['{"a":1}'] },
      { name: 'array', args: ['[1,2,3]'] },
      { name: 'scalar-null', args: ['null'] },
      { name: 'surrounding-whitespace', args: ['  {"a":1}  '] },
      { name: 'truncated', args: ['{"a":'] },
      { name: 'trailing-garbage', args: ['123abc'] },
      { name: 'empty', args: [''] },
    ],
  },

  {
    id: 'src-count-reasoning-chars',
    name: 'A7 派生：统计消息里思考内容的总字符数',
    sourcePath: 'app/src/query/ReasoningRetention.ts',
    exportName: 'countReasoningChars',
    behavior: [
      '输入一个消息数组，返回所有消息中**思考内容**（`reasoning_content` 字段）字符数之和。',
      '只有"该字段存在且为字符串"的消息才计入；字段缺失或非字符串 ⇒ 该条计 0。',
      '空数组 ⇒ 返回 `0`。',
    ],
    cases: [
      { name: 'empty', args: [[]] },
      { name: 'single', args: [[{ reasoning_content: 'abc' }]] },
      {
        name: 'mixed-with-non-reasoning',
        args: [
          [
            { reasoning_content: 'abc' },
            { content: 'xy' },
            { reasoning_content: 'de' },
          ],
        ],
      },
      { name: 'non-string-field', args: [[{ reasoning_content: 123 }]] },
    ],
  },

  {
    id: 'src-compute-unified-diff',
    name: 'A7 派生：计算两段文本的行级 unified diff',
    sourcePath: 'app/src/chat/utils/unifiedDiff.ts',
    exportName: 'computeUnifiedDiff',
    behavior: [
      '入参：旧内容、新内容、文件名（默认 `file`）、上下文行数（默认 3）。按 `\\n` 切行做行级比对。',
      '返回对象 `{ diff, additions, deletions }`：`additions` = 新增行数，`deletions` = 删除行数。',
      '两段内容**完全相同** ⇒ `diff` 为空串、两个计数都为 0。',
      '`diff` 是 unified diff 文本：含 `--- a/<文件名>` 与 `+++ b/<文件名>` 头、`@@` 块头，',
      '块内行以 `+`（新增）/ `-`（删除）/ 单个空格（上下文）开头。',
      // 2026-09-26 k=4 复测暴露：3/4 次失败全是"尾随换行"格式差异（期望 `…\\n c\\n \\n`、实际 `…\\n c\\n `）
      // ⇒ 属**规格未写全**（不是模型不会）：把输出契约写清，使正确实现能**逐字节**对齐。
      '**输出契约（逐字节，必须照此）**：每一行输出为「前缀（`+` / `-` / 单个空格）+ 该行内容 + `\\n`」，',
      '**含最后一行** ⇒ 整个 `diff` **总是以 `\\n` 结尾**（**不是**"用 `\\n` 连接各行"那种无尾换行的读法）。',
      '输入末尾的空行（内容以 `\\n` 结尾时切分得到的末段）同样算一行，输出为「空格 + `\\n`」，',
      '因此 `diff` 可能以「空格 + `\\n`」结束 —— 这正是期望值的样子。',
    ],
    cases: [
      { name: 'identical', args: ['a\nb\n', 'a\nb\n'] },
      { name: 'single-line-change', args: ['a\nb\nc\n', 'a\nx\nc\n'] },
      { name: 'append-line', args: ['a\n', 'a\nb\n'] },
      { name: 'custom-file-path', args: ['a\n', 'b\n', 'src/x.ts'] },
    ],
  },

  {
    id: 'src-format-ms',
    name: 'A7 派生：毫秒时长的人类可读格式化',
    sourcePath: 'app/src/query/queryProfiler.ts',
    exportName: 'formatMs',
    behavior: [
      '输入毫秒数（数字），返回人类可读时长字符串。',
      '小于 1000 ⇒ 毫秒形式：取整后接 `ms`（如 `0ms`、`999ms`）。',
      '大于等于 1000 ⇒ 秒形式：除以 1000 后**保留两位小数**并接 `s`（如 `1000` → `1.00s`）。',
    ],
    cases: [
      { name: 'zero', args: [0] },
      { name: 'sub-second-max', args: [999] },
      { name: 'exactly-one-second', args: [1000] },
      { name: 'fractional', args: [1234] },
      { name: 'rounds-up', args: [59999] },
    ],
  },

  {
    id: 'src-sanitize-user-input',
    name: 'A7 派生：清理用户输入中的控制字符',
    sourcePath: 'app/src/query/processUserInput.ts',
    exportName: 'sanitizeUserInput',
    behavior: [
      '输入字符串，**删除**其中的控制字符与删除符（DEL），然后对结果做首尾空白裁剪。',
      '保留：制表符（TAB）、换行（LF）、回车（CR）—— 它们不算"应删控制字符"。',
      '其余 C0 控制字符（含垂直制表、换页）与 DEL 一律删除。',
      '删除后只剩空白或本就为空 ⇒ 返回空串。',
    ],
    cases: [
      { name: 'nul-inside', args: ['  a\u0000b  '] },
      { name: 'keeps-tab-and-newline', args: ['a\tb\nc'] },
      { name: 'vertical-tab-and-form-feed', args: ['\u000b\u000c'] },
      { name: 'del', args: ['\u007f'] },
      { name: 'trim-only', args: ['  x  '] },
    ],
  },

  {
    id: 'src-analyze-schema',
    name: 'A7 派生：分析 JSON Schema 的规模（叶子数/深度）',
    sourcePath: 'app/src/tools/repair/flatten.ts',
    exportName: 'analyzeSchema',
    behavior: [
      '输入一个 JSON Schema，递归统计：`leafCount` = **叶子**数量，`maxDepth` = 最大深度。',
      '下钻规则：`type === "object"` 且有 `properties` ⇒ 逐个属性下钻（深度 +1）；',
      '`type === "array"` 且有 `items` ⇒ 对 items 下钻（深度 +1）；其余节点视为**叶子**。',
      // 2026-09-26 k=4 复测暴露：`maxDepth` 对"根算不算 1 层"有两种自洽读法（模型答 2、golden 为 1）
      // ⇒ 属**规格欠定义**：明确"根不计深度"，使唯一解。
      '**深度口径（必须照此，否则与期望不一致）**：**根节点本身不计深度**；根的直接子节点为第 **1** 层。',
      '例：`{type:"object", properties:{a:{type:"string"}}}` ⇒ `maxDepth = 1`（叶子 `a` 在第 1 层）。',
      '返回 `{ shouldFlatten, leafCount, maxDepth }`，其中 `shouldFlatten` 为：',
      '叶子数**超过 10** 或最大深度**超过 2** 时为 `true`，否则 `false`。',
      '入参为空（undefined / null）⇒ `{ shouldFlatten: false, leafCount: 0, maxDepth: 0 }`。',
    ],
    cases: [
      { name: 'empty', args: [null] },
      {
        name: 'single-leaf',
        args: [{ type: 'object', properties: { a: { type: 'string' } } }],
      },
      {
        name: 'shallow-many-leaves',
        args: [
          {
            type: 'object',
            properties: Object.fromEntries(
              Array.from({ length: 11 }, (_, i) => [
                `k${i}`,
                { type: 'string' },
              ])
            ),
          },
        ],
      },
      {
        name: 'deep-three-levels',
        args: [
          {
            type: 'object',
            properties: {
              a: {
                type: 'object',
                properties: {
                  b: { type: 'object', properties: { c: { type: 'string' } } },
                },
              },
            },
          },
        ],
      },
    ],
  },

  {
    id: 'src-nest-arguments',
    name: 'A7 派生：把点路径参数还原为嵌套对象',
    sourcePath: 'app/src/tools/repair/flatten.ts',
    exportName: 'nestArguments',
    behavior: [
      '输入一个"扁平参数对象"，键名可含 `.`，返回**嵌套**结构。',
      '键名按 `.` 拆分逐层建对象：`{"a.b": 1}` ⇒ `{"a": {"b": 1}}`。',
      '不含 `.` 的键原样保留在同一层；空对象 ⇒ 返回 `{}`。',
    ],
    cases: [
      { name: 'empty', args: [{}] },
      { name: 'flat-only', args: [{ a: 1 }] },
      { name: 'two-level', args: [{ 'a.b': 1, 'a.c': 2 }] },
      { name: 'three-level', args: [{ 'x.y.z': 'v' }] },
    ],
  },

  {
    id: 'src-should-escalate-long-task',
    name: 'A7 派生：判断长任务是否需要升级处理',
    sourcePath: 'app/src/chat/longTaskEscalation.ts',
    exportName: 'shouldEscalateLongTask',
    behavior: [
      '输入一个对象，含 `longTask`（布尔）、`hasProjectContext`（布尔）、`codeMode`（布尔）、',
      '`userMessageCount`（数字，用户轮次）。',
      '返回 `true` 当且仅当**同时**满足：是长任务、**没有**项目上下文、**不是**代码模式、',
      '且用户轮次达到一个最小阈值（轮次不足即不升级）。',
      '以上任一条件不满足 ⇒ 返回 `false`。',
    ],
    cases: [
      {
        name: 'not-long-task',
        args: [
          {
            longTask: false,
            hasProjectContext: false,
            codeMode: false,
            userMessageCount: 99,
          },
        ],
      },
      {
        name: 'has-project-context',
        args: [
          {
            longTask: true,
            hasProjectContext: true,
            codeMode: false,
            userMessageCount: 99,
          },
        ],
      },
      {
        name: 'code-mode',
        args: [
          {
            longTask: true,
            hasProjectContext: false,
            codeMode: true,
            userMessageCount: 99,
          },
        ],
      },
      {
        name: 'too-few-turns',
        args: [
          {
            longTask: true,
            hasProjectContext: false,
            codeMode: false,
            userMessageCount: 0,
          },
        ],
      },
      {
        name: 'all-conditions-met',
        args: [
          {
            longTask: true,
            hasProjectContext: false,
            codeMode: false,
            userMessageCount: 99,
          },
        ],
      },
    ],
  },

  {
    id: 'src-truncate-symbol-name',
    name: 'A7 派生：按上限截断过长的符号名',
    sourcePath: 'app/src/tools/LSPTool/formatters.ts',
    exportName: 'truncateSymbolName',
    behavior: [
      '输入符号名与最大长度（默认 60），返回不超过该长度的字符串。',
      '长度不超过上限 ⇒ **原样返回**（不添加任何标记）。',
      '超过上限 ⇒ 取前 `上限 - 3` 个字符，末尾追加三个点 `...`（结果总长恰为上限）。',
    ],
    cases: [
      { name: 'short-default', args: ['shortName'] },
      { name: 'exactly-at-limit', args: ['abcdefghij', 10] },
      { name: 'over-limit', args: ['abcdefghij', 5] },
      { name: 'empty-name', args: ['', 3] },
      { name: 'long-default-limit', args: ['x'.repeat(70)] },
    ],
  },

  {
    id: 'src-extract-command-info',
    name: 'A7 派生：从用户输入解析指令名与参数',
    sourcePath: 'app/src/query/processUserInput.ts',
    exportName: 'extractCommandInfo',
    behavior: [
      '输入一个字符串，返回对象 `{ name, args }`（两个字段都是字符串，**恒存在**）。',
      '先对输入做**首尾空白裁剪**；若裁剪后以 `/` 或 `!` 开头，则**只去掉开头的第一个字符**并再次裁剪；' +
        '不以这两个字符开头时，`name` 为空串、`args` 为裁剪后的整串。',
      '把（可能已去前缀的）内容按**一段或多段空白**切分：第一段作为 `name`（内容为空时 `name` 为空串）。',
      '其余各段以**单个空格**连接作为 `args`（原始的多段空白被折叠；没有其余段时 `args` 为空串）。',
      '输入为空串或全空白 ⇒ 两个字段都是空串。',
    ],
    cases: [
      { name: 'slash-command-with-args', args: ['/deploy  --force   now'] },
      { name: 'bang-command-no-args', args: ['!ls'] },
      { name: 'no-prefix', args: ['  just text  '] },
      { name: 'prefix-only', args: ['/'] },
      { name: 'double-prefix', args: ['!/clear'] },
      { name: 'empty', args: [''] },
    ],
  },

  {
    id: 'src-format-agent-timing',
    name: 'A7 派生：毫秒时长的人类可读格式化（含不进位契约）',
    sourcePath: 'app/src/tools/AgentTool/agentDisplay.ts',
    exportName: 'formatAgentTiming',
    behavior: [
      '输入毫秒数（数字），返回字符串。三条分支按**严格上限**划分：',
      '`< 1000` ⇒ 输出 `${毫秒}ms`（如 `0ms`、`999ms`，不做单位换算）。',
      '`>= 1000 且 < 60000` ⇒ 输出「毫秒 ÷ 1000」并**保留一位小数**，后接 `s`（如 `1000` ⇒ `1.0s`）。',
      '`>= 60000` ⇒ 输出 `${分钟}m ${秒}s`：分钟 = 毫秒除以 60000 的**向下取整**；' +
        '秒 = 「毫秒 % 60000 ÷ 1000」的**四舍五入**。',
      '**秒位不做进位/规整**：分钟位与秒位是**两次独立计算**的结果，秒位允许等于 `60`，此时**照原样输出**' +
        '（不得改写为进一位）。',
    ],
    cases: [
      { name: 'zero', args: [0] },
      { name: 'sub-second-max', args: [999] },
      { name: 'exactly-one-second', args: [1000] },
      { name: 'fractional-second', args: [1500] },
      { name: 'just-below-a-minute', args: [59999] },
      { name: 'exactly-one-minute', args: [60000] },
      { name: 'minute-plus-fraction', args: [90500] },
      { name: 'no-carry', args: [119700] },
    ],
  },

  {
    id: 'src-dedupe-tool-call-blocks',
    name: 'A7 派生：合并去重同一次工具调用的重复块',
    sourcePath: 'app/src/chat/utils/chatBlocks.ts',
    exportName: 'dedupeToolCallBlocks',
    behavior: [
      '输入 blocks 数组（元素为普通对象），返回合并后的数组。',
      '**只处理** `type === "tool_call"` 的块：其调用 id 取 `toolCallId` 字段，取不到时回退到 `toolCall.id`；' +
        '两处都取不到（空串）⇒ 该块**原样保留、不参与合并**。',
      '非 `tool_call` 块一律**原样保留**且位置不变。',
      '同一调用 id 的多个块合并为**一个**，输出在**该 id 首次出现的位置**；同一 id 只输出一次（后续重复块不再出现）。',
      '合并规则：块的外层字段取**首个**块；`toolCall` 对象内的字段**后到者覆盖**先到者，' +
        '**唯一例外是 `arguments`** —— 必须**保留第一个非空的 arguments**（后到的空 arguments 不得覆盖它）。',
      '「非空 arguments」指该值是对象且至少有一个键；前后都不是非空时，合并结果的 `arguments` 取后到块的值' +
        '（可能为 `null` 或不出现）。',
      '没有任何 id 出现两次 ⇒ 返回的数组内容与输入一致，且**不增添/删除任何字段**。',
    ],
    cases: [
      {
        name: 'duplicate-start-then-end',
        args: [
          [
            {
              type: 'tool_call',
              toolCallId: 'a',
              toolCall: {
                id: 'a',
                name: 'file_read',
                arguments: { path: 'x' },
              },
            },
            { type: 'text', text: 'hi' },
            {
              type: 'tool_call',
              toolCallId: 'a',
              toolCall: {
                id: 'a',
                status: 'completed',
                result: 'ok',
                arguments: {},
              },
            },
          ],
        ],
      },
      {
        name: 'no-duplicate-unchanged',
        args: [
          [
            {
              type: 'tool_call',
              toolCallId: 'b',
              toolCall: { id: 'b', arguments: { path: 'y' } },
            },
            { type: 'text', text: 'z' },
          ],
        ],
      },
      {
        name: 'nested-id-fallback',
        args: [
          [
            { type: 'tool_call', toolCall: { id: 'c', arguments: { q: 1 } } },
            {
              type: 'tool_call',
              toolCallId: 'c',
              toolCall: { id: 'c', status: 'failed' },
            },
          ],
        ],
      },
      {
        name: 'third-occurrence-keeps-first-args',
        args: [
          [
            {
              type: 'tool_call',
              toolCallId: 'd',
              toolCall: { id: 'd', arguments: { n: 1 } },
            },
            {
              type: 'tool_call',
              toolCallId: 'd',
              toolCall: { id: 'd', arguments: { n: 2 } },
            },
            {
              type: 'tool_call',
              toolCallId: 'd',
              toolCall: { id: 'd', status: 'completed' },
            },
          ],
        ],
      },
      {
        name: 'missing-id-kept',
        args: [
          [
            { type: 'tool_call', toolCall: {} },
            { type: 'tool_call', toolCallId: '', toolCall: { id: '' } },
          ],
        ],
      },
      { name: 'empty', args: [[]] },
    ],
  },
];
