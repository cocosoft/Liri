# 开始开发

## 环境要求

- **Bun**: >= 1.0
- **Node.js**: >= 20（备选）
- **TypeScript**: >= 5.0
- **VS Code**: 推荐编辑器

## 初始化

```bash
# 克隆项目
git clone <repo-url>
cd PY_APP/backend

# 安装依赖
bun install
```

## 开发命令

```bash
# 开发模式（热重载）
bun run dev

# 类型检查
npx tsc --noEmit

# 运行测试
bun test

# 构建
bun run build

# 代码检查
bun run lint
```

## 调试

### VS Code 调试配置

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "bun",
      "request": "launch",
      "name": "Debug Bun",
      "program": "src/index.ts",
      "cwd": "${workspaceFolder}/backend"
    }
  ]
}
```

## 工作流程

1. Fork 仓库并创建特性分支
2. 安装依赖并启动开发模式
3. 编写代码和测试
4. 运行测试确保通过
5. 提交 Pull Request

## 模块结构

开发新模块时参考以下结构：

```
src/module-name/
├── index.ts          # 模块入口（导出 public API）
├── types.ts          # 类型定义
├── implementation.ts # 实现
└── index.test.ts     # 测试
```
