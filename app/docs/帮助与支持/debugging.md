# 调试指南

## 调试模式

### 启用调试日志

```bash
# 设置日志级别为 debug
/config set LOG_LEVEL debug
```

### REPL 调试命令

```bash
# 查看系统状态
/status

# 查看内存使用
/memory

# 查看模块状态
/modules
```

## 日志分析

### 日志文件位置

```bash
# 主日志
logs/app.log

# 审计日志
logs/audit.log

# 错误日志
logs/error.log
```

### 查看日志

```bash
# 查看实时日志
tail -f logs/app.log

# 搜索错误
grep "ERROR" logs/app.log

# 查看最近的日志
tail -n 100 logs/app.log
```

## 性能调试

```typescript
// 在代码中添加性能标记
console.time("task-execution");

// 执行任务
await executeTask();

console.timeEnd("task-execution");
```

## 网络调试

```bash
# 检查 API 连接
curl -v https://api.openai.com/v1/models

# 测试延迟
ping api.openai.com
```

## 常见调试场景

### Agent 行为异常

1. 检查 AI 模型配置
2. 查看 Agent 日志
3. 检查工具调用记录

### 工具执行失败

1. 验证工具参数
2. 检查权限配置
3. 查看工具执行日志
