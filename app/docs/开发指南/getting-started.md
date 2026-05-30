# 开始开发

## 环境要求

- **Bun** ≥ 1.1 (JavaScript 运行时，用于 TypeScript 直接执行)
- **Node.js** ≥ 22（可选，Bun 兼容）
- **VS Code** 推荐编辑器

## 初始化

```bash
git clone https://github.com/cocosoft/Liri.git
cd Liri/backend
bun install
```

## 配置

```bash
mkdir -p ~/.pyapp
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
export DEEPSEEK_API_KEY="sk-..."
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `bun start` | 启动 REPL |
| `bun run dev` | 开发模式（文件变更自动重启） |
| `bun run typecheck` | TypeScript 类型检查 (`tsc --noEmit`) |
| `bun test` | 运行全部测试 |
| `bun run lint:fix` | ESLint 自动修复 |
| `bun run build` | 生产构建 |

## 调试 (VS Code)

```json
{
  "version": "0.2.0",
  "configurations": [{
    "type": "bun",
    "request": "launch",
    "name": "Debug Bun",
    "program": "src/main.ts",
    "cwd": "${workspaceFolder}/backend"
  }]
}
```

## 工作流程

1. Fork 仓库并创建特性分支 `feature/xxx`
2. 安装依赖并启动开发模式
3. 编写代码和测试
4. `bun run typecheck` + `bun run lint:fix` + `bun test`
5. 提交 Pull Request

## 项目约定

- **扩展名**: 所有 TypeScript 源文件使用 `.ts`
- **Barrel 导出**: 每个模块目录有 `index.ts` 统一导出
- **测试文件**: 放在 `__tests__/` 下，以 `.test.ts` 结尾
- **导入别名**: `@modules/` 映射到 `src/` 根
- **代码风格**: 遵循 `prettier` + `eslint` 规则
