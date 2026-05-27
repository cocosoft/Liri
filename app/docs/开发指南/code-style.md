# 代码风格

## TypeScript 风格指南

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 类名 | PascalCase | `UserService` |
| 接口 | PascalCase | `UserConfig` |
| 类型 | PascalCase | `ToolResult` |
| 函数 | camelCase | `getUserName()` |
| 变量 | camelCase | `userName` |
| 常量 | UPPER_CASE | `MAX_RETRY_COUNT` |
| 文件 | kebab-case | `user-service.ts` |

### 导入规范

```typescript
// 外部库导入
import { describe, it, expect } from "bun:test";

// 相对路径导入（使用 .js 扩展名）
import { UserService } from "./user-service.js";
import { Config } from "../config/index.js";
```

### 代码组织

```typescript
// 1. 导入语句
import { EventEmitter } from "events";

// 2. 类型定义
export type MyType = { ... };

// 3. 接口定义
export interface MyInterface { ... };

// 4. 类定义
export class MyClass { ... };

// 5. 纯函数
export function myFunction() { ... };
```

### 注释与文档

- 每个导出函数添加 JSDoc 注释
- 复杂逻辑添加行内注释
- 类和方法包含使用示例

## 错误处理

- 使用自定义 `AppError` 而非原始 `Error`
- 包含错误码和上下文信息
- 区分业务错误和系统错误
