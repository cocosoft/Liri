# QQ 通道故障分析报告

## 🔴 故障根因:源码未编译

**TS 源码与编译后的 JS 严重不一致,导致运行的是过时的旧代码。**

### 数据对比

| 文件 | 大小 | 修改时间 | 功能版本 |
|------|------|---------|---------|
| `src/channels/qq/QQChannel.ts` | **50,599 bytes** | **2026-06-17** | ✅ 完整版 (WebSocket + OAuth + 路由) |
| `dist/channels/qq/QQChannel.js` | **6,514 bytes** | **2026-05-24** | ❌ 精简版 (只有 HTTP API) |

### 功能差异明细

| 功能点 | 编译后的 JS(正在运行) | 源码 TS(未编译) |
|--------|----------------------|------------------|
| **WebSocket 入站** | ❌ **无** | ✅ 完整实现(心跳/重连/鉴权) |
| **消息接收** | ❌ 无法接收消息 | ✅ C2C/群聊/频道私信 |
| **Access Token 管理** | ❌ 用固定的 token | ✅ OAuth Client Credentials 自动刷新 |
| **Auth Header** | `Bot {appId}.{token}` | `QQBot {accessToken}` |
| **目标路由** | 简陋的 URL 拼接 | ✅ `parseTarget` + 分层路由 |
| **健康检查** | 简陋,latencyMs 经常=0 | ✅ 调用 gateway 验证 |
| **重连机制** | ❌ **无** | ✅ 指数退避 + 关闭码分析 |
| **消息去重** | ❌ **无** | ✅ 三级去重(ID/事件/内容) |

### 为什么你收不到回复

```
你给QQ发消息
    ↓
过时的 QQChannel.js (无 WebSocket)
    ↓
❌ 收不到消息 → 无法触发回复

尝试用广播回复
    ↓
过时的 QQChannel.js (旧 Auth + 旧 API)
    ↓
❌ sendTextMessage 失败 → sent: false
```

### 故障表现解释

| 症状 | 原因 |
|------|------|
| `status: connected = true` | 插件初始化成功,读到了配置 |
| `latencyMs: 0` | 健康检查 HTTP 请求异常,catch 后返回假状态 |
| `broadcast → sent: false` | sendTextMessage 中 HTTP 请求失败(token 过期或格式不对) |
| 日志为空 | 过时的 JS 实现没有写日志的功能 |

## 🔧 修复方案

### 方案 A(推荐):重新编译 TypeScript

```bash
cd app
npx tsc --build tsconfig.json
```

或更精确地:

```bash
npx tsc src/channels/qq/QQChannel.ts --outDir dist/channels/qq --module esnext --target es2022
```

### 方案 B(验证):检查编译是否成功

编译后对比:

```bash
# 确认新编译的 JS 包含 WebSocket 相关代码
grep -n "WebSocket\|handleGatewayPayload\|connectWebSocket\|heartbeat" dist/channels/qq/QQChannel.js
```

### 方案 C(快速检查):确认版本差异

```bash
#确认 JS 是否已更新
wmic datafile where "name='E:\\PY\\CODES\\PY_APP\\app\\dist\\channels\\qq\\QQChannel.js'" get lastmodified,size
```

### 排查 checklist(IDE 修复用)

1. 检查 `tsconfig.json` 配置正确,`src/channels/qq/QQChannel.ts` 是否在 `include` 列表中
2. 运行 `npx tsc --noEmit` 检查 TS 有无编译错误
3. 重新编译后重启应用
4. 验证 `dist/channels/qq/QQChannel.js` 的大小是否从 **6.5KB → ~50KB**
5. 在 `dist/channels/qq/QQChannel.js` 中搜索 `WebSocket`、`connectWebSocket`、`heartbeat` 确认新代码已生效
