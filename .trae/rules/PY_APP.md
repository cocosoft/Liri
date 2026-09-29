---
alwaysApply: true
description: 通用行为准则，所有对话始终生效。定义先思考再编码（含新增前先检查是否已有）、简洁优先、外科手术式修改、目标驱动执行、基于证据的分析等6条核心准则。
---

# Liri.md

> 减少 LLM 常见编码错误的行为准则。与项目特定说明配合使用。
>
> Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**权衡：** 以下准则偏向谨慎而非速度。对于简单任务，请自行判断。
**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. 先思考，再编码 / Think Before Coding

**不要假设。不要隐藏困惑。暴露权衡。**
**Don't assume. Don't hide confusion. Surface tradeoffs.**

实施之前 / Before implementing:
- 明确陈述你的假设。如果不确定，就问 / State your assumptions explicitly. If uncertain, ask.
- 如果存在多种解读，全部列出——不要默默选择 / If multiple interpretations exist, present them - don't pick silently.
- 如果有更简单的方案，说出来。必要时提出异议 / If a simpler approach exists, say so. Push back when warranted.
- 如果有不清楚的地方，停下来。说出困惑所在。提问 / If something is unclear, stop. Name what's confusing. Ask.

**新增前先检查是否已有（归一化原则）**
**Check before creating (Normalization Principle)**

提出新增模块、功能或代码方案前，必须先执行以下检查：
- 搜索代码库中是否已有相同或相似实现（使用 SearchCodebase / Grep 工具）
- 检查 `src/types/` 中是否已有相关类型定义
- 检查 `src/utils/common.ts` 中是否已有相关工具函数
- 检查 `ModuleDefinitions.ts` 中是否已有相关模块注册
- 如果已有，优先复用或扩展，而非另起炉灶

> 这条原则与 architecture.md 中的"实现唯一性原则（双轨制禁止）"配合使用：前者是新增前的预防检查，后者是发现后的清理规范。

---

## 2. 简洁优先 / Simplicity First

**用最少的代码解决问题。不做投机性扩展。**
**Minimum code that solves the problem. Nothing speculative.**

- 不做需求之外的功能 / No features beyond what was asked.
- 不为一次性代码做抽象 / No abstractions for single-use code.
- 不做未被要求的"灵活性"或"可配置性" / No "flexibility" or "configurability" that wasn't requested.
- 不为不可能的场景做错误处理 / No error handling for impossible scenarios.
- 如果你写了 200 行而它本可以用 50 行完成，重写它 / If you write 200 lines and it could be 50, rewrite it.

问问自己："高级工程师会觉得这个过于复杂吗？"如果是，简化。
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## 3. 外科手术式修改 / Surgical Changes

**只动必须动的。只清理自己造成的混乱。**
**Touch only what you must. Clean up only your own mess.**

编辑现有代码时 / When editing existing code:
- 不要"改进"相邻的代码、注释或格式 / Don't "improve" adjacent code, comments, or formatting.
- 不要重构没有坏的东西 / Don't refactor things that aren't broken.
- 匹配现有风格，即使你会有不同做法 / Match existing style, even if you'd do it differently.
- 如果你发现无关的死代码，提出来——但不要删除它 / If you notice unrelated dead code, mention it - don't delete it.

当你的修改产生了孤儿引用 / When your changes create orphans:
- 移除**你的修改**导致不再使用的导入/变量/函数 / Remove imports/variables/functions that YOUR changes made unused.
- 不要删除预先存在的死代码，除非被要求 / Don't remove pre-existing dead code unless asked.

检验标准：每一行被修改的代码都应直接追溯到用户的需求。
The test: Every changed line should trace directly to the user's request.

---

## 4. 目标驱动执行 / Goal-Driven Execution

**定义成功标准。循环直到验证通过。**
**Define success criteria. Loop until verified.**

将任务转化为可验证的目标 / Transform tasks into verifiable goals:
- "添加验证" → "为无效输入编写测试，然后让测试通过" / "Add validation" → "Write tests for invalid inputs, then make them pass"
- "修复这个 bug" → "编写可重现该 bug 的测试，然后让测试通过" / "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "重构 X" → "确保重构前后测试都通过" / "Refactor X" → "Ensure tests pass before and after"

对于多步骤任务，陈述简要计划 / For multi-step tasks, state a brief plan:
```
1. [步骤/Step] → 验证/verify: [检查/check]
2. [步骤/Step] → 验证/verify: [检查/check]
3. [步骤/Step] → 验证/verify: [检查/check]
```

强成功标准让你能独立迭代。弱成功标准（"让它工作"）需要不断澄清。
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 5. 基于证据的分析 / Evidence-Based Analysis

**不要假设不存在。不要隐藏缺陷。不要跳过深度。**
**Don't assume absence. Don't hide flaws. Don't skip depth.**

执行分析、评估或对比任务时 / When performing analysis, evaluation, or comparison tasks:
- **下结论前彻底扫描** — 遍历完整目录树并用 grep 搜索关键词。"没找到"≠"不存在"，直到搜索确认 / **Scan thoroughly before concluding** — traverse full directory trees and grep for keywords. "Not found" ≠ "Does not exist" until confirmed by search.
- **每个结论都需要来源** — 标注文件路径+行号。❌ 结论必须通过 grep 验证 / **Every claim needs a source** — annotate with file path + line number. ❌ claims must be verified by grep.
- **不粉饰** — 如实报告缺陷。不要把 ⚠️ 升级为 ✅。对外发布的内容必须反映真实缺陷 / **No sugarcoating** — report flaws honestly. Don't upgrade ⚠️ to ✅. Public-facing content must reflect real defects.
- **发现即记录** — 分析过程中发现的任何预存问题、异常、不一致，必须**当场记录到指定文档**（如 `dev_docs/error_repairs/预存错误与待处理问题.md`）。不得以"与本次任务无关"为由跳过记录，不得先问再记。记录是发现的责任，不是可选项 / **Record on discovery** — any pre-existing issues, anomalies, or inconsistencies found during analysis must be recorded on the spot in the designated document. "Not relevant to this task" is not a valid reason to skip recording. Recording is a responsibility of discovery, not an option.
- **深度到位** — 分析必须深入到类/接口/函数级别，不能停留在目录结构。记录签名、参数、返回值和职责 / **Go deep enough** — analysis must reach class/interface/function level, not just directory structure. Record signatures, parameters, return values, and responsibilities.
- **所有模块一视同仁** — 大模块和小模块、核心模块和边缘模块同等对待 / **All modules are equal** — treat large and small, core and peripheral modules with the same rigor.
- **先计划，后执行** — 复杂任务需要书面计划，经确认后按步骤执行。不得跳跃 / **Plan first, then execute** — complex tasks require a written plan with agreed steps. No skipping ahead.
- **独立完成** — 直接执行。不要问"要不要我做这个"。先尝试解决障碍，卡住再问 / **Own it** — execute independently. Don't ask "should I do this?" Try to resolve obstacles first, ask only when stuck.

---

**这些准则有效的标志：** diff 中不必要的修改减少，因过度复杂导致的返工减少，澄清性问题在实施之前而非犯错之后提出，分析结论经得起独立验证。
**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and analysis conclusions hold up under independent verification.
