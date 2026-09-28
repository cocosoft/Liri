# 工具系统

## 概述

工具系统是 Agent 与外部世界交互的桥梁。Agent 通过工具执行文件操作、网络请求、代码执行等任务。

## 工具定义

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute(params: unknown): Promise<ToolResult>;
}
```

## 出参契约（`outputSchema`）—— ⚠️ 新增工具必读

> 2026-09-28 新增（P1-3 A 档落地）。**目的：明确这个字段管的是"哪一层"，避免接错。**

### 它是什么

`Tool.outputSchema` 是**工具出口 `data`** 的**运行期**契约（与泛型 `Output` 互补：后者只管编译期）。

- 类型：`{ safeParse(data: unknown): { success: boolean; error?: unknown } }`（兼容 zod 的 `safeParse`，**不强制** import zod）
- 执行点：`ToolExecutor.execute()` 中 governance / legacy 两分支的**唯一汇合处** → `validateToolOutputShape()`
- **失败不阻断**：只在 `metadata.outputSchemaError` 记一行 + warning；工具照常返回结果
- **未声明即不校验**：不写这个字段的工具**完全不受影响**（零行为变化）
- 校验对象：`result.data`（工具出口的结构化产物）
- **无载荷不校验**（2026-09-28 补）：`data` 为 `null`/`undefined` ⇒ 跳过（失败分支本就没有产出，
  不该被判"出参违规"；实证：`todo_write` 的 5 处 `null` 失败分支）
- **`success === false` 时也不校验**：但注意——**不设 `success` 的工具永远触发不了这条豁免**，
  这时靠上一条「无载荷不校验」兜底

### ⚠️ 它**不是**什么（最容易踩的坑）

**它不是"内层函数/辅助函数的返回契约"。** 实测中已发现 **4 例**这类误用（`glob` / `bash` / `web_fetch` / `web_search`）——它们的 `schemas.ts` 里写的 schema 描述的是**内层实现函数**的返回值，与**工具出口的 `data`** 字段名/结构都不同。

> 若把这种 schema 直接接到 `Tool.outputSchema` 上，**每次调用都会校验失败**（往 `metadata.outputSchemaError` 灌噪音）。

**接线前必须实测工具出口的 `data` 形态**（看各处 `createToolResult` / `createSuccessResult` 的**第一实参**），而不是"看到 `*OutputSchema` 就接"。

> 2026-09-28（T4）：上表 `web_fetch` / `web_search` / `todo_write` 三处**错层 schema 已删除**
> （删前已用 grep 确认**零消费者**）。`todo_write` 的正确契约已**就地在工具上**声明
> （`TodoWriteTool.ts:420` = `z.string()`）；另两个出口是"字符串 ∪ 对象"的多形态，见下节。
> 详见 `.trae/specs/tool-output-schema-layer-audit.md`（T4）。

### 怎么写（示例）

```ts
// ✅ 出口 data 是字符串（如 file_read：正文/Markdown/错误说明走同一通道）
outputSchema = z.string();   // 刻意不断言非空 —— 空文件/空产物合法

// ✅ 出口 data 是结构对象（且各分支结构一致）
outputSchema = z.object({ matches: z.array(z.unknown()), query: z.string() });

// ⚠️ 出口形态随参数变化（多态出口，如 sessions 的 list/status/history…）
//    ⇒ 单一 schema 无法表达 ⇒ 不要声明（或先重构出口形态）

// ❌ 把"内层函数"的 schema 接上来（字段名与出口不一致 ⇒ 每次失败）
outputSchema = GlobOutputSchema;  // 它描述的是内层 globAsync()，不是出口
```

### 已知不适合声明的形态

| 形态 | 例子 | 原因 |
|---|---|---|
| **多态出口**（随参数/action 变化） | `sessions` | 单一 schema 无法表达 |
| **成功/失败形态不同**（失败分支的 `data` 是**字符串**，成功分支是**对象**） | `web_fetch` / `web_search` | 理论上可写 `z.union([z.string(), …])`，但"含 string 的联合"**几乎不设防**；根因是这些分支**未标 `success: false`**（属工具层缺陷，修它属另一议题）⇒ **不接**。其错层 `*OutputSchema` 已于 2026-09-28 删除（T4） |

---

## 工具注册

```typescript
// 注册系统工具
toolRegistry.register(new FileReadTool());
toolRegistry.register(new FileWriteTool());
toolRegistry.register(new BashTool());

// 通过插件注册工具
plugin.registerTool("custom_tool", {
  description: "我的自定义工具",
  execute: async (params) => { /* ... */ }
});
```

## 工具执行流程

```
Agent 选择工具 → 验证参数 → 权限检查 → 执行 → 返回结果
                                         ↓
                                     审计日志
```

## 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | file_read, file_write, FileEditTool | 文件操作 |
| 网络 | web_fetch, web_search | 网络访问 |
| 系统 | Bash | 命令执行 |
| 媒体 | ImageGeneration, TTS | 媒体生成 |
| 浏览器 | Browser | 浏览器控制 |
| 代码 | CodeExecution | 代码运行 |
| AI | Thinking, MCP | AI 工具 |

## 工具安全

所有工具执行前经过治理系统安全检查：

- 路径验证（文件工具）
- 命令白名单（Bash 工具）
- URL 白名单（网络工具）
- 频率限制（所有工具）
