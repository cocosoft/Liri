# 种子 Issue 草稿（6 条）

> 用途：这些 issue 要提前建好，演进页「参与方式」的三张卡才能指向**具体任务**，而不是 issues 列表页。
> 建议标签：`good first issue`、`help wanted`、`security`。
> 建单前请再核一次数字（尤其是行数与文件数，随代码变化）。

---

## 1. `[good first issue]` 把 Domain-first 知识域隔离的 Phase A 拆成可执行子任务

**标签**：`good first issue`、`help wanted`
**背景**：`dev_docs/domain-first-plan.md` 已完成设计（知识域隔离、`knowledge/domains/{domain}`、`.domain.yaml`、实体 ID `{domain}:{kind}:{slug}`），但 Phase A/B/C 均未实施。
**任务**：把 Phase A（基础设施）拆成 5–8 个可独立合并的子任务，每个子任务写清输入/输出与验收命令。
**验收**：产出子任务清单（可直接开子 issue）；至少 1 个子任务能被新贡献者在不了解全貌的情况下完成。
**参考**：`dev_docs/domain-first-plan.md`

---

## 2. `[help wanted]` ChatManager 拆分第一阶段：抽出会话持久化

**标签**：`help wanted`
**背景**：`ChatManager` 目前 7036 行（2026-06-18 复查时为 3263 行，仍在增长），是架构健康度扣分的主要来源。
**任务**：第一阶段只做「会话持久化」的边界抽取，保持对外行为不变；每次提交跑 `bun run ci`。
**验收**：`ChatManager` 行数下降且 `lint:size` / `lint:arch` 全绿；新增单测覆盖被抽出的模块；行为无变更（现有测试全过）。
**参考**：`app/src/chat/ChatManager.ts`、`scripts/architecture-health.ts`

---

## 3. `[good first issue]` 给 `app/src/infrastructure/http/handlers/` 补测试

**标签**：`good first issue`
**背景**：2026-06-18 复查指出该目录测试覆盖为 0；整体测试/源码比约 4%，CI 覆盖率门槛尚未建立。
**任务**：为 3–5 个 handler 补最小单测（正常路径 + 一个错误路径），不引入新依赖。
**验收**：新增测试通过；`bun run ci` 全绿；在 PR 描述里列出覆盖的 handler 清单。
**参考**：`app/src/infrastructure/http/handlers/`

---

## 4. `[help wanted]` 建立 CI 覆盖率门槛（从「可观测」到「可阻断」）

**标签**：`help wanted`
**背景**：覆盖率长期约 4%，一直没设门槛；项目已有 20+ 项架构检查，缺的是覆盖率这一道。
**任务**：分两步——先让 CI 输出覆盖率报告（不阻断），确定基线后再把门槛设成「只拦下降」。
**验收**：CI 能看到覆盖率数字；门槛以棘轮方式生效（不允许比基线更低）；文档写清如何本地复现。
**参考**：`.github/workflows/ci.yml`、`scripts/` 下的 lint 脚本模式

---

## 5. `[security]` 危险命令规则（37 条）复现用例

**标签**：`security`、`help wanted`
**背景**：五层防线与 37 条危险命令规则已实现，但**没有第三方审计**；规则本身缺少可复现的验证样例。
**任务**：为规则构造一组负向样例（每条规则至少 1 个应被拦截的输入），标注实际命中规则。
**验收**：样例可重复执行；能指出「预期规则」与「实际规则」是否一致；不含真实破坏性命令（沙箱内或 dry-run）。
**参考**：`app/src/security`（规则定义）、`scripts/`

---

## 6. `[security]` 6 种沙箱后端的降级逻辑对照表

**标签**：`security`、`help wanted`
**背景**：6 种沙箱后端在不同平台/依赖缺失时如何降级，目前散落在代码里，外部审计者难以判断是否 fail-closed。
**任务**：整理一张表：后端 / 触发降级的条件 / 降级后的行为 / 是否 fail-closed / 源码位置。
**验收**：表格入文档（`app/docs` 或 `dev_docs`）；每个后端至少一条源码链接；发现 fail-open 的地方单独开 issue。
**参考**：`app/src/sandbox`、`app/src/security`

---

## 建单后核对（2026-10-29，已建 #1–#6）

> 草稿开头要求「建单前再核一次数字」，实际是建单后才逐条核对。以下为仓库当时实测值，供后续编辑 issue 时取用（本机无写权限 token，未直接改 issue 正文）。

