---
description: 运维与安全规范。适用于部署、安全检查、生产化上线等场景。包含安全必做项、生产化Checklist（P0/P1/P2优先级）、补充检查清单（运维/安全/架构视角）等。
---

# 运维与安全规范 / Operations & Security

> 安全必做项、生产化 Checklist、LLM 开发检查清单。
>
> Security requirements, production checklist, and LLM development checklist.

---

## 一、安全必做项 / Security Requirements

参考 `cc_code/bashSecurity.ts`（CC）、`infra/exec-safety.ts`（OpenClaw）以及 `agent/prompt_builder.py`（Hermes-Agent 的 Prompt Injection 检测）的检查：

- 阻止危险 Zsh 内置命令
- 防御 Zsh equals expansion
- Unicode 零宽字符注入检测（对标 Hermes `_CONTEXT_INVISIBLE_CHARS`）
- IFS null-byte 注入防护
- 阻止 `rm -rf /` 等破坏性操作
- Prompt Injection 模式检测（对标 Hermes `_CONTEXT_THREAT_PATTERNS` 10+ 检测模式）
- 敏感信息脱敏（对标 Hermes `agent/redact.py`）

---

## 二、生产化 Checklist / Production Checklist

| 能力             | 优先级 | 说明                                |
| -------------- | --- | --------------------------------- |
| 会话持久化          | P0  | Checkpoint + Rollback             |
| 成本追踪           | P0  | 记录 token 消耗                       |
| 类型安全           | P0  | 零 @ts-nocheck，strict 模式全覆盖        |
| MCP 模块统一       | P0  | 合并 mcp/ 和 services/mcp/，消除重复      |
| 启动入口统一         | P0  | 单入口 launch() 分发，删除历史入口            |
| State 管理统一     | P0  | 完成 state/ → core/state/ 迁移        |
| 日志系统           | P1  | 统一 Logger API，禁止 console.\*       |
| 错误处理           | P1  | 标准化 AppError + ErrorCodes 体系      |
| 后台守护进程         | P1  | 进程管理 + 任务队列 + IPC                 |
| 遥测系统           | P1  | OpenTelemetry 集成                  |
| Hook 系统        | P1  | 事件节点支持脚本拦截                        |
| MCP 协议         | P1  | 支持全协议                             |
| 工具分区并发         | P1  | 只读工具并发、写入工具串行                     |
| 上下文压缩          | P1  | autoCompact + reactiveCompact 多策略 |
| FeatureFlag 统一 | P1  | 单一数据源 + 编译时 DCE                   |
| 安全模块整合         | P1  | 统一到 security/，消除散布                |
| 状态管理统一         | P2  | core/state/ 为唯一来源（持续完善）           |
| 缓存系统统一         | P2  | ICache 接口 + 工厂模式                  |
| CLI 命令补齐       | P2  | 达到 50+ 命令覆盖                       |
| 对标Hermes-Agent安全防护 | P0  | Prompt Injection检测（10+模式）+ 隐形字符检测 + 敏感信息脱敏 |
| 对标Hermes-Agent技能系统 | P1  | Curator自动维护 + Skill生命周期管理 + 预处理管线 |
| 对标Hermes-Agent插件生态 | P1  | 多来源插件（bundled/user/project/pip）+ 9种生命周期钩子 |
| 对标Hermes-Agent记忆系统 | P1  | MemoryProvider ABC + 单外部提供者约束 + StreamingContextScrubber |
| 对标Hermes-Agent压缩引擎 | P1  | ContextEngine ABC 可插拔架构 |
| 对标OpenClaw通道系统 | P1  | 多通道（Telegram/Discord/Slack/IRC）支持 |
| 对标OpenClaw插件生态 | P1  | 安装/市场/Provider体系                  |
| 对标OpenClaw配置管理 | P1  | Schema驱动/IO审计/脱敏/合并恢复             |
| 对标OpenClaw守护进程 | P2  | systemd/launchd/schtasks跨平台服务     |
| 对标OpenClaw网关系统 | P2  | HTTP+WS+MCP+OpenAI兼容网关            |

---

## 三、补充检查清单（运维/安全/架构视角）

