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

## 声明能力与签名（2026-10-25）

第三方插件默认**不在主进程加载**，且必须声明 `capabilities`：

```json
{
  "capabilities": ["tools", "config"]
}
```

- 闭合集合：`tools` / `config` / `events`；`events` **尚未实现**，声明即被拒；
- 声明了但用户未授权 ⇒ 拒绝安装/加载；授权入口见 [插件市场 § 能力权限](./marketplace.md)；
- 需要来源证明时给清单签名（对 `plugin.json` 原始字节）：

```bash
cd app && bun run plugin:sign keygen --out ./keys     # 生成密钥对（私钥自己保管）
bun run plugin:sign sign --plugin ./my-plugin --key ./keys/plugin-signing.key
```

公钥（`*.pem`）放 `~/.pyapp/plugins/trusted-keys/`（自建钥）或随包官方钥目录
`<安装目录>/app/trusted-keys/`，两者是**并集**；放进任一目录即开始校验。

字段与判定细节见 [插件清单](./manifest.md)；加载闸门见 [插件概述](./overview.md)。

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
