# 环境配置

## 开发环境

### 推荐工具

- **编辑器**: VS Code 或 WebStorm
- **Node 版本管理**: nvm-windows（Windows）或 nvm（macOS/Linux）
- **包管理器**: Bun（推荐）或 npm/pnpm/yarn

### VS Code 推荐插件

- TypeScript + JavaScript
- ESLint
- Prettier
- Rust (native 模块开发)

### 开发配置

```bash
# 安装所有依赖（包括开发依赖）
bun install

# 运行测试
bun test

# 类型检查
npx tsc --noEmit

# 代码检查
bun run lint
```

## 生产环境

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（获取: https://platform.deepseek.com/api_keys） | - |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | DeepSeek 模型名称 | `deepseek-chat` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `PORT` | 服务端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |

### 性能调优

```bash
# 构建优化
bun run build

# 设置生产环境
NODE_ENV=production bun run start
```

## 数据库配置

Liri 使用文件系统进行数据持久化，默认存储路径：

- **会话数据**: `data/sessions/`
- **缓存数据**: `data/cache/`
- **日志文件**: `logs/`
- **OAuth 令牌**: `data/oauth-tokens.json`
