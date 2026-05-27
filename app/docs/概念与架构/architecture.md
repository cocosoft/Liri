# 系统架构

## 整体架构

```mermaid
graph TB
    subgraph 用户界面层
        CLI[CLI]
        REPL[REPL]
        ChannelAdapter[渠道适配器]
    end
    
    subgraph 应用核心层
        AppCore[AppCore]
        Coordinator[Coordinator]
        EventBus[EventBus]
        DI[DI 容器]
        Config[配置管理]
        SessionManager[会话管理]
    end
    
    subgraph AI 服务层
        AI[AI 服务]
        Agent[Agent 系统]
        TaskSystem[任务系统]
    end
    
    subgraph 工具层
        FileTools[文件工具]
        NetTools[网络工具]
        MediaTools[媒体工具]
        CodeTools[代码工具]
        SystemTools[系统工具]
        MCPTools[MCP 工具]
    end
    
    CLI --> AppCore
    REPL --> AppCore
    ChannelAdapter --> AppCore
    
    AppCore --> Coordinator
    AppCore --> EventBus
    AppCore --> DI
    AppCore --> Config
    AppCore --> SessionManager
    
    Coordinator --> AI
    Coordinator --> Agent
    Coordinator --> TaskSystem
    
    AI --> FileTools
    AI --> NetTools
    AI --> MediaTools
    Agent --> CodeTools
    Agent --> SystemTools
    Agent --> MCPTools
```

## 架构原则

### 模块化

所有功能以模块形式组织，通过依赖注入容器管理：

- 模块间通过接口通信
- 依赖显式声明
- 支持模块热替换

### 事件驱动

使用事件总线进行模块间通信：

- 解耦消息发送者和接收者
- 支持异步处理
- 可扩展的监听器链

### 安全优先

多层次安全控制：

- 治理策略控制工具权限
- 沙箱隔离执行环境
- 审计日志记录所有操作
- 内容安全过滤

## 数据流

```mermaid
sequenceDiagram
    participant User as 用户
    participant Channel as 渠道适配器
    participant Gateway as 网关
    participant Coord as Coordinator
    participant Agent as Agent
    participant Tools as 工具系统
    
    User->>Channel: 用户输入
    Channel->>Gateway: 转发请求
    Gateway->>Coord: 分发处理
    Coord->>Agent: 调用 Agent
    Agent->>Tools: 选择并执行工具
    Tools-->>Agent: 返回结果
    Agent-->>Coord: 整合响应
    Coord-->>Gateway: 返回处理结果
    Gateway-->>Channel: 包装响应
    Channel-->>User: 展示给用户
```


