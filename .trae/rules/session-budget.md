# 会话预算与交接纪律 / Session Budget & Handoff

> 规则格式：`[SB-ID] [强制级别] 描述`。**MUST**（违反即拒绝）/ **SHOULD**（需说明理由）。
>
> **来源（实测取证）**：`dev_docs/20261014/会话token预算与交接整改方案-20261014.md`
> —— 台账单片写入 ≈**6,614 字符**（同一事实写 4 处）· `fix-evidence-registry.json` **最长单行 13,939 字符** ·
> `修复证据登记.md` 最长行 1,903 · 架构门禁单次输出 **6,249 字符 / 129 行**。
>
> **目标（可达边界，不夸大）**：平台侧「本轮 token 上限」**不可消除**；本规则消除的是它的**后果**——
> 片内半成品、红态进提交、上下文重建、重复劳动。**使任何中断都落在「干净、可续跑」的检查点上。**

---

## §1 台账写入纪律（单写入点 + 短行）

### SB01 [MUST] 台账唯一写入点 = `fix-evidence-log.jsonl`

- 每片**追加一行**（append-only），字段固定、**单行 ≤400 字符**：
  `{"id","scope","files","verify","baseline","reopen","date","commit"}`
- 禁止在 `registry` / `修复证据登记.md` / `CHANGELOG.md` **手写长文**（详见 SB02）。
- **新片写法（已落地）**：写入点记录追加 `"cl":1`（可带 `verify` / `baseline`）⇒
  `CHANGELOG.md`「未发布段」锚点区**自动渲染**一行 bullet（**不再手写 CHANGELOG**）；
  历史叙事原文留在明细归档，发布历史段仍手写。
- 状态：**机制已落地**（迁移脚本 + 生成器 + drift 门禁；见下 SB02）。

### SB02 [MUST] 三个视图由脚本生成，不得手改

- `registry` / `修复证据登记.md`（§1+§2）/ `CHANGELOG.md` 的**未发布段锚点区** = **生成物**
  （由 `scripts/gen-evidence-views.ts` 从 JSONL 渲染，带「勿手改」头注）。
- 状态：**已落地**（`registry` + 登记 md + CHANGELOG 锚点区；漂移由 `lint-evidence-views-drift` **仅 CI** 拦截）。

### SB03 [MUST] 台账/登记类文件单行 ≤300 字符（JSONL ≤400）

- 扫描面：`CHANGELOG.md` · `.trae/architecture/*.md` · `.trae/architecture/fix-evidence-registry.json`
  ·（若存在）`fix-evidence-log.jsonl`。
- 门禁：`scripts/lint-evidence-linewidth.ts`（**棘轮：只减不增**，基线=存量；新增文件出现长行 ⇒ 阻断）。
- 写入侧：新增/修改内容**一律短行**；叙事细节按 SB04 迁出。
- 状态：**已生效（本阶段落地门禁 + 接线 CI）**。

### SB04 [SHOULD] 长分析迁独立文档，台账只放指针

- 深入叙事（取证过程、权衡、复现命令）落 `dev_docs/<date>/<id>.md`；台账只留「结论 + 路径」。
- 理由：并入台账会把单行推长（SB03 的根源）。

---

## §2 检查点与续跑契约

### SB05 [MUST] 每片 4 个检查点，未过不得越过；且**先提交代码、后补台账**

1. 改名完成 ⇒ `typecheck` 绿
2. 守卫 + 基线 ⇒ 4 门禁绿
3. **提交 + 推送**（**此时台账尚未写**）
4. 台账落盘 ⇒ `lint:fix-evidence` + `lint:evidence-linewidth` 绿

- 次序理由：钩子只校验 `registry` **自洽**，不要求每提交都有条目 ⇒ **先进提交**可使断点**永远**落在
  「代码已提交」侧，杜绝「已改未提交」的半成品。
- 状态：**规范已落盘（即时生效，按纪律执行）**。

### SB06 [MUST] 机器可读续跑状态 `.trae/architecture/hardcode-progress.json`

- 字段：`{nextKey, doneKeys[], lastCommit, baselineKeys, nextAction, decisions[]}`；
  **每片结束必写 `nextAction` 一行**（下轮照此一行即可续跑）。
- 状态：**已落地（2026-10-17，阶段 C）** —— `.trae/architecture/hardcode-progress.json` 已建；
  写作纪律：每片结束**只改 `nextAction`/`lastCommit`/`doneKeys`**（短行锚点，SB08-2）。

### SB07 [SHOULD] 交接单由脚本生成（≤30 行）