> 基础开发检查项见 [development-workflow.md §2.12](file:///e:/PY/CODES/Liri/.trae/rules/development-workflow.md#L158-L192) "开发完成检查清单" 和 [§2.13](file:///e:/PY/CODES/Liri/.trae/rules/development-workflow.md#L198-L211) "提交前检查流程"。本清单为运维/安全/架构视角的补充项。

- [ ] 使用 Logger 替代 console.\*（[project_rules.md §1.7](file:///e:/PY/CODES/Liri/.trae/rules/project_rules.md#L75-L87)）
- [ ] 使用 AppError + ErrorCodes 处理异常（[project_rules.md §1.8](file:///e:/PY/CODES/Liri/.trae/rules/project_rules.md#L89-L109)）
- [ ] 通过 launch() 入口启动，不直接引用历史入口（[project_rules.md §1.9](file:///e:/PY/CODES/Liri/.trae/rules/project_rules.md#L111-L124)）
- [ ] MCP 模块遵循标准层/增强层分离原则（[project_rules.md §1.10](file:///e:/PY/CODES/Liri/.trae/rules/project_rules.md#L126-L136)）
- [ ] 内置命令实现懒加载 + 独立文件 + UI 组件（[architecture.md §2.2](file:///e:/PY/CODES/Liri/.trae/rules/architecture.md#L67-L71)）
- [ ] 工具按只读/写入分区执行（[architecture.md §3.6](file:///e:/PY/CODES/Liri/.trae/rules/architecture.md#L114-L119)）
- [ ] 上下文压缩策略已实现（[architecture.md §3.7](file:///e:/PY/CODES/Liri/.trae/rules/architecture.md#L121-L126)）
- [ ] FeatureFlag 统一到 core/featureFlags.ts（[architecture.md §3.8](file:///e:/PY/CODES/Liri/.trae/rules/architecture.md#L128-L133)）
- [ ] 缓存系统实现 ICache 接口（[architecture.md §3.10](file:///e:/PY/CODES/Liri/.trae/rules/architecture.md#L143-L148)）
- [ ] **三源学习验证**：新需求先检查 CC、Hermes-Agent 和 OpenClaw 是否已有可复用方案
- [ ] **对标项验收**：新增功能是否已在 dev_docs/YYYYMMDD/ 对标报告中与 CC / Hermes-Agent / OpenClaw 对比

---

## 四、前后端日志分离规范 / Frontend-Backend Log Separation

> 本规范由 .trae/rules/operations.md（约定层）和 eslint.config.js（程序层）双重固化。

### 4.1 三角分类法则

每条输出信息必须明确归入以下三类之一：

| 类别 | 输出方式 | 受众 | 示例 |
|------|---------|------|------|
| **调试日志** | `Logger` (.info/.warn/.error/.debug) | 开发者（后端日志文件） | 模块初始化耗时、API 响应 body、数据库备份状态 |
| **用户结果** | IPC 返回值 / Tool result / CommandResult | 终端用户（前端展示） | 工具执行结果、查询结果、操作提示 |
| **CLI 终端输出** | `console.log`（仅在 CLI 模式下） | CLI 终端用户 | 授权 URL、进度条、交互式提示 |

### 4.2 强制规则

1. **后端内部代码禁止使用 `console.log/warn/error`** — 必须使用 `Logger` 类
2. **工具/命令执行结果**必须通过返回值返回给前端，而非 `console.log`
3. **错误详情分层**：工具返回值只包含用户可读消息，完整错误信息（含堆栈、API body）通过 `Logger.error` 记录到后端
4. **CLI 模式**是唯一允许 `console.log` 的场景（CLI 模式下终端即为用户界面）

### 4.3 代码模式

```typescript
import { Logger } from '@modules/monitoring/logs/Logger';
const logger = new Logger('MyModule');

// ✅ 正确：后端日志记录完整细节
logger.error('GitHub API 调用失败', { status: response.status, body: errorBody });

// ✅ 正确：返回给前端仅含可读消息
return {
  success: false,
  message: 'GitHub API 请求失败',
  ...(process.env.NODE_ENV === 'development' && { debug: errorBody }),
};

// ❌ 禁止：将后端内部信息直接吐出到前端
return { success: false, output: `GitHub API error (${response.status}): ${errorBody}` };

// ❌ 禁止：在非 CLI 模块中使用 console.log
console.log('操作完成');
```

### 4.4 ESLint 豁免策略

| 豁免范围 | 原因 |
|---------|------|
| `src/cli/**/*.ts` | CLI 模式下 `console` = 用户界面 |
| `src/entrypoints/**` | 入口点需要终端输出 |
| `src/ui/**/*.ts` | UI 渲染层 |
| `src/*/cli/**/*.ts` | 各模块的 CLI 子命令 |
| Logger.ts / ConsoleExporter.ts / LogSink.ts | 日志基础设施自身 |
| `**/*.test.ts` / `**/*.spec.ts` | 测试文件 |

> 以上范围之外的 `console.*` 调用会触发 ESLint `no-console: warn` 告警。

---

## 五、编译部署 Checklist

> 编译打包（`bun build --compile`）后验证清单，适用于 exe 分发前的质量确认。

| # | 检查项 | 验证方式 |
|---|--------|---------|
| 1 | exe 在非编译盘符下能否正常启动 | 复制到另一磁盘运行，检查预置目录和健康报告 |
| 2 | `~/.pyapp/` 目录是否自动创建 | 首次运行后检查 |
| 3 | `SOUL.md` / `USER.md` 是否自动生成 | 首次运行后检查 |
| 4 | `OAUTH_ENCRYPTION_KEY` 是否已设置 | 检查环境变量 |
| 5 | 可选依赖清单（README-compiled.md）是否随包附带 | 检查 `dist/` 下是否存在 |
| 6 | 跨磁盘文件操作是否正常 | 测试读取另一盘符的文件 |
| 7 | 健康报告是否在首次启动时正常展示 | 观察启动控制台输出 |
| 8 | 断路器是否正确跳过不可用服务 | 断开网络后启动，检查 DEBUG 日志 |

> 对应设计文档：[07-编译部署关键问题与优化建议.md §5](file:///E:/PY/CODES/Liri/dev_docs/20260526/07-编译部署关键问题与优化建议.md#L272-L283)。
