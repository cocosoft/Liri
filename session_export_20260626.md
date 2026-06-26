# 会话导出：简历测试 + 上下文丢失问题分析

时间：2026-06-26
会话总轮数：约 20+ 轮

## 参与者

- **用户**：彭云（工作经历、学历等信息已收集）
- **AI**：Liri

## 会话流程

### 阶段 1：简历写作（测试目的）

用户测试 Liri 的长程沟通能力表面上是要写简历，实际目的是测试上下文保持能力。

**已完成的信息收集：**
- 姓名：彭云
- 教育背景：1996-2000中专（财务会计），2000-2003大专（计算机应用）
- 工作经历：
  - 2003-2005：实施工程师/开发工程师（基层）
  - 2005-2008：创业（计算机软件，失败）
 - 2008-2012：私营企业，高级开发→软件架构→项目负责人
  - 2012-至今：某央企下属子公司，从实施到咨询，经历信息化→数字化→数智化全过程
-当前城市：昆明、广州
- 求职意向：AI Agent 架构师/技术负责人
- Liri 项目：从零到一独立开发
- 技术能力：GOF→EA→分布式→AI 近 30 年技术演进

### 阶段 2：问题暴露（关键测试点）

用户在过程中发现 Liri 的上下文丢失问题：

1. **第 1 次丢失**：用户已说"彭X"，Liri 随后又询问"你叫什么名字？"
2. **第 2 次丢失**：用户质疑"你是不是没有看会话过程"，Liri 承认上下文丢失
3. **第 3 次丢失**：用户指出"你的源码在 E:\PY\CODES\PY_APP"，Liri 之前没有记住这个信息

### 阶段3：Liri 的自查分析

Liri 读取了以下源码模块进行分析：

**已读取的模块：**
- `dream/DreamEngine.ts` — 梦境引擎
- `dream/DreamScheduler.ts` — 梦境调度
- `dream/DreamPersistence.ts` — 梦境持久化- `dream/DreamPhaseManager.ts` — 梦境阶段管理
- `dream/types.ts` — 梦境类型定义
- `chronos/autoDream/AutoDream.ts` — 自动梦境整合
- `chronos/autoDream/ConsolidationLock.ts` — 整合锁
- `chronos/autoDream/ConsolidationPrompt.ts` — 整合提示词
- `chronos/autoDream/DreamAgentExecutor.ts` — 梦境执行器
- `chronos/autoDream/DreamGraphPhase.ts` 图阶段
- `memory/MemoryManager.ts` — 记忆管理器
- `memory/ContextFence.ts` — 上下文篱笆
- `memory/consolidation/MemoryConsolidator.ts` — 记忆整合
- `session/SessionManager.ts` — 会话管理器
- `session/TranscriptManager.ts` — 会话转录管理器
- `session/compaction/SessionCompactionBridge.ts` — 压缩桥接
- `services//AutoCompactService.ts` — 自动压缩服务
- `services/compact/CompactOrchestrator.ts` — 压缩编排器
- `services/compact/CompactService.ts` — 压缩服务实现
- `services/compact/sessionMemoryCompact.ts` — 会话内存压缩

### 阶段 4：分析结论

**问题 1：同一会话内信息丢失**
 根因：Liri 在提问前没有"自查"机制，不会检查当前会话历史是否已有答案
- 涉及组件：无（这是 AI 行为层面的缺失）

**问题 2：梦境机制效果不佳**
- 梦境配置太保守（15 分钟空闲 + 6 小时间隔）
- 梦境主动排除当前会话（`sessionIds.filter(id => id !== currentSession)`）
- 梦境到记忆的反馈链路太长（6+ 步骤）

**问题 3：缺少事实提取层**
- Transcript/Compaction 做的是摘要而非事实识别
- 用户宣告个人信息时没有实时提取存入缓存

**问题 4：自我认知缺失**
- Liri 不知道自己叫什么、是谁开发的、源码在哪
- 这些信息没有在系统层面主动学习和记忆

## 输出文件

- 简历草稿：`E:\PY\Desktop\彭云_简历.md`
- 本分析文件：`E:\PY\CODES\PY_APP\session_export_20260626.md`
