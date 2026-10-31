# 贡献指南

## 最小可行贡献（两次改动路径）

首次贡献不必通读 100 万行：下面两条路径覆盖最常见的改动类型，按顺序做即可通过全部门禁。

### A. 新增一个内置工具

| 步骤 | 做什么 | 为什么 |
|---|---|---|
| 1 | 实现放 `app/src/tools/<域>/YourTool.ts`，经 `getToolRegistry()` **唯一写入口**注册 | 第二份注册表会让工具面与 `TOOL_CATEGORIES` 必然漂移（`project_rules §1.16`） |
| 2 | 在 `app/src/tools/toolCategories.ts` 的 `TOOL_CATEGORIES` 显式登记类别 | 未登记会静默落 `misc`，按任务裁剪时被裁掉 |
| 3 | `cd app && bun run gen:toolnames` | 工具名枚举由脚本生成，手改即漂移 |
| 4 | 跑 `bun run lint:arch`、`bun run lint:infra`、`bun run lint:status`、`bun test tests/tools` | 分层 / infra 边界 / 数量一致性 / 工具面回归 |
| 5 | 需要按任务可见性时改装配点（`variant-matrix` / `toolCategories`），**不要**在工具实现里 `feature('TOOL_*')` 自审 | W4 门禁（`lint:architecture-boundaries`）会拦 |

### B. 修一个通道 bug

| 步骤 | 做什么 | 为什么 |
|---|---|---|
| 1 | 实现只在 `app/src/channels/<type>/`；注册走 `channelBootstrapper` → `channelRegistry.register()` | 绕过 Registry 直注册会失守双注册守卫 |
| 2 | 入站消息一律走 `routeChannelMessage()`（`channels/routing/`） | 自建去重 / 帧验证会与该管线冲突（`project_rules §1.14`） |
| 3 | 新增或下线通道：改 `app/src/channels/ChannelCatalog.ts`（`exportKey` + `isEnabled`），再 `bun run gen:status` | 通道条目数会进 `STATUS.md`，漏跑会被 pre-commit 拦 |
| 4 | 跑 `bun test tests/channels`、`bun run lint:arch`、`bun run lint:status` | 通道回归 + 分层 + 数量一致性 |

### 提交前会自动跑什么

`git commit` 的 pre-commit 依次执行：架构合规（含「为什么是问题」说明）、infra 层边界契约、`STATUS.md` 漂移、
修复证据登记、GitHub Actions YAML、四个棘轮门禁（state / fn-size / consts / unref）、类型检查、ESLint `--fix`、模块验证。
全绿才会放行；失败时按输出里的「建议 / 为什么是问题」修，而不是绕过。

> 数字（工具 / 通道 / 模块）**只在 [STATUS.md](./STATUS.md) 出现**，README 不写死；改了事实源务必 `cd app && bun run gen:status`。

## 版本号管理规范

本项目遵循 [SemVer 语义化版本规范](https://semver.org/lang/zh-CN/)（`主版本.次版本.修订号`），版本号在 `app/package.json` 的 `version` 字段中集中管理。

### 版本号格式

```
主版本.次版本.修订号[-预发布后缀]
```

### 版本号递增规则

| 版本位 | 触发条件 | 示例 |
|--------|----------|------|
| **主版本** | 不兼容的 API 变更 | `1.0.0` → `2.0.0` |
| **次版本** | 向下兼容的功能新增 | `1.0.0` → `1.1.0` |
| **修订号** | 向下兼容的问题修正 | `1.0.0` → `1.0.1` |

### 发版流程

1. **更新版本号**：修改 `app/package.json` 的 `version` 字段
2. **更新 CHANGELOG**：记录本次发版的所有变更
3. **提交并打 Tag**：
   ```bash
   git commit -m "chore: release v1.0.0"
   git tag v1.0.0
   git push --tags
   ```
4. Tag 格式：`v{主版本}.{次版本}.{修订号}`（例如：`v0.4.25`）

### 预发布版本

预发布版本在修订号后添加连字符和后缀：

- `1.0.0-alpha.1` — 内部测试
- `1.0.0-beta.1` — 公开测试
- `1.0.0-rc.1` — 发布候选

### 注意事项

- 禁止直接在 `package.json` 以外的地方硬编码版本号
- 构建产物中的版本信息需通过构建脚本从 `package.json` 自动读取
- 代码中如需引用版本号，应通过 `import { version } from '../package.json'` 引入

## 安全问题

发现安全漏洞请**不要**开公开 issue —— 按 [SECURITY.md](./SECURITY.md) 的私密渠道报告，说明版本、复现步骤与影响面。