| # | 草稿中的前提 | 实测 | 结论 |
|---|---|---|---|
| 1 | Phase A 未实施 | ❌ **前提不成立**：A1 路径（`environment/paths.ts:800/812/825`）、A2 `DomainManager`（`list/create/getConfig`）、A4 `SchemaLoader(schemaDir?, domainName?)` 均已完成；A3 桶导出、A5 迁移脚本未做；Phase B 参数就绪但**除 SchemaLoader 的 SPI seam 外无调用方传 domain**；Phase C 未做（`detectDomain` 已按 N-76 裁定删除）。`dev_docs/domain-first-plan.md` 存在（**155 行**，非空 127） | ⚠️ 已把「真实进度 + 6 个可认领子任务」作为评论发到 #1（2026-10-29） |
| 2 | `ChatManager` 7036 行 | `app/src/chat/ChatManager.ts` = **4840 行**（非空 4532）；`app/src/chat/**` 合计 **47547 行**（非空 44140）。⚠️ 口径提醒：`Measure-Object -Line` 统计的是**非空行**，别当总行数 | ❌ 数据过期且「抽出会话持久化」已完成（`manager/messagePersistence.ts` 510 / `eventLogStore.ts` 562）⇒ 原单 `not_planned` 关闭，已另开 **#8** |
| 3 | `handlers/` 测试覆盖为 0 | 该目录 **112** 个 `.ts`；`app/tests/http/` 下 **48** 个测试文件，含 `auto-reply-handlers` / `checkpoint-handlers` / `daily-budget-handlers` / `state-all.contract` 等直测 handler 的用例 | ❌ 前提不成立（应改为「覆盖仍不均衡」，或关闭） |
| 4 | CI 覆盖率门槛尚未建立 | `ci.yml:193` 已有 `Check coverage threshold (at least 18%)` → `bun run scripts/check-coverage-threshold.ts 18` | ❌ 前提不成立（门槛已存在；可改为「棘轮化/提升到只拦下降」） |
| 5 | 37 条危险命令规则 | `app/src/security/patterns/dangerousCommands.ts`：`DELETION 7 + FORMAT 3 + PRIVILEGE 4 + SYSTEM 3 + INJECTION 3 + COMPOSITE 7 + DANGEROUS_COMMAND_PATTERNS 10` = **37**；且建单时**无任何测试引用**这两份常量 | ✅ 属实 → **样例已补**：`app/tests/security/dangerousCommandRuleSamples.test.ts`（38 例，逐规则一条应拦截输入 + 正常命令零命中）；样例还驱动修掉一处规则过窄（`base64_decode_exec` 漏判 `base64 -d payload \| sh`） |
| 6 | 6 种沙箱后端 | `app/src/sandbox/` 下为 `darwin`（seatbelt）/ `landlock` / `win`（Low IL + Job Object）/ `docker`，另有 `adapters` 的 Local / Docker / SSH；`PTYSandbox` 仅 `spawn(shell)`，不套内核隔离 | ✅ 验收物已落地：`app/docs/配置与安全/沙箱后端降级对照.md`（6 行总表 + 逐后端细节 + 两个默认 fail-open 事实 + 复现命令），并由 `sandbox.md` 的「延伸阅读」链入 |

处置建议：#2 更新行数；#3、#4 改写前提或直接关闭（原目标已被满足）；#5、#6 的验收物均已落地（见上）+ 可关闭。

### 处置记录（2026-10-29 已执行）

