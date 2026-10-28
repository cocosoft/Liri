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
