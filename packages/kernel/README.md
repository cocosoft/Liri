# @openliri/kernel

Liri 的微内核（六层架构最底层 `core`）：**零跨包导入、零上层依赖**，只允许 `node:*` / `bun:*` 与唯一三方依赖 `@opentelemetry/api`。

> **当前状态：未发布**（`package.json` 仍 `private: true`）。发布通道与去 `private` 属阶段二动作，见
> `dev_docs/20261024/基础设施专项-现状与规划.md` §7（发布就绪度）。

## 安装与使用

```bash
# 阶段二发布前：以本仓 tsconfig 的显式映射消费（`@openliri/kernel/*`），不走 node_modules
# 发布后（阶段二）：
bun add @openliri/kernel
```

```ts
// 桶入口（多数场景）
import { AppError, feature, globalEventBus, resolveDbPath } from '@openliri/kernel';

// 公开子路径（需要避免把整条求值链拉进启动面时）
import { resolveHttpPortIntent } from '@openliri/kernel/ports';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope';
```

**公开面规则**：`exports` **无通配**，逐文件列举（89 键）；白名单见 `scripts/lint-kernel-purity.ts` 的
`KERNEL_PUBLIC_SUBPATHS`（29 条）。非白名单深路径在编译期即失败——扩面必须改白名单并走评审。

## DI 容器契约（易踩点）

| 能力 | 契约 |
|---|---|
| 作用域 | `singleton` / `transient` / `request` |
| `onDispose` | **仅 `singleton` 支持**；其余作用域声明它 ⇒ 注册期抛 `DI_ONDISPOSE_REQUIRES_SINGLETON` |
| 生命周期钩子 | `onLoad` / `onReady` 只对**已实例化**的服务执行；要"注册即实例化"须显式 `eager: true` |
| 请求作用域 | 推荐 `runInRequestScope(fn)`（`AsyncLocalStorage.run`，有边界）；`beginRequest/endRequest` 已 `@deprecated`（`enterWith` 无边界，漏掉 `endRequest` 会泄漏） |
| 环检测 | 注册期**增量**检测（`detectFrom`）；失败时**回滚描述符**并抛 `DI_CYCLE_DETECTED`（`cycle` 是闭环路径） |
| 关闭 | `disposeAll` 逐条 `try/catch` 且**每条默认 5s 超时**（`DI_DISPOSE_TIMEOUT` 后继续）；多个失败聚合为 `AggregateError` |
| 自动装配 | 只接受**纯标识符**形参（`AutoWiringEngine`）；形参带修饰符/解构/默认值 ⇒ `DI_AUTOWIRE_UNRELIABLE`。打包器改形参名**不可检测** ⇒ 生产建议显式 token |

## 版本

`KERNEL_PACKAGE_VERSION`（`src/index.ts`）必须等于 `package.json.version`，由两处门禁钉住：
`bun run version:check`（仓库根 `app/`）+ `src/kernel.test.ts` 的相等断言。

## 开发命令（在本目录）

```bash
bun run typecheck   # tsc -p tsconfig.json
bun run test        # 包内测试（tests/ + src/kernel.test.ts）
bun run build       # 纯 tsc 产出 dist（桶 + 逐模块 JS/声明；**不打 bundle**）
bun run smoke       # 产物冒烟：exports 无通配 / 目标存在 / 桶与子路径同一实例
```

`prepublishOnly` = `typecheck → test → build → smoke`。构建**故意不用 bundler**：`dist/index.js`
由 tsc 产出，与子路径指向同一份模块文件，避免"桶内联副本 + 逐模块副本"导致模块级单例分裂。

## 许可

MIT，见 [LICENSE](./LICENSE)。
