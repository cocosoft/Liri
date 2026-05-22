# 常见问题

## 安装相关

### 安装依赖失败怎么办？

```bash
# 清理缓存后重试
bun run clean
bun install
```

### Bun 安装后无法使用？

确保 `~/.bun/bin` 已添加到 PATH 环境变量。

## 配置相关

### 如何修改 AI 模型？

编辑 `.env` 文件中的 `DEEPSEEK_MODEL` 配置项。

### 如何查看当前配置？

在 REPL 中输入 `/config show` 查看所有配置。

## 使用相关

### Agent 没有响应？

- 检查 AI API Key 是否配置正确
- 检查网络连接
- 查看日志文件了解详情

### 如何取消正在执行的任务？

使用 `/task cancel <id>` 命令取消任务。

### 如何清除命令历史？

```bash
# 清除历史文件
rm data/sessions/history.json
```

## 错误处理

### 遇到 "Rate limit exceeded" 怎么办？

- 减少请求频率
- 检查频率限制配置
- 等待一段时间后重试

### 遇到 "Permission denied" 怎么办？

- 检查文件路径是否在允许范围内
- 检查治理策略配置
- 联系管理员获取权限
