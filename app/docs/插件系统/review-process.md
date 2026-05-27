# 插件评审机制

本文档定义插件的评审标准与流程，确保所有插件符合微内核架构规范。

## 评审流程

每一个新插件或插件更新需经过以下阶段：

1. **自检（Self-Check）** — 开发者对照评审标准逐项自检
2. **代码审查（Code Review）** — 至少一名审阅者检查代码
3. **契约测试（Contract Test）** — 运行标准契约测试套件
4. **集成测试（Integration Test）** — 在完整系统中验证插件的加载和卸载
5. **合并（Merge）** — 通过上述所有阶段后方可合并

## 评审标准

### 1. 接口合规

| 检查项 | 要求 |
|--------|------|
| Plugin 接口 | 实现 `status`、`metadata`、`isEnabled`、`setAPI()`、`getAPI()`、`initialize()`、`activate()`、`deactivate()`、`dispose()` |
| PluginMetadata | 包含完整的 `id`、`name`、`version`、`description`、`dependencies` |
| IPluginAPI 使用 | 通过 `setAPI()` 注入 API，通过 `getAPI()` 访问，禁止直接 import 内核模块 |
| 入口函数 | 导出 `create<Name>Plugin()` 工厂函数 |

### 2. 生命周期正确性

- `initialize()` — 初始化内部状态，不注册命令或工具
- `activate()` — 通过 `this._api.commands.registerCommand()` / `this._api.tools.registerTool()` 注册功能
- `deactivate()` — 清理注册的命令和工具
- `dispose()` — 释放所有资源，将 `_api` 设为 `null`

### 3. 测试覆盖

- 必须包含契约测试，覆盖：元数据、生命周期、IPluginAPI 集成、基本功能
- 契约测试遵循 `BuddyPlugin.test.ts` 的四段式结构
- 所有测试必须通过

### 4. 依赖管理

- `metadata.dependencies` 中声明所有依赖
- 禁止循环依赖
- 使用 `KernelServiceRegistry` 获取内核服务，而非直接 import

### 5. 注册规范

- 在 `BundledPluginManager.ts` 的 `scan()` 方法中注册
- 在 `bundled/index.ts` 中导出
- `entryPoint` 指向 `bundled/<PluginName>.js`

## 自检清单

合并前开发者应逐项确认：

- [ ] 实现了完整的 Plugin 接口
- [ ] 导出了 `create<Name>Plugin()` 工厂函数
- [ ] 导出了 `<Name>PluginMetadata` 常量
- [ ] 契约测试全部通过
- [ ] 在 `BundledPluginManager.ts` 中注册
- [ ] 在 `bundled/index.ts` 中导出
- [ ] 无直接 import 内核模块（使用 IPluginAPI 代理）
- [ ] 遵循生命周期规范（initialize/activate/deactivate/dispose）
