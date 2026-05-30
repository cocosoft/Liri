# 核心模块使用文档

本文档介绍了Liri项目中新增的核心模块及其使用方法。

## 目录

1. [依赖注入容器](#依赖注入容器)
2. [统一错误处理](#统一错误处理)
3. [结构化日志系统](#结构化日志系统)
4. [多级缓存系统](#多级缓存系统)
5. [内存监控和资源清理](#内存监控和资源清理)
6. [性能优化工具和监控](#性能优化工具和监控)
7. [功能开关机制](#功能开关机制)

## 依赖注入容器

### 概述

依赖注入容器（DIContainer）用于管理应用中的服务依赖关系，支持单例和工厂模式。

### 基本用法

```typescript
import { DIContainer } from './core/DIContainer';

// 创建容器实例
const container = new DIContainer();

// 注册服务工厂
container.register('userService', () => {
  return new UserService();
});

// 注册服务实例
const dbConnection = new DatabaseConnection();
container.registerInstance('dbConnection', dbConnection);

// 解析服务
const userService = container.resolve('userService');
const db = container.resolve('dbConnection');

// 检查服务是否存在
if (container.has('userService')) {
  console.log('UserService is registered');
}

// 注销服务
container.unregister('userService');

// 清空所有服务
container.clear();
```

### 高级用法

```typescript
// 使用依赖注入
container.register('repository', () => {
  const db = container.resolve('dbConnection');
  return new Repository(db);
});

// 单例模式
container.register('config', () => {
  return Config.getInstance();
});

// 工厂模式
container.register('user', (userId: string) => {
  return new User(userId);
});
```

## 统一错误处理

### 概述

统一错误处理系统提供了错误分类、严重程度定义和统一的错误处理机制。

### 基本用法

```typescript
import { AppError, ErrorCategory, ErrorSeverity, ErrorHandler } from './error';

// 创建应用错误
const error = new AppError(
  'Failed to connect to database',
  ErrorCategory.NETWORK,
  ErrorSeverity.HIGH,
  'DB_CONNECTION_FAILED',
  { host: 'localhost', port: 5432 }
);

// 处理错误
ErrorHandler.handle(error);

// 抛出错误
throw new AppError(
  'Invalid input',
  ErrorCategory.VALIDATION,
  ErrorSeverity.MEDIUM
);
```

### 错误分类

- `NETWORK`: 网络相关错误
- `FILESYSTEM`: 文件系统相关错误
- `PERMISSION`: 权限相关错误
- `VALIDATION`: 验证相关错误
- `EXECUTION`: 执行相关错误
- `UNKNOWN`: 未知错误

### 错误严重程度

- `LOW`: 低严重程度
- `MEDIUM`: 中等严重程度
- `HIGH`: 高严重程度
- `CRITICAL`: 严重错误，可能导致应用退出

## 结构化日志系统

### 概述

结构化日志系统提供了统一的日志记录接口，支持多种日志级别和输出方式。

### 基本用法

```typescript
import { logger, LogLevel } from './utils/log';

// 设置日志级别
logger.setLogLevel(LogLevel.DEBUG);

// 设置日志文件
logger.setLogFile('/var/log/app.log');

// 记录日志
logger.debug('Debug message', { key: 'value' });
logger.info('Info message', { userId: 123 });
logger.warn('Warning message', { resource: 'memory' });
logger.error('Error message', error, { context: 'operation' });
logger.fatal('Fatal error', error, { context: 'startup' });
```

### 日志级别

- `DEBUG`: 调试信息
- `INFO`: 一般信息
- `WARN`: 警告信息
- `ERROR`: 错误信息
- `FATAL`: 致命错误

### 日志格式

日志以JSON格式输出，包含以下字段：

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info",
  "message": "Info message",
  "context": { "userId": 123 }
}
```

## 多级缓存系统

### 概述

多级缓存系统提供了内存缓存、带过期的内存缓存和持久化缓存三种缓存方式。

### 基本用法

```typescript
import { MemoryCache, PersistentCache, MultiLevelCache } from './utils/cache';

// 内存缓存
const memoryCache = new MemoryCache<string>(1000);
memoryCache.set('key', 'value', 60000); // TTL: 60秒
const value = memoryCache.get('key');

// 持久化缓存
const persistentCache = new PersistentCache<string>('/tmp/cache.json', 10000);
persistentCache.set('key', 'value', 60000);
const value = persistentCache.get('key');

// 多级缓存
const multiCache = new MultiLevelCache<string>(1000, '/tmp/cache.json', 10000);
multiCache.set('key', 'value', 60000, true); // persistent: true
const value = multiCache.get('key');
```

### 缓存操作

```typescript
// 设置缓存
cache.set('key', 'value', ttl);

// 获取缓存
const value = cache.get('key');

// 检查键是否存在
if (cache.has('key')) {
  console.log('Key exists');
}

// 删除缓存
cache.delete('key');

// 清空缓存
cache.clear();

// 清理过期项
cache.cleanup();

// 获取缓存大小
const size = cache.size();
```

### 多级缓存特性

- 自动回填：从持久化缓存读取时会自动回填到内存缓存
- 统一接口：三种缓存方式使用相同的接口
- 过期管理：支持TTL（Time To Live）过期机制
- 容量控制：支持最大容量限制和LRU淘汰策略

## 内存监控和资源清理

### 概述

内存监控和资源清理机制用于监控内存使用情况，及时清理资源。

### 基本用法

```typescript
import { memoryMonitor, resourceManager } from './utils/memoryMonitor';

// 配置内存监控
memoryMonitor.setMemoryThreshold(512); // 512MB
memoryMonitor.setCheckInterval(60000); // 60秒

// 注册清理回调
memoryMonitor.registerCleanupCallback(async () => {
  console.log('Cleaning up resources...');
  // 执行清理逻辑
});

// 注册缓存
memoryMonitor.registerCache(multiCache);

// 启动监控
memoryMonitor.start();

// 获取内存统计
const stats = memoryMonitor.getMemoryStats();
console.log(stats);

// 检查内存是否健康
if (!memoryMonitor.isMemoryHealthy()) {
  console.log('Memory usage is high');
}

// 停止监控
memoryMonitor.stop();
```

### 资源管理

```typescript
// 注册资源
resourceManager.registerResource('database', dbConnection, async () => {
  await dbConnection.close();
});

// 获取资源
const db = resourceManager.getResource('database');

// 注销资源
resourceManager.unregisterResource('database');

// 清理所有资源
await resourceManager.cleanupAll();

// 获取资源统计
const stats = resourceManager.getResourceStats();
console.log(stats);
```

## 性能优化工具和监控

### 概述

性能优化工具和监控提供了性能监控、分析和优化工具。

### 基本用法

```typescript
import { 
  performanceMonitor, 
  PerformanceTimer, 
  performanceUtils,
  measurePerformance 
} from './utils/performance';

// 使用性能计时器
const timer = performanceUtils.startTimer('operation', { userId: 123 });
// 执行操作
timer.stop();

// 记录性能指标
performanceUtils.recordMetric('operation', 150, { userId: 123 });

// 获取性能统计
const stats = performanceUtils.getStats('operation');
console.log(stats);

// 获取性能报告
const report = performanceUtils.getReport();
console.log(report);

// 分析性能瓶颈
const analysis = performanceUtils.analyzeBottleneck('operation');
if (analysis.isBottleneck) {
  console.log('Bottleneck detected:', analysis.reason);
  console.log('Suggestions:', analysis.suggestions);
}

// 生成优化建议
const suggestions = performanceUtils.generateOptimizationSuggestions();
console.log(suggestions);
```

### 使用装饰器

```typescript
class MyService {
  @measurePerformance('MyService.processData')
  async processData(data: any): Promise<any> {
    // 处理数据
    return result;
  }
}
```

### 性能分析

```typescript
import { PerformanceAnalyzer } from './utils/performance';

const analyzer = new PerformanceAnalyzer();

// 分析性能瓶颈
const analysis = analyzer.analyzeBottleneck('operation');
console.log(analysis);

// 生成优化建议
const suggestions = analyzer.generateOptimizationSuggestions();
console.log(suggestions);
```

## 功能开关机制

### 概述

功能开关机制用于管理应用中的功能开关，支持从环境变量中读取配置。

### 基本用法

```typescript
import { 
  FeatureFlag, 
  isFeatureEnabled, 
  getFeatureFlags,
  isDevMode,
  isTestMode 
} from './utils/features';

// 检查功能是否启用
if (isFeatureEnabled(FeatureFlag.ENABLE_PLUGINS)) {
  console.log('Plugins are enabled');
}

// 获取所有功能开关状态
const flags = getFeatureFlags();
console.log(flags);

// 检查是否为开发模式
if (isDevMode()) {
  console.log('Development mode is enabled');
}

// 检查是否为测试模式
if (isTestMode()) {
  console.log('Test mode is enabled');
}
```

### 功能标志

#### 核心功能

- `ENABLE_PLUGINS`: 启用插件系统
- `ENABLE_SKILLS`: 启用技能系统
- `ENABLE_MCP`: 启用MCP（Model Context Protocol）
- `ENABLE_WORKFLOWS`: 启用工作流
- `ENABLE_ADVANCED_COMMANDS`: 启用高级命令

#### 性能相关

- `ENABLE_CACHE`: 启用缓存
- `ENABLE_MEMORY_MONITORING`: 启用内存监控
- `ENABLE_PERFORMANCE_TRACKING`: 启用性能跟踪

#### 安全相关

- `ENABLE_PERMISSION_CHECKS`: 启用权限检查
- `ENABLE_SECURITY_SCAN`: 启用安全扫描

#### 开发相关

- `ENABLE_DEBUG_MODE`: 启用调试模式
- `ENABLE_DEV_FEATURES`: 启用开发功能
- `ENABLE_TEST_MODE`: 启用测试模式

### 环境变量配置

```bash
# 启用插件
export ENABLE_PLUGINS=true

# 禁用技能
export ENABLE_SKILLS=false

# 启用调试模式
export ENABLE_DEBUG_MODE=true
```

## 最佳实践

### 1. 依赖注入

- 使用依赖注入容器管理服务依赖
- 优先使用工厂模式创建服务
- 合理使用单例模式管理全局状态

### 2. 错误处理

- 使用统一的错误类型和分类
- 为错误提供清晰的上下文信息
- 根据错误严重程度采取不同的处理策略

### 3. 日志记录

- 根据环境设置合适的日志级别
- 为关键操作添加详细的上下文信息
- 定期清理日志文件

### 4. 缓存使用

- 根据数据特性选择合适的缓存类型
- 设置合理的TTL值
- 定期清理过期缓存

### 5. 内存管理

- 设置合理的内存阈值
- 及时释放不再使用的资源
- 监控内存使用情况

### 6. 性能优化

- 定期分析性能瓶颈
- 根据分析结果进行优化
- 使用性能装饰器监控关键操作

### 7. 功能开关

- 使用功能开关控制实验性功能
- 通过环境变量配置功能开关
- 在生产环境中谨慎使用开发功能

## 故障排查

### 常见问题

1. **依赖注入容器无法解析服务**
   - 确保服务已正确注册
   - 检查服务名称是否正确

2. **日志文件无法写入**
   - 检查文件路径权限
   - 确保目录存在

3. **缓存未生效**
   - 检查TTL设置是否合理
   - 确认缓存容量是否足够

4. **内存使用过高**
   - 检查内存阈值设置
   - 查看是否有资源未释放

5. **性能监控数据不准确**
   - 确保性能监控已启用
   - 检查计时器是否正确停止

## 伙伴系统

### 概述

伙伴系统（Buddy System）为终端界面提供了一个可爱的ASCII艺术伙伴。伙伴的物理特征（物种、眼睛、帽子）从用户ID确定性生成，个性特征（名字、稀有度、颜色）存储在配置中。

### 核心概念

- **CompanionBones**：物理特征，从用户ID哈希确定性生成，包括物种、眼睛、帽子
- **CompanionSoul**：个性特征，存储在配置中，包括名字、稀有度、颜色
- **稀有度系统**：Common (60%), Uncommon (25%), Rare (10%), Epic (4%), Legendary (1%)
- **18种物种**：duck, goose, blob, cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit, mushroom, chonk

### 主要功能

- 确定性伙伴生成（基于用户ID）
- ASCII艺术精灵渲染（3帧动画）
- 空闲动画（呼吸、眨眼）
- 说话气泡
- 抚摸反应（爱心效果）
- 稀有度显示（星星）
- 伙伴介绍提示词

### 使用场景

- 终端UI个性化
- 用户陪伴体验
- AI上下文增强

## 查询引擎

### 概述

查询引擎（QueryEngine）管理查询生命周期，处理消息提交、工具执行、会话管理和API重试逻辑。

### 核心功能

- **消息处理**：提交用户消息并获取AI响应
- **会话管理**：创建、重置、中止会话
- **工具执行**：支持多轮工具调用
- **自动压缩**：上下文超限时自动压缩
- **重试机制**：指数退避重试带抖动
- **性能分析**：可选的查询性能分析

### 辅助模块

- **queryContext**：系统提示词构建、结果检查、消息规范化
- **queryHelpers**：批量规范化、工具进度节流、文件状态缓存
- **queryProfiler**：查询性能分析、检查点记录
- **withRetry**：API调用重试机制
- **processUserInput**：用户输入预处理

### 使用场景

- AI对话管理
- 多轮工具调用
- API错误处理和重试
- 查询性能优化

## 参考资源

- [TypeScript文档](https://www.typescriptlang.org/docs/)
- [Node.js文档](https://nodejs.org/docs/)
- [项目README](../README.md)
- [开发指南](../docs/DEVELOPMENT.md)
