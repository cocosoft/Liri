# 守护进程模块 (daemon)

## 概述

后台守护进程子系统，提供进程生命周期管理、任务调度和进程间通信。

## 职责

- **ProcessManager** — 进程管理器，负责进程注册、启停、健康检查和自动重启
- **TaskQueue** — 优先级任务队列，支持取消、超时、重试和进度回调
- **IPCService** — HTTP 通信层，支持 Windows 兼容的进程间消息传递
- **DaemonService** — 跨平台系统服务管理（systemd / launchd / schtasks）

## 架构原则

- 进程崩溃自动重启（不超过 5 次/分钟）
- 优雅关闭超时 ≤ 30 秒
- 任务进度可查询（0-100%）
- 后台任务通过 AbortController 支持取消

## 依赖

- core, monitoring
- 可选: chronos（定时任务集成）

## 服务部署（系统自启服务）

支持将 Liri 后端安装为 **系统自启服务**，开机自动运行，崩溃自动重启。

### 三平台支持

| 平台 | 底层机制 | 自动启停 | 开机自启 |
|------|---------|---------|---------|
| **Windows** | `schtasks` 任务计划程序 | ✅ | ✅（BootTrigger） |
| **macOS** | `launchd` LaunchAgent | ✅ | ✅（RunAtLoad + KeepAlive） |
| **Linux** | `systemd` service unit | ✅ | ✅（WantedBy=multi-user.target） |

### 快速使用

```bash
# 1. 先编译成独立的二进制文件
bun run build:win          # Windows
bun run build:mac          # macOS
bun run build:linux        # Linux

# 2. 安装为系统服务
bun run service:install

# 3. 管理服务
bun run service:status     # 查看运行状态
bun run service:start      # 手动启动
bun run service:stop       # 手动停止
bun run service:restart    # 重启
bun run service:uninstall  # 卸载服务
```

### 开发模式（无需编译）

```bash
# 直接使用 bun run 运行，适合开发和测试
bun run service:dev
```

### 编程方式使用

```typescript
import { DaemonService } from '@modules/daemon/service';

const service = new DaemonService({
  name: 'liri-backend',
  displayName: 'Liri Backend Service',
  description: 'Liri AI 后端守护进程 — 跨平台 AI 助手服务',
  execPath: '/path/to/bun',
  args: ['run', 'src/main.ts', 'daemon'],
  workingDir: '/path/to/app',
  envVars: {
    LIRI_SERVICE_MODE: '1',
  },
});

// 安装并启动
service.execute('install');
service.execute('start');

// 查看状态
const status = service.getStatus();
console.log(`运行中: ${status.running}`);
```

### DaemonService API

| 方法 | 说明 |
|------|------|
| `execute(action)` | 执行服务操作：install / uninstall / start / stop / restart / status |
| `executeWithChronos(action)` | 执行服务操作并同步管理 Chronos 调度器生命周期 |
| `getStatus()` | 获取服务状态（running、pid、uptime 等） |
| `registerChronosScheduler(scheduler)` | 注册 Chronos 调度器（可选集成） |