- 新建 **#7** `[security] 沙箱两个默认值即 fail-open：landlock.failClosed 与 bashEnabled`（标签 `security`、`help wanted`），正文含两处默认值的 `file:line` 与三条候选修法。
- 给 **#2 / #3 / #4** 各补一条核对评论（带标记 `<!-- maintainer-note:2026-10-29 -->`，只补事实；关闭决定见下一条）。
- 仓库原本**没有 `security` 标签**（最初导入时按「标签不存在则跳过」处理，故 #5/#6 只剩 `help wanted`）⇒ 已新建该标签并回填 **#5 / #6 / #7**。
- 执行方式：一次性 workflow `.github/workflows/issue-maint.yml`，在临时分支上跑（跑完即删分支），用 CI 自带 `GITHUB_TOKEN`（`permissions: issues: write`）；按「标题 / 评论标记」幂等，重跑不产生重复。
- **#2 / #3 / #4 已按用户决定关闭**（2026-10-29，`close-issues.yml` 一次性作业）：#2 `not_planned`（正文行数过期、任务范围已变，需要时按新数据重开），#3 `completed`（handler 测试已存在），#4 `completed`（18% 覆盖率门槛已在 CI）。每条都先补了带原因的关闭评论（标记 `<!-- close-note:2026-10-29 -->`）。
- 当前 issue 状态：**open 8 条**（#1 / #7 / #8 / #9 / #10 / #11 / #12 / #13），**closed 5 条**（#2 / #3 / #4 / #5 / #6）。（该行是关闭 #2–#6 后的时点数；开出 S5 后为 open **9** 条，见本节末条。）
- **#1 的 Phase A 拆分已落地**：#1 评论里给出「真实进度 + 6 个子任务（S1–S6）」，6 条子 issue 现已**全部开出** —— **#9**（S1 桶导出，GFI）、**#10**（S2 `DomainManager` 单测，GFI）、**#11**（S3 迁移脚本）、**#12**（S4 `KnowledgeCompiler` 域支持）、**#13**（S6 prompt 域清单）、**#15**（S5 接线，域来源已裁定，见下）。另在 #1 留了子 issue 索引评论（后追加一条带 `2026-10-29-c` 标记的修订版）。
- 新建 **#8** `[help wanted] ChatManager 拆分第一阶段：抽出「检查点 + 预算」编排（当前 4840 行）`：按真实数据重开，正文含关注点词频（checkpoint 99 / budget 81 / persist 58 / approv 54 …）作为切分依据、明确的验收命令与「行为不变」约束；并在 #2 补了一条**行数口径勘误**评论（4532 是非空行数，实际 4840）。
- **#5 / #6 已关闭**（2026-10-29，`close-5-6.yml` 一次性作业，`completed`）：两者的验收物都已合入 `main` —— #5 是 `app/tests/security/dangerousCommandRuleSamples.test.ts`（38 例），#6 是 `app/docs/配置与安全/沙箱后端降级对照.md`；关闭评论里写明交付物与验证方式。需要时可直接 reopen。
- **S5 已开单（2026-10-29，用户裁定「域从哪来」）**：新建 **#15** `[help wanted]` 接线：把 domain 从会话 `metadata.domain` 透传到检索侧（S5），正文含实测现状（`AutoRagService.ts:85` / `QueryFeedbackPipeline.ts:96` 参数就绪但**全仓 0 构造点**、`spiWiring.ts:344` 唯一收到 domain 的是 `SchemaLoader`）、范围（只做检索侧；排除 UI / 自动判定 / 写侧）、3 条契约验收（传域→域根 / 未传→全局不变 / 域不存在→warn 回全局）。
  - ⚠️ 编号勘误：先前按「13 条 issue」推的下一个编号 **#14 实际被一个 PR 占用**（PR 与 issue 共号）⇒ 本子任务落在 **#15**。
  - 同时在 #1 追加了带标记（`<!-- sub-issues-index:2026-10-29-c -->`）的索引评论，按**真实 title**列出 #9–#13 + #15（不猜 S 编号↔issue 映射）。
  - 执行方式同上：一次性 workflow `sub-issue-s5.yml` 在临时分支 `ci/sub-issue-s5` 上跑（run `40827392334`，13s 成功），跑完已删本地与远端分支。
  - 当前 issue 状态（**开单当时的时点数**）：open 9 条（#1 / #7 / #8 / #9 / #10 / #11 / #12 / #13 / #15），closed 5 条（#2 / #3 / #4 / #5 / #6）；#1 的 6 个 Phase A 子任务至此**全部开单**。S1/S2 关闭后的最新数字见下条。
- **S1 / S2 已交付并关闭（2026-10-29）**：
  - **#9（S1 桶导出）** → commit `833701037`：新增 `app/src/knowledge/domain/index.ts`，`knowledge/index.ts` 两条深导入改 `'./domain'`，对外导出面不变；`tsc` 绿、`lint:arch` exit 0（仅存量 WARNING）、`bun test tests/knowledge` 33/33。
  - **#10（S2 `DomainManager` 单测）** → commit `cfbff93b4`：新增 `app/tests/knowledge/domainManager.test.ts`（10 例，覆盖 5 个方法），用 `LIRI_HOME`=mkdtemp 隔离并带「覆盖未生效即抛错」护栏，不写真实 `~/.pyapp`；未改生产代码。
  - 关单方式：一次性 workflow `close-9-10.yml` 在临时分支 `ci/close-9-10` 上跑（run `40830679423`，10s 成功），跑完已把该 workflow 从 main 移除并删分支。
  - **附带发现（待定，未开单）**：`DomainManager` 构造参数 `domainsRoot`（`DomainManager.ts:95-97`）只影响 `getDomainsRoot`/`ensureRoot`/`list` 的读取，`create`/`getConfig`/`writeConfig`/`countWikiPages` 一律走全局 `resolveDomainDir(name)` ⇒ 注入根与写入根可能不一致。
  - 当前 issue 状态：**open 7 条**（#1 / #7 / #8 / #11 / #12 / #13 / #15），**closed 7 条**（#2 / #3 / #4 / #5 / #6 / #9 / #10）。



