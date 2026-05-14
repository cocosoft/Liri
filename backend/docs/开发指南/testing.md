# 测试指南

## 测试框架

PY_APP 使用 Bun 内置的 `bun:test` 作为测试框架。

## 测试结构

```
src/
├── module/
│   ├── index.ts
│   └── index.test.ts       # 单元测试
testing/                     # 集成测试
├── integration.test.ts
```

## 编写测试

```typescript
import { describe, it, expect } from "bun:test";
import { MyModule } from "./index.js";

describe("MyModule", () => {
  it("should return correct result", () => {
    const module = new MyModule();
    const result = module.doSomething();
    expect(result).toBe("expected");
  });

  it("should handle errors gracefully", () => {
    const module = new MyModule();
    expect(() => module.doSomethingBad()).toThrow();
  });
});
```

## 运行测试

```bash
# 运行所有测试
bun test

# 运行特定测试文件
bun test src/core/i18n/i18n.test.ts

# 运行匹配模式的测试
bun test --filter "i18n"

# 带覆盖率报告
bun test --coverage
```

## 测试策略

- **单元测试**: 测试独立模块功能
- **集成测试**: 测试模块间交互
- **端到端测试**: 测试完整工作流

## 类型检查

在提交前运行类型检查：

```bash
npx tsc --noEmit
```
