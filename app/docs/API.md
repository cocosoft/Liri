# API 文档

## 概述

Liri 提供了以下核心模块的 API：

- [AI 模块](#ai-模块)
- [聊天模块](#聊天模块)
- [代理模块](#代理模块)
- [任务模块](#任务模块)
- [工具模块](#工具模块)
- [配置模块](#配置模块)
- [技能系统](#技能系统)
- [远程功能](#远程功能)
- [安全性增强](#安全性增强)
- [性能优化](#性能优化)
- [监控系统](#监控系统)
- [缓存系统](#缓存系统)
- [文档版本系统](#文档版本系统)
- [远程任务调度系统](#远程任务调度系统)
- [分析系统](#分析系统)
- [工具系统](#工具系统)
- [工具函数库](#工具函数库)
- [用户界面优化](#用户界面优化)
- [伙伴系统](#伙伴系统)
- [查询引擎](#查询引擎)

## AI 模块

### 导入

```typescript
import aiService, { AIService, AIModelType, AIMessage, AIResponse } from './src/ai';
```

### 配置

```typescript
// 更新配置
aiService.updateConfig({
  defaultModel: 'your-model-id',
  apiKey: 'your_api_key',
  timeout: 30000
});

// 获取配置
const config = aiService.getConfig();
```

### 生成响应

```typescript
// 基本用法
const response = await aiService.generate([
  { role: 'user', content: 'Hello, how are you?' }
]);
console.log(response.content);

// 自定义模型和参数
const response = await aiService.generate(
  [{ role: 'user', content: 'Write a poem about AI' }],
  'your-model-id',
  {
    temperature: 0.7,
    max_tokens: 500
  }
);
```

### 流式响应

```typescript
// 流式生成
const stream = aiService.stream([
  { role: 'user', content: 'Write a story about a robot' }
]);

for await (const chunk of stream) {
  process.stdout.write(chunk.content);
}
```

## 聊天模块

### 导入

```typescript
import { chatService, ChatSession, ChatMessage } from './src/chat';
```

### 创建会话

```typescript
const session = chatService.createSession({
  name: 'My Chat',
  model: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 1000,
  systemPrompt: '你是一个有用的助手。',
  historyLimit: 100,
  autoSave: true
});
```

### 发送消息

```typescript
// 基本发送
const response = await session.sendMessage('你好，你是谁？');
console.log(response.message.content);

// 流式发送
const stream = session.streamMessage('写一首关于AI的诗');

for await (const chunk of stream) {
  process.stdout.write(chunk.message.content);
}
```

### 管理会话

```typescript
// 列出所有会话
const sessions = chatService.listSessions();

// 获取会话
const session = chatService.getSession(sessionId);

// 更新会话
const updatedSession = chatService.updateSession(sessionId, {
  name: 'Updated Chat',
  model: 'gpt-4'
});

// 删除会话
const success = chatService.deleteSession(sessionId);
```

## 代理模块

### 导入

```typescript
import { agentService, AIAgent, AgentTask } from './src/agent';
```

### 创建代理

```typescript
const agent = agentService.createAgent({
  name: 'My Agent',
  model: 'gpt-3.5-turbo',
  defaultStrategy: 'tool_use',
  memoryPath: './agent_memory',
  tools: ['file_read', 'file_write', 'command']
});
```

### 执行任务

```typescript
const task: AgentTask = {
  id: 'task-1',
  name: 'Read File',
  description: 'Read the content of package.json',
  input: { path: 'package.json' }
};

// 执行任务
const response = await agent.execute(task);
console.log(response.content);

// 流式执行
const stream = agent.stream(task);

for await (const chunk of stream) {
  console.log(chunk.content);
}
```

### 管理代理

```typescript
// 列出所有代理
const agents = agentService.listAgents();

// 获取代理
const agent = agentService.getAgent(agentId);

// 更新代理
const updatedAgent = agentService.updateAgent(agentId, {
  name: 'Updated Agent',
  model: 'gpt-4'
});

// 删除代理
const success = agentService.deleteAgent(agentId);
```

## 任务模块

### 导入

```typescript
import { taskService, TaskType, TaskPriority, TaskStatus } from './src/task';
```

### 创建任务

```typescript
const task = await taskService.createTask({
  name: 'Generate Report',
  description: 'Generate a sales report',
  type: TaskType.AI_GENERATION,
  priority: TaskPriority.HIGH,
  input: { data: 'sales_data.json' },
  metadata: { project: 'sales' }
});
```

### 管理任务

```typescript
// 开始任务
await taskService.startTask(task.id);

// 完成任务
await taskService.completeTask(task.id, { report: 'report.pdf' });

// 失败任务
await taskService.failTask(task.id, 'Failed to generate report');

// 取消任务
await taskService.cancelTask(task.id);

// 更新任务
await taskService.updateTask(task.id, {
  name: 'Updated Task',
  priority: TaskPriority.MEDIUM
});

// 删除任务
await taskService.deleteTask(task.id);
```

### 查询任务

```typescript
// 列出任务
const tasks = await taskService.listTasks({
  status: TaskStatus.IN_PROGRESS,
  priority: TaskPriority.HIGH,
  type: TaskType.AI_GENERATION,
  limit: 10,
  offset: 0,
  sortBy: 'createdAt',
  sortOrder: 'desc'
});

// 计算任务数量
const count = await taskService.countTasks({
  status: TaskStatus.COMPLETED
});
```

## 工具模块

### 导入

```typescript
import { toolManager, executeTool, registerTool } from './src/tools';
```

### 执行工具

```typescript
// 执行文件读取工具
const result = await executeTool('file_read', {
  path: 'package.json'
}, {});

// 执行文件写入工具
const result = await executeTool('file_write', {
  path: 'output.txt',
  content: 'Hello, World!',
  overwrite: true
}, {});

// 执行命令工具
const result = await executeTool('bash', {
  command: 'ls -la'
}, {});
```

### 管理工具

```typescript
// 获取工具
const tool = toolManager.getTool('file_read');

// 获取所有工具
const tools = toolManager.getAllTools();

// 注册自定义工具
registerTool({
  name: 'custom_tool',
  description: 'Custom tool',
  params: [
    { name: 'param1', type: 'string', description: 'Parameter 1', required: true }
  ],
  execute: async (input, context) => {
    return { result: 'Custom tool executed' };
  }
});
```

## 配置模块

### 导入

```typescript
import { configManager, getConfig, getConfigValue, setConfigValue, updateConfig } from './src/config';
```

### 使用配置

```typescript
// 获取配置
const config = getConfig();

// 获取配置项
const defaultModel = getConfigValue<string>('ai.defaultModel');

// 设置配置项
setConfigValue('ai.defaultModel', 'gpt-4');

// 更新配置
updateConfig({
  ai: {
    defaultModel: 'gpt-4',
    timeout: 60000
  },
  chat: {
    autoSave: true
  }
});
```

## 工具函数

### 缓存工具

```typescript
import { cache, cached } from './src/utils/cache';

// 设置缓存
cache.set('key', 'value', 3600000); // 1小时过期

// 获取缓存
const value = cache.get('key');

// 使用缓存装饰器
class Example {
  @cached(3600000)
  async fetchData(id: string) {
    // 从API获取数据
    return { id, data: '...' };
  }
}
```

### 错误处理工具

```typescript
import { AppError, ErrorType, handleError, catchAsync } from './src/utils/errorHandler';

// 抛出错误
throw new AppError(ErrorType.VALIDATION, 'Invalid input');

// 处理错误
try {
  // 执行操作
} catch (error) {
  const handledError = handleError(error);
  console.error(handledError.message);
}

// 使用catchAsync装饰器
const safeFunction = catchAsync(async (id: string) => {
  // 执行异步操作
  return { id, data: '...' };
});

const result = await safeFunction('123');
```

### 监控工具

```typescript
import { logger, monitor, time } from './src/utils/monitoring';

// 记录日志
logger.info('Application started');
logger.error('An error occurred', { error: 'Details' });

// 记录执行时间
const result = await time('fetch_data', async () => {
  // 执行操作
  return { data: '...' };
});

// 健康检查
const healthStatus = monitor.healthCheck();
console.log(healthStatus);
```

## 示例

### 完整示例

```typescript
import { aiService, chatService, agentService, taskService } from './src';
import { AIModelType, TaskType, TaskPriority } from './src';

// 1. 使用AI服务
const aiResponse = await aiService.generate([
  { role: 'user', content: 'Hello, how are you?' }
]);
console.log('AI Response:', aiResponse.content);

// 2. 使用聊天服务
const session = chatService.createSession({
  name: 'My Chat',
  model: AIModelType.GPT_3_5_TURBO
});

const chatResponse = await session.sendMessage('Write a poem about AI');
console.log('Chat Response:', chatResponse.message.content);

// 3. 使用代理服务
const agent = agentService.createAgent({
  name: 'My Agent',
  defaultStrategy: 'tool_use'
});

const agentTask = {
  id: 'task-1',
  name: 'Read File',
  description: 'Read the content of package.json',
  input: { path: 'package.json' }
};

const agentResponse = await agent.execute(agentTask);
console.log('Agent Response:', agentResponse.content);

// 4. 使用任务服务
const task = await taskService.createTask({
  name: 'Generate Report',
  description: 'Generate a sales report',
  type: TaskType.AI_GENERATION,
  priority: TaskPriority.HIGH
});

await taskService.startTask(task.id);
// 执行任务...
await taskService.completeTask(task.id, { report: 'report.pdf' });

console.log('Task completed successfully');
```

## 技能系统

### 导入

```typescript
import { getSkillManager, getSkillLoader, getSkillRegistry, getSkillExecutor } from './src/skills';
import type { Skill, SkillMetadata, SkillContext, SkillResult } from './src/skills';
```

### 技能管理器

```typescript
// 获取技能管理器
const skillManager = getSkillManager();

// 加载技能
await skillManager.loadSkills('./skills');

// 执行技能
const result = await skillManager.execute('math.add', { a: 1, b: 2 });
console.log('Skill result:', result);

// 列出所有技能
const skills = skillManager.listSkills();
console.log('Available skills:', skills);

// 检查技能是否存在
const exists = skillManager.hasSkill('math.add');
console.log('Skill exists:', exists);

// 清除所有技能
await skillManager.clearSkills();
```

### 技能加载器

```typescript
// 获取技能加载器
const skillLoader = getSkillLoader();

// 从目录加载技能
const skills = await skillLoader.loadAll('./skills');
console.log('Loaded skills:', skills);

// 从文件加载单个技能
const skill = await skillLoader.load('./skills/math.js');
console.log('Loaded skill:', skill?.metadata.name);

// 验证技能
const validation = skillLoader.validateSkill(skill);
console.log('Skill validation:', validation);
```

### 技能注册表

```typescript
// 获取技能注册表
const skillRegistry = getSkillRegistry();

// 注册技能
await skillRegistry.register(skill);

// 注销技能
skillRegistry.unregister('math.add');

// 获取技能
const skill = skillRegistry.get('math.add');

// 按类别查询技能
const mathSkills = skillRegistry.getByCategory('math');

// 按标签查询技能
const taggedSkills = skillRegistry.getByTag('calculation');

// 搜索技能
const searchResults = skillRegistry.search('add');
```

### 技能执行器

```typescript
// 获取技能执行器
const skillExecutor = getSkillExecutor();

// 执行技能
const result = await skillExecutor.execute('math.add', { a: 1, b: 2 });
console.log('Skill result:', result);

// 批量执行技能
const results = await skillExecutor.executeBatch([
  { name: 'math.add', input: { a: 1, b: 2 } },
  { name: 'math.subtract', input: { a: 5, b: 3 } }
]);
console.log('Batch results:', results);

// 并行执行技能
const parallelResults = await skillExecutor.executeParallel([
  { name: 'math.add', input: { a: 1, b: 2 } },
  { name: 'math.multiply', input: { a: 3, b: 4 } }
]);
console.log('Parallel results:', parallelResults);

// 执行带上下文的技能
const context: SkillContext = {
  userId: 'user123',
  sessionId: 'session456',
  timestamp: Date.now()
};
const resultWithContext = await skillExecutor.execute('math.add', { a: 1, b: 2 }, context);
console.log('Result with context:', resultWithContext);
```

## 远程功能

### 导入

```typescript
import { getSSHConnection, getDirectConnectManager, getRemoteSessionManager } from './src/remote';
import type { SSHConfig, DirectConnectConfig, RemoteSessionConfig, RemoteMessage } from './src/remote';
```

### SSH连接

```typescript
// 创建SSH连接
const sshConfig: SSHConfig = {
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'password', // 或使用privateKey
  privateKey: '/path/to/key.pem'
};

const sshConnection = getSSHConnection(sshConfig);

// 连接
await sshConnection.connect();

// 执行命令
const result = await sshConnection.execute('ls -la');
console.log('Command result:', result);

// 断开连接
await sshConnection.disconnect();

// 获取连接状态
const status = sshConnection.getStatus();
console.log('Connection status:', status);
```

### 直接连接管理

```typescript
// 获取直接连接管理器
const directConnectManager = getDirectConnectManager();

// 启动服务器
await directConnectManager.startServer(8080);

// 连接到远程服务器
const connection = await directConnectManager.connect('cc://example.com:8080');

// 发送消息
const response = await directConnectManager.sendMessage(connection.id, { type: 'ping' });
console.log('Response:', response);

// 断开连接
await directConnectManager.disconnect(connection.id);

// 停止服务器
await directConnectManager.stopServer();

// 获取连接配置
const config = directConnectManager.getConfig();
console.log('Direct connect config:', config);
```

### 远程会话管理

```typescript
// 获取远程会话管理器
const sessionConfig: RemoteSessionConfig = {
  timeout: 30000,
  reconnect: true,
  maxRetries: 3
};

const sessionManager = getRemoteSessionManager(sessionConfig, {
  onConnect: (sessionId) => console.log(`Session ${sessionId} connected`),
  onDisconnect: (sessionId) => console.log(`Session ${sessionId} disconnected`),
  onMessage: (sessionId, message) => console.log(`Message from ${sessionId}:`, message),
  onError: (sessionId, error) => console.error(`Error in ${sessionId}:`, error)
});

// 创建SSH会话
const sshSession = await sessionManager.createSession('ssh', {
  host: 'example.com',
  port: 22,
  username: 'user',
  password: 'password'
});

// 创建直接连接会话
const directSession = await sessionManager.createSession('direct', {
  url: 'cc://example.com:8080'
});

// 发送消息
await sessionManager.sendMessage(sshSession.id, { type: 'exec', command: 'ls -la' });

// 接收消息
const messages = sessionManager.getMessages(sshSession.id);
console.log('Messages:', messages);

// 关闭会话
await sessionManager.closeSession(sshSession.id);

// 列出所有会话
const sessions = sessionManager.listSessions();
console.log('Sessions:', sessions);
```

## 安全性增强

### 导入

```typescript
import { getSandboxManager, getPermissionManager, getSecurityAudit } from './src/security';
import type { SandboxConfig, Permission, SecurityEvent } from './src/security';
```

### 沙箱管理

```typescript
// 获取沙箱管理器
const sandboxManager = getSandboxManager();

// 创建沙箱
const sandbox = await sandboxManager.createSandbox({
  name: 'safe-sandbox',
  allowedModules: ['fs', 'path'],
  memoryLimit: 1024 * 1024 * 100, // 100MB
  cpuLimit: 0.5, // 50%
  timeout: 5000 // 5秒
});

// 执行代码
const result = await sandboxManager.executeInSandbox(sandbox.id, `
  const fs = require('fs');
  return fs.readFileSync('package.json', 'utf8');
`);
console.log('Execution result:', result);

// 销毁沙箱
await sandboxManager.destroySandbox(sandbox.id);

// 列出所有沙箱
const sandboxes = sandboxManager.listSandboxes();
console.log('Sandboxes:', sandboxes);
```

### 权限管理

```typescript
// 获取权限管理器
const permissionManager = getPermissionManager();

// 检查权限
const hasPermission = permissionManager.hasPermission('user123', 'tool.file_read');
console.log('Has permission:', hasPermission);

// 授予权限
await permissionManager.grantPermission('user123', 'tool.file_read');

// 撤销权限
await permissionManager.revokePermission('user123', 'tool.file_write');

// 获取用户权限
const userPermissions = permissionManager.getUserPermissions('user123');
console.log('User permissions:', userPermissions);

// 检查工具权限
const canUseTool = permissionManager.canUseTool('user123', 'file_read');
console.log('Can use tool:', canUseTool);
```

### 安全审计

```typescript
// 获取安全审计
const securityAudit = getSecurityAudit();

// 记录安全事件
securityAudit.logEvent({
  type: 'auth',
  action: 'login',
  userId: 'user123',
  resource: 'system',
  details: { success: true, ip: '192.168.1.1' },
  severity: 'info'
});

// 获取审计日志
const logs = securityAudit.getLogs({
  type: 'auth',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endDate: new Date(),
  limit: 100
});
console.log('Audit logs:', logs);

// 分析安全事件
const analysis = securityAudit.analyzeEvents();
console.log('Security analysis:', analysis);

// 导出审计日志
const exportPath = await securityAudit.exportLogs('./audit-logs.json');
console.log('Logs exported to:', exportPath);
```

## 性能优化

### 导入

```typescript
import { getPerformanceOptimizer, getPerformanceProfiler, getMemoryManager, getMemoryCache } from './src/core/utils/Performance';
import type { PerformanceEvent, MemoryCacheConfig, PerformanceStats } from './src/core/utils/Performance';
```

### 性能优化器

```typescript
// 获取性能优化器
const performanceOptimizer = getPerformanceOptimizer();

// 优化启动性能
await performanceOptimizer.optimizeStartup();

// 优化运行性能
performanceOptimizer.optimizeRuntime();

// 记录操作时间
const stats = performanceOptimizer.recordOperation('database.query', async () => {
  // 执行数据库查询
  return { data: '...' };
});
console.log('Operation stats:', stats);

// 获取缓存大小
const cacheSize = performanceOptimizer.getCacheSize();
console.log('Cache size:', cacheSize);

// 清理过期缓存
await performanceOptimizer.cleanupExpiredCache();
```

### 性能分析器

```typescript
// 获取性能分析器
const profiler = getPerformanceProfiler();

// 开始记录
profiler.start('database.query');

// 执行操作
// ...

// 结束记录
profiler.end('database.query');

// 记录事件
profiler.record('api.call', 150, { endpoint: '/users' });

// 获取报告
const report = profiler.getReport();
console.log('Performance report:', report);

// 导出报告
await profiler.exportReport('./performance-report.json');
```

### 内存管理器

```typescript
// 获取内存管理器
const memoryManager = getMemoryManager();

// 获取当前内存使用情况
const usage = memoryManager.getCurrentUsage();
console.log('Memory usage:', usage);

// 格式化内存使用情况
const formatted = memoryManager.formatUsage(usage);
console.log('Formatted usage:', formatted);

// 开始内存监控
memoryManager.startMonitoring(1000); // 每1秒监控一次

// 停止内存监控
memoryManager.stopMonitoring();

// 优化内存使用
await memoryManager.optimize();

// 获取内存趋势
const trends = memoryManager.getTrends();
console.log('Memory trends:', trends);
```

### 内存缓存

```typescript
// 创建内存缓存
const cache = getMemoryCache({
  maxSize: 100,
  ttl: 3600000, // 1小时
  cleanupInterval: 60000 // 1分钟
});

// 设置缓存
cache.set('key1', 'value1');
cache.set('key2', { data: 'value2' }, 300000); // 5分钟过期

// 获取缓存
const value1 = cache.get('key1');
console.log('Cache value:', value1);

// 检查缓存是否存在
const exists = cache.has('key1');
console.log('Cache exists:', exists);

// 删除缓存
cache.delete('key1');

// 清除所有缓存
cache.clear();

// 获取缓存大小
const size = cache.size();
console.log('Cache size:', size);
```

## 监控系统

### 导入

```typescript
import { getMonitoringService } from './src/monitoring';
import type { MonitoringConfig, SystemStatus } from './src/monitoring';
```

### 监控服务

```typescript
// 获取监控服务
const monitoringService = getMonitoringService({
  enabled: true,
  logLevel: 'info',
  metricsInterval: 5000,
  healthCheckInterval: 30000
});

// 启动监控服务
monitoringService.start();

// 获取系统状态
const status = monitoringService.getSystemStatus();
console.log('System status:', status);

// 获取性能报告
const performanceReport = monitoringService.getPerformanceReport();
console.log('Performance report:', performanceReport);

// 获取指标数据
const metrics = monitoringService.getMetrics();
console.log('Metrics:', metrics);

// 获取告警
const alerts = monitoringService.getAlerts();
console.log('Alerts:', alerts);

// 生成监控报告
const report = monitoringService.generateReport();
console.log('Monitoring report:', report);

// 显示监控报告
monitoringService.displayReport();

// 停止监控服务
monitoringService.stop();
```

## 用户界面优化

### 导入

```typescript
import { getUIEnhancer, getThemeManager } from './src/ui';
import type { Theme, ProgressBarConfig, PromptConfig, SelectConfig } from './src/ui';
```

## 缓存系统

### 导入

```typescript
import { createPersistedCache } from './src/cache/PersistedCacheService.js';
import type { CacheConfig } from './src/cache/models/types.js';
```

### 创建缓存服务

```typescript
const cacheService = createPersistedCache({
  cacheDir: './.cache',
  maxSize: 1000,
  ttl: 3600000,
  persist: true
});
```

### 缓存操作

```typescript
// 设置缓存
cacheService.set('key', 'value');

// 设置带过期时间的缓存
cacheService.set('key', 'value', 60000); // 60秒过期

// 获取缓存
const value = cacheService.get('key');

// 检查缓存是否存在
const exists = cacheService.has('key');

// 删除缓存
const deleted = cacheService.delete('key');

// 清空所有缓存
cacheService.clear();

// 获取缓存统计
const stats = cacheService.getStats();
console.log('Cache stats:', stats);
```

## 配置系统

### 导入

```typescript
import { createEnhancedConfigService } from './src/config/EnhancedConfigService.js';
```

### 创建配置服务

```typescript
const configService = createEnhancedConfigService({
  configPath: './config.json',
  lockTimeout: 5000,
  backup: true,
  autoReload: true
});
```

### 配置操作

```typescript
// 获取配置
const value = configService.get('key');

// 获取嵌套配置
const nestedValue = configService.get('database.host');

// 设置配置
configService.set('key', 'value');

// 更新配置
configService.update({
  database: { host: 'localhost', port: 5432 }
});

// 保存配置
configService.save();

// 重新加载配置
configService.reload();

// 获取所有配置
const allConfig = configService.getAll();

// 订阅配置变更
configService.subscribe('key', (newValue, oldValue) => {
  console.log('Config changed:', newValue, oldValue);
});
```

## 文档版本系统

### 导入

```typescript
import { createDocumentVersionService } from './src/docs/DocumentVersionService.js';
```

### 创建文档版本服务

```typescript
const documentService = createDocumentVersionService({
  versionsDir: './.versions',
  maxVersions: 100,
  compression: true
});
```

### 文档版本操作

```typescript
// 创建文档版本
const version = await documentService.createVersion('doc-id', {
  title: 'Document Title',
  content: 'Document content...',
  metadata: { author: 'user123' }
});
console.log('Version created:', version.id);

// 获取最新版本
const latest = await documentService.getLatestVersion('doc-id');
console.log('Latest version:', latest);

// 获取特定版本
const specific = await documentService.getVersion('doc-id', version.id);
console.log('Specific version:', specific);

// 列出所有版本
const versions = await documentService.listVersions('doc-id');
console.log('All versions:', versions);

// 恢复版本
const restored = await documentService.restoreVersion('doc-id', version.id);
console.log('Restored version:', restored);

// 比较版本
const diff = await documentService.compareVersions('doc-id', version1.id, version2.id);
console.log('Version diff:', diff);
```

## 远程任务调度系统

### 导入

```typescript
import { createRemoteTaskScheduler } from './src/remote/RemoteTaskScheduler.js';
```

### 创建任务调度器

```typescript
const scheduler = createRemoteTaskScheduler({
  maxRetries: 3,
  retryDelay: 5000,
  timeout: 30000,
  concurrency: 5
});
```

### 任务调度操作

```typescript
// 提交远程任务
const taskId = await scheduler.submitTask({
  type: 'file_sync',
  payload: { source: '/path/to/source', target: '/path/to/target' },
  priority: 'normal',
  callback: (result) => console.log('Task completed:', result)
});
console.log('Task submitted:', taskId);

// 获取任务状态
const status = scheduler.getTaskStatus(taskId);
console.log('Task status:', status);

// 取消任务
const cancelled = await scheduler.cancelTask(taskId);
console.log('Task cancelled:', cancelled);

// 获取任务结果
const result = await scheduler.getTaskResult(taskId);
console.log('Task result:', result);

// 列出所有任务
const tasks = scheduler.listTasks();
console.log('All tasks:', tasks);

// 获取任务统计
const stats = scheduler.getStats();
console.log('Scheduler stats:', stats);
```

## 分析系统

### 导入

```typescript
import { analyticsService } from './src/analytics/AnalyticsService.js';
```

### 分析操作

```typescript
// 追踪事件
analyticsService.track('button_click', {
  button: 'submit',
  page: '/form'
});

// 追踪用户行为
analyticsService.trackUserAction('form_submit', {
  formId: 'contact-form',
  duration: 1500
});

// 开始会话
analyticsService.startSession('user123');

// 结束会话
analyticsService.endSession();

// 获取会话数据
const sessionData = analyticsService.getSessionData();
console.log('Session data:', sessionData);

// 获取分析数据
const analyticsData = analyticsService.getAnalytics();
console.log('Analytics:', analyticsData);

// 生成报告
const report = analyticsService.generateReport();
console.log('Report:', report);
```

## 监控系统

### 导入

```typescript
import { getMonitoringService } from './src/monitoring/MonitoringService.js';
```

### 监控操作

```typescript
// 获取监控服务
const monitoringService = getMonitoringService({
  enabled: true,
  logLevel: 'info',
  metricsInterval: 5000,
  healthCheckInterval: 30000
});

// 获取系统状态
const status = monitoringService.getSystemStatus();
console.log('System status:', status);

// 获取性能报告
const performanceReport = monitoringService.getPerformanceReport();
console.log('Performance report:', performanceReport);

// 获取指标数据
const metrics = monitoringService.getMetrics();
console.log('Metrics:', metrics);

// 获取告警
const alerts = monitoringService.getAlerts();
console.log('Alerts:', alerts);
```

## 工具系统

### 导入

```typescript
import { createEnhancedToolSystem } from './src/tools/EnhancedToolSystem.js';
```

### 创建工具系统

```typescript
const toolSystem = createEnhancedToolSystem({
  maxTools: 100,
  timeout: 30000,
  enableCache: true
});
```

### 工具系统操作

```typescript
// 获取工具管理器
const toolManager = toolSystem.getToolManager();

// 执行工具
const result = await toolManager.executeTool('file_read', {
  path: 'package.json'
});
console.log('Tool result:', result);

// 获取所有工具
const tools = toolManager.getAllTools();
console.log('All tools:', tools);

// 获取工具信息
const toolInfo = toolManager.getToolInfo('file_read');
console.log('Tool info:', toolInfo);
```

## 工具函数库

### 导入

```typescript
import { stringUtils, arrayUtils, objectUtils, dateUtils, numberUtils, functionUtils } from './src/common/utils.js';
```

### 字符串工具

```typescript
// 截断字符串
const truncated = stringUtils.truncate('Hello, World!', 10);
console.log(truncated); // 'Hello, W...'

// 生成随机字符串
const random = stringUtils.random(16);
console.log(random);

// 模板字符串
const rendered = stringUtils.template('Hello, {{name}}!', { name: 'World' });
console.log(rendered); // 'Hello, World!'
```

### 数组工具

```typescript
// 去除重复
const unique = arrayUtils.unique([1, 2, 2, 3, 3, 3]);
console.log(unique); // [1, 2, 3]

// 分块
const chunks = arrayUtils.chunk([1, 2, 3, 4, 5], 2);
console.log(chunks); // [[1, 2], [3, 4], [5]]

// 扁平化
const flat = arrayUtils.flatten([1, [2, [3, [4]]]]);
console.log(flat); // [1, 2, 3, 4]
```

### 对象工具

```typescript
// 深拷贝
const copy = objectUtils.deepClone({ a: { b: { c: 1 } } });
console.log(copy); // { a: { b: { c: 1 } } }

// 合并对象
const merged = objectUtils.merge({ a: 1 }, { b: 2 }, { a: 3 });
console.log(merged); // { a: 3, b: 2 }

// 选取字段
const picked = objectUtils.pick({ a: 1, b: 2, c: 3 }, ['a', 'c']);
console.log(picked); // { a: 1, c: 3 }
```

### 日期工具

```typescript
// 格式化日期
const formatted = dateUtils.format(new Date(), 'YYYY-MM-DD HH:mm:ss');
console.log(formatted); // '2024-01-01 12:00:00'

// 解析日期
const parsed = dateUtils.parse('2024-01-01', 'YYYY-MM-DD');
console.log(parsed); // Date object

// 计算差异
const diff = dateUtils.diff(new Date(), new Date(Date.now() + 86400000), 'day');
console.log(diff); // -1
```

### 数字工具

```typescript
// 随机整数
const randomInt = numberUtils.randomInt(1, 100);
console.log(randomInt); // 42

// 格式化数字
const formattedNum = numberUtils.format(1234567, 2);
console.log(formattedNum); // '1,234,567.00'

// 范围限制
const clamped = numberUtils.clamp(150, 0, 100);
console.log(clamped); // 100
```

### 函数工具

```typescript
// 防抖
const debounced = functionUtils.debounce(() => console.log('Called'), 1000);

// 节流
const throttled = functionUtils.throttle(() => console.log('Called'), 1000);

// 重试
const result = await functionUtils.retry(async () => {
  return await fetchData();
}, { retries: 3, delay: 1000 });
```

## 用户界面优化

### 导入

```typescript
import { getUIEnhancer, getThemeManager } from './src/ui';
import type { Theme, ProgressBarConfig, PromptConfig, SelectConfig } from './src/ui';
```

### 主题管理

```typescript
// 获取主题管理器
const themeManager = getThemeManager();

// 获取当前主题
const currentTheme = themeManager.getCurrentTheme();
console.log('Current theme:', currentTheme.name);

// 切换主题
await themeManager.setTheme('dark');

// 列出所有主题
const themes = themeManager.listThemes();
console.log('Available themes:', themes);

// 获取主题
const darkTheme = themeManager.getTheme('dark');
console.log('Dark theme:', darkTheme);

// 保存主题设置
await themeManager.saveTheme();
```

### UI增强器

```typescript
// 获取UI增强器
const ui = getUIEnhancer();

// 显示进度条
const progress = ui.showProgressBar({
  label: 'Downloading',
  total: 100,
  width: 50
});

// 更新进度
for (let i = 0; i <= 100; i++) {
  progress(i);
  await new Promise(resolve => setTimeout(resolve, 50));
}

// 显示加载动画
const loading = ui.showLoading('Processing...');
// 执行操作
await new Promise(resolve => setTimeout(resolve, 2000));
loading.stop();

// 显示消息
ui.showSuccess('Operation completed successfully');
ui.showWarning('This action may have side effects');
ui.showError('An error occurred');
ui.showInfo('Information message');

// 显示标题和分隔符
ui.showTitle('Welcome to Liri');
ui.showSubtitle('Your AI assistant');
ui.showSeparator();

// 显示代码
ui.showCode('console.log("Hello, World!");');

// 提示用户输入
const input = await ui.prompt({
  message: 'Enter your name:',
  default: 'Guest',
  validate: (value) => value.length > 0 ? null : 'Name is required'
});
console.log('User input:', input);

// 让用户选择
const selection = await ui.select({
  message: 'Choose an option:',
  options: [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' }
  ],
  default: 'option1'
});
console.log('User selection:', selection);

// 显示菜单
const menuChoice = await ui.showMenu('Main Menu', [
  { value: '1', label: 'Option 1' },
  { value: '2', label: 'Option 2' },
  { value: '3', label: 'Exit' }
]);
console.log('Menu choice:', menuChoice);

// 确认操作
const confirmed = await ui.confirm('Are you sure?', true);
console.log('Confirmed:', confirmed);

// 清理
ui.cleanup();
```

## 伙伴系统

### 导入

```typescript
import { CompanionSprite, getCompanion, roll, rollWithSeed, companionUserId } from './src/buddy';
import { renderSprite, renderFace, spriteFrameCount } from './src/buddy/sprites';
import { companionIntroText, getCompanionIntroAttachment } from './src/buddy/prompt';
import { isBuddyTeaserWindow, isBuddyLive, useBuddyNotification } from './src/buddy/useBuddyNotification';
import type { Companion, CompanionBones, CompanionSoul, Rarity, Species, Eye, Hat } from './src/buddy/types';
```

### 获取伙伴

```typescript
// 根据用户ID获取伙伴（确定性生成）
const userId = 'user-123';
const companion = getCompanion(userId);
console.log('Your companion:', companion.species, companion.rarity);

// 随机生成伙伴
const randomCompanion = roll();
console.log('Random companion:', randomCompanion.species, randomCompanion.rarity);

// 使用种子生成（可复现）
const seededCompanion = rollWithSeed('my-seed');
console.log('Seeded companion:', seededCompanion.species);
```

### 伙伴属性

```typescript
// 伙伴由两部分组成：
// CompanionBones - 物理特征（物种、眼睛、帽子），从用户ID确定性生成
// CompanionSoul - 个性特征（名字、稀有度、颜色），存储在配置中

const bones: CompanionBones = companion.bones;
console.log('Species:', bones.species);
console.log('Eyes:', bones.eyes);
console.log('Hat:', bones.hat);

const soul: CompanionSoul = companion.soul;
console.log('Name:', soul.name);
console.log('Rarity:', soul.rarity); // common, uncommon, rare, epic, legendary
console.log('Color:', soul.color);
```

### 渲染伙伴

```typescript
// 渲染伙伴精灵图
const sprite = renderSprite(companion, 0); // 0 = 第一帧
console.log(sprite);

// 渲染面部
const face = renderFace(companion);
console.log(face);

// 获取帧数
const frames = spriteFrameCount(companion.bones.species);
console.log('Animation frames:', frames);
```

### 伙伴提示词

```typescript
// 获取伙伴介绍文本（用于AI上下文）
const introText = companionIntroText(companion);
console.log(introText);

// 获取伙伴附件（用于消息附件）
const attachment = getCompanionIntroAttachment(companion);
console.log('Attachment:', attachment);
```

### 伙伴通知

```typescript
// 检查伙伴预告窗口
const isTeaser = isBuddyTeaserWindow();
console.log('Is teaser window:', isTeaser);

// 检查伙伴是否已上线
const isLive = isBuddyLive();
console.log('Is buddy live:', isLive);
```

### 伙伴UI组件

```typescript
// CompanionSprite组件用于在终端中显示伙伴
// 支持以下功能：
// - 空闲动画（呼吸、眨眼）
// - 说话气泡
// - 抚摸反应（爱心效果）
// - 稀有度显示（星星）
// - 闪亮指示器

// 在React组件中使用：
// <CompanionSprite companion={companion} />
```

## 查询引擎

### 导入

```typescript
import { QueryEngine, createQueryEngine } from './src/query';
import { withRetry, categorizeAPIError } from './src/query/withRetry';
import { processUserInput, sanitizeUserInput } from './src/query/processUserInput';
import { fetchSystemPromptParts, normalizeMessage } from './src/query/queryContext';
import { normalizeMessages, isNotEmptyMessage, shouldSendToolProgress, createReadFileStateCache } from './src/query/queryHelpers';
import { startQueryProfile, queryCheckpoint, endQueryProfile } from './src/query/queryProfiler';
import type { QueryEngineConfig, QueryParams, QueryResult, SDKMessage, SessionState } from './src/query';
```

### 创建查询引擎

```typescript
// 创建查询引擎实例
const engine = createQueryEngine({
  apiKey: 'your-api-key',
  model: 'your-model-id',
  maxTokens: 4096,
  systemPrompt: 'You are a helpful assistant.',
  maxToolRoundtrips: 20,
  maxConsecutiveToolErrors: 3
});
```

### 提交消息

```typescript
// 提交用户消息并获取响应
const result = await engine.submitMessage('Hello, how are you?');
console.log('Response:', result.content);
console.log('Stop reason:', result.stopReason);
```

### 会话管理

```typescript
// 创建新会话
const sessionId = engine.createSession();

// 在指定会话中提交消息
const result = await engine.submitMessage('What is TypeScript?', { sessionId });

// 重置会话
engine.resetSession();

// 中止当前查询
engine.abort();
```

### 重试机制

```typescript
// 使用重试机制包装API调用
const result = await withRetry(
  async () => {
    return await apiCall();
  },
  {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000
  }
);

// 分类API错误
const classification = categorizeAPIError(error);
console.log('Error type:', classification.type); // rate_limit, server_error, timeout, etc.
console.log('Retryable:', classification.retryable);
```

### 用户输入处理

```typescript
// 处理用户输入
const processed = processUserInput('/help');
console.log('Is command:', processed.isCommand);
console.log('Command:', processed.command);
console.log('Args:', processed.args);

// 清理用户输入
const sanitized = sanitizeUserInput('  Hello, World!  ');
console.log('Sanitized:', sanitized); // 'Hello, World!'
```

### 查询上下文

```typescript
// 获取系统提示词部分
const promptParts = await fetchSystemPromptParts();
console.log('Default system prompt:', promptParts.defaultSystemPrompt);
console.log('User context:', promptParts.userContext);
console.log('System context:', promptParts.systemContext);

// 规范化消息
const normalized = normalizeMessage(message);
console.log('Normalized content:', normalized.content);
```

### 查询辅助函数

```typescript
// 批量规范化消息
const normalizedMessages = normalizeMessages(messages);

// 检查消息是否非空
const nonEmpty = isNotEmptyMessage(message);

// 工具进度节流
const shouldSend = shouldSendToolProgress('tool-use-id');

// 创建文件状态缓存
const cache = createReadFileStateCache(10);
cache.set('file-path', 'file-content');
const content = cache.get('file-path');
```

### 性能分析

```typescript
// 启用性能分析（设置环境变量 Liri_PROFILE_QUERY=1）
startQueryProfile();

// 记录检查点
queryCheckpoint('api_call_start');
// ... 执行API调用 ...
queryCheckpoint('api_call_end');

// 结束分析并打印报告
endQueryProfile();
```
