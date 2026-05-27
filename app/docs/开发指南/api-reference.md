# API 参考

## 模块接口

### Agent API

```typescript
// 创建 Agent
const agent = new Agent(config: AgentConfig);

// 发送消息
const response = await agent.chat(message: string);

// 流式聊天
const stream = agent.chatStream(message: string);

// 注册工具
agent.registerTool(tool: Tool);
```

### Task API

```typescript
// 创建任务
const task = await taskManager.createTask(config: TaskConfig);

// 启动任务
await taskManager.startTask(taskId: string);

// 监控进度
task.on("progress", handler: (percent: number) => void);
```

### Config API

```typescript
// 获取配置
config.get<T>(key: string, defaultValue?: T): T;

// 设置配置
config.set(key: string, value: unknown): void;

// 监听变更
config.on("change", handler: (key, newValue, oldValue) => void);
```

## 工具接口

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  execute(params: unknown): Promise<ToolResult>;
}
```

## 事件接口

```typescript
// 监听事件
eventBus.on(event: string, handler: (data) => void);

// 发布事件
eventBus.emit(event: string, data: unknown);

// 一次性监听
eventBus.once(event: string, handler: (data) => void);
```
