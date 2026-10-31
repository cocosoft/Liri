# 核心模块（core / `@openliri/kernel`）

六层架构的**最底层**（`entry > ui > app > service > infra > core`）：**零上层依赖、零跨包导入**，
`package.json` 的运行期依赖只有 `@opentelemetry/api`。

**唯一纳入判据：零 I/O。** core 只回答「有哪些契约、怎么装配、错误/开关/身份怎么定位」；
一旦需要读磁盘 / 网络 / 数据库 / 环境变量，就不属于 core —— 例如目录解析已整体迁到
`@modules/environment`（2026-10-28），内核不再持有 `resolveDataDir` / `resolveDbPath`。

分层事实源：`scripts/modules-to-layers.json`（本目录固定为 `core`）；治理目标与 Linux 内核映射见
`.trae/specs/kernel-style-architecture-governance.md`。

## 保留内容（2026-10-31 实测）

| 类别 | 内容 |
|---|---|
| 契约与端口 | `spi/`（15 个可注册窄端口 + `wiringGuard`）、`ports.ts`、`data-models.ts`、`knowledge-types.ts` |
| 装配与生命周期 | `di/`（AutoWiring / CycleDetector / DisposeManager）、`DIContainer`、`DependencyRegistry`、`ModuleBootstrapper`、`lazy/`、`cache/` |
| 事件与身份 | `events/`（EventBus / UiEventBus / TokenTracker / OrchestrationMetrics）、`identity/`（principal / requestScope / scopedResources）、`connections/` |
| 横切关注点 | `errors` / `errorCodes` / `errorHandler`、`featureFlags`、`loggerFacade` / `tracingFacade` / `profilerFacade`、`abortReason`、`SimpleMutex`、`taskStatus`、`sandboxPermission`、`deprecationNotice`、`orchestrationEvents` |
| 观测与健康 | `health/`、`systemgraph/`、`outputGuard/`（类型与注册表，不含实现）、`sleep/`、`protocol/`、`utils/` |
| 唯一事实源常量 | `ids`、`endpoints`、`productIdentity`、`pricing`、`AppCoreConfig`、`httpPortFallback` |

## 明确**不在** core

- 业务域：`session` / `chat` / `query` / `tools` / `channels` / `runtime` / `infrastructure`（service / app 层）；
- 安全实现：`sandbox` / `security` / `permission`（app / infra 层，只以 `spi` 端口暴露契约）；
- 资源与模型：`vfs`（app 层，驱动契约也在 app）、`ai` / provider 协议（app 层）；
- 环境相关：目录与路径解析（`@modules/environment`）、配置落盘、数据库访问。

## 使用

```typescript
import { feature } from '@openliri/kernel';
import { registerAllSpis } from '@modules/entrypoints/spiWiring';
```

> 历史遗留说明：此前本 README 曾列出 `AppCore` / `Coordinator` / `state/` / `config/` / `auth/` /
> `context/` / `loop/TAORLoop` / `tasks/` / `theme/` —— 这些目录在当前 kernel 中**均不存在**
> （业务域已归 app/service，路径解析已归 environment）。若需新增到 core，先回答「它是否零 I/O」。
