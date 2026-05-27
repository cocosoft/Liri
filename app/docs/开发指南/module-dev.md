# 模块开发规范

## 模块结构

```
src/module-name/
├── index.ts              # 模块入口
├── types.ts              # 类型定义
├── module.ts             # 核心实现
├── config.ts             # 配置定义
└── index.test.ts         # 测试
```

## 命名规范

- 目录名：kebab-case，如 `file-system`
- 文件：kebab-case，如 `user-service.ts`
- 类名：PascalCase，如 `FileSystemService`
- 导出函数：camelCase，如 `formatDate`

## 模块接口

```typescript
// index.ts - 统一导出
export type { ModuleConfig, ModuleOptions } from "./types.js";
export { ModuleName } from "./module.js";

// types.ts - 类型定义
export interface ModuleConfig { ... };
export type ModuleOptions = { ... };
```

## 依赖注入

```typescript
export class MyModule {
  constructor(
    private config: ConfigManager,
    private logger: Logger
  ) {}
}
```

## 测试要求

- 核心逻辑覆盖率 >= 80%
- 包含正常路径和异常路径测试
- 测试文件与模块文件同级