- 内容 = SB06 字段的渲染；替代人手写长交接单。
- 状态：**已落地（2026-10-17，阶段 C）** —— `bun run scripts/gen-handoff.ts`（≤30 行；`--out` 可落盘）。

---

## §3 工具使用纪律（降回显）

### SB08 [MUST] 四则

1. **钩子/门禁输出重定向到文件**，只回显**末 3 行**；禁止全量回读；
   `CheckCommandStatus` 单次取用 **≤600 字符**。
   **具体配方（R5 零成本项，2026-10-14 实测）**：`git commit` 的钩子输出由 git 继承 stdio，
   用 `| Select-Object -Last N` **拦不住**（本会话多次提交仍带回显）；
   须整体 `*>` 落盘，再取尾部 + 计量：

   ```powershell
   git commit -m "<msg>" *> "$env:TEMP\commit.log"
   Get-Content "$env:TEMP\commit.log" -Tail 3          # 只回显末 3 行
   (Get-Content "$env:TEMP\commit.log" -Raw).Length    # 计量：落盘字符数
   ```

   门禁/测试同法：`bun run lint:x *> "$env:TEMP\gate.log"` + `-Tail 3`。
   **禁止**把钩子全文（pre-commit 的 eslint warning + 架构合规报告）带进对话。
2. 台账与长行文件**只用短行锚点编辑**（`old_string` 取 1 行、`new_string` ≤300 字符）。
3. 事实收集**一次聚合**（单条命令输出多指标），禁止 N 条分散 grep。
4. 片尾报告**模板化**：表格 + 文件链接 + 一行结论；**禁止复述证据链**（细节导流台账/文档）。

- 状态：**即时生效**（① 已补**可执行配方**）。

---

## §4 预算纪律

### SB09 [MUST] 单片软上限 ≤18 次工具调用 / ≤10k tokens；超限即拆分

- 拆分方式：按文件拆成多个提交（仍属同一键），而非「硬冲到片尾」。

### SB10 [MUST] 计划变更必须登记

- 变更落到 SB01 的 JSONL（或临时由 `reopenWhen` 承担），禁止只留在对话里。

### SB11 [SHOULD] 与工作流文档交叉引用

- `development-workflow.md` 增加「SESSION 预算」条目并指向本文件。

---

## §5 规则索引

| 规则 ID | 描述 | 强制级别 | 状态 |
|---------|------|:--------:|------|
| SB01 | 台账唯一写入点 = `fix-evidence-log.jsonl`（每片 1 行 ≤400 字符） | MUST | 规范已落 / 机制待 B |
| SB02 | 三视图由脚本生成，不得手改 | MUST | 规范已落 / 机制待 B |
| SB03 | 台账类文件单行 ≤300（JSONL ≤400）+ 棘轮门禁 | MUST | **已生效** |
| SB04 | 长分析迁 `dev_docs/`，台账只放指针 | SHOULD | 规范已落 |
| SB05 | 4 检查点；**先提交代码、后补台账** | MUST | **已生效（纪律）** |
| SB06 | `hardcode-progress.json` + 每片写 `nextAction` | MUST | **已生效（阶段 C，2026-10-17）** |
| SB07 | 交接单脚本生成（≤30 行） | SHOULD | **已生效（阶段 C，2026-10-17）** |
| SB08 | 工具纪律四则（输出裁剪 / 短行编辑 / 一次聚合 / 报告模板化） | MUST | **已生效（含 R5 配方）** |
| SB09 | 单片 ≤18 调用 / ≤10k tokens，超限拆分 | MUST | **已生效（纪律）** |
| SB10 | 计划变更必须登记 | MUST | 规范已落 |
| SB11 | 与 `development-workflow.md` 交叉引用 | SHOULD | 规范已落 |

---

## §6 与现有规则的关系

| 现有规则 | 本规则强化点 |
|---|---|
| `coding-standards.md` CS08（JSON/YAML 内容引号） | CS08 治「写入格式让工具解析不了」；SB03 治「写入**粒度**让预算付不起」——同属**写入侧**纪律 |
| `architecture-compliance.md` AR-3（检查器崩溃不得当通过） | SB03 的门禁为**棘轮 + fail-closed**（基线缺失 ⇒ `exit 1`），不得静默降级 |
| `development-workflow.md`（交接 / 提交纪律） | SB05 把「提交」**前移**到台账之前，使断点恒为干净点 |
| `code-deletion.md` CD06（独立提交 + 回滚路径） | SB09 的「拆分」与 CD06 同向：**小步、可回滚** |

> **优先级**：与现有规则冲突时以本规则为准（仅限**会话预算/台账写入成本**范畴）。
