# Flow Engine - 流程引擎

## 概述

Flow Engine 提供特定业务流程的编排能力，位于 `core/flows/`，目前包含渠道设置、诊断健康检查、模型选择、提供商流程等预定义流程。

## 现有流程

| 流程 | 文件 | 说明 |
|------|------|------|
| Channel Setup | channel-setup.ts | 消息渠道初始化与配置流程 |
| Doctor Health | doctor-health.ts | 系统健康诊断流程 |
| Model Picker | model-picker.ts | AI 模型选择与切换流程 |
| Provider Flow | provider-flow.ts | AI 提供商配置与切换流程 |

### 渠道设置流程

```typescript
import { channelSetupFlow } from "./core/flows/channel-setup.js";

// 执行渠道初始化配置
await channelSetupFlow({
  channels: ["discord", "slack", "telegram"],
  autoReconnect: true
});
```

### 健康诊断流程

```typescript
import { doctorHealthFlow } from "./core/flows/doctor-health.js";

const result = await doctorHealthFlow();
console.log("系统健康状态:", result.status);
// { status: "healthy", services: [...], issues: [] }
```

### 模型选择流程

```typescript
import { modelPickerFlow } from "./core/flows/model-picker.js";

const model = await modelPickerFlow({
  task: "code_generation",
  preferSpeed: true
});
```

## 扩展流程

可通过 `core/flows/types.ts` 中的类型定义，创建自定义流程并注册到流程管理中心。
