# 开发插件

## 项目结构

```
my-plugin/
├── manifest.json          # 插件清单
├── src/
│   └── index.ts           # 插件主文件
├── assets/                # 资源文件
├── test/
│   └── index.test.ts      # 测试
├── package.json
└── tsconfig.json
```

## 快速开始

```bash
# 使用脚手架创建插件项目
npx create-py-app-plugin my-plugin
cd my-plugin
bun install
```

## manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "示例插件",
  "author": "Your Name",
  "license": "MIT",
  "entry": "dist/index.js",
  "dependencies": {
    "py-app": ">=1.0.0"
  },
  "permissions": [
    "file:read",
    "file:write"
  ],
  "hooks": {
    "onMessage": true,
    "onToolExecute": false
  }
}
```

## 构建与发布

```bash
# 构建插件
bun run build

# 打包
bun run pack

# 本地测试
/plugin install ./my-plugin-1.0.0.zip
```

## 最佳实践

- 使用 TypeScript 开发
- 编写完整的测试
- 遵循语义化版本
- 提供清晰的文档
- 最小权限原则
