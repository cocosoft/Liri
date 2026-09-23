# ModelManagementAPI 拆分 Spec

> 版本: 1.0 | 创建: 2026-08-09 | 最后更新: 2026-08-09
> 关联: AR04（API 子域拆分）/ GR16-002（大文件拆分必须建 Spec）
> 源文件: `app/src/ai/ModelManagementAPI.ts`（2855 行 → 拆分后聚合入口 ~300 行）

## 1. 职责边界

- **本模块负责**: 模型/Provider/定价/用量/能力等 REST API 的路由分发（`tryHandleRoute`），按业务子域拆分 handler 实现
- **本模块不负责**:
  - 实际业务逻辑（ProviderManager / ModelPricingService / CapabilityService 等底层服务不动）
  - 运行时 chat 请求路径（modelRouter 独立，不参与）
  - 路由注册框架（沿用现有 `tryHandleRoute` + ROUTES 数组模式，不引入 http/Router）

## 2. 目录结构

```
app/src/ai/
├── ModelManagementAPI.ts        # 聚合入口：ROUTES 数组 + tryHandleRoute + 公共辅助导出（~300 行）
└── api/
    ├── utils.ts                 # 共享辅助：parseBody / sendJson / sendError / RouteHandler / parseSecondsParam
    ├── ProviderAPI.ts           # Providers 子域（9 handler）
    ├── PricingAPI.ts            # Usage + Balance + Pricing 子域（10 handler）
    ├── ModelAPI.ts              # Custom Models 子域（5 handler）
    ├── ModelRuntimeAPI.ts       # Model Runtime + Provider Presets 子域（14 handler）
    ├── ConfigAPI.ts             # App Model Config + Soul/User 子域（8 handler）
    ├── CapabilitiesAPI.ts       # Capabilities 子域（12 handler）
    └── TranslateAPI.ts          # Translate 子域（7 handler）
```

## 3. 公共 API

| 导出 | 类型 | 说明 |
|------|------|------|
| `tryHandleRoute` | function | 路由分发入口，保持 `app/src/ai/index.ts` 导出契约不变 |
| 各子域 handler | function | 从 ModelManagementAPI.ts 原样搬移，导出供聚合入口引用 |
| `parseBody` / `sendJson` / `sendError` | function | 从 utils.ts 共享 |

## 4. 依赖

| 依赖 | 方向 | 说明 |
|------|:---:|------|
| `./providers/ProviderManager.js` 等 | → | 动态 import，相对路径从 `./` 改 `../` |
| `@modules/error`（handleError / AppError） | ↑ 核心层 | 错误处理 |
| `@modules/monitoring`（getLogger） | ↑ 核心层 | 日志 |
| `@modules/services/soul/*` | → | Soul/User 子域 |

## 5. 数据模型

- 无新增表。沿用 `providers` / `model_registry` / `model_usage_logs` 等既有表。
- `RouteEntry` / `RouteHandler` 类型从 ModelManagementAPI.ts 移入 `api/utils.ts`。

## 6. 合规检查表

- [x] 拆分后每个文件 < 800 行（GR01-001）— 实测最大 ModelRuntimeAPI 659 行，主文件 2855→431 行
- [x] handler 之间无交叉调用（已 grep 验证，仅共享辅助函数）
- [x] `tryHandleRoute` 导出契约不变（ai/index.ts 无需修改）
- [x] 各子域文件仅保留实际使用的静态 import（eslint no-unused-vars 0 error）
- [x] 迁移只搬移不删除逻辑（CS05 根因优先：业务逻辑 0 变更）
- [x] 验证（2026-08-09 完成）：typecheck ✓ + lint:arch ✓（errors 0）+ 全量测试 **2315 pass / 30 skip / 0 fail**（与基线一致）
