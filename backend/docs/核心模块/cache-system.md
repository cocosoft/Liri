# Cache 系统 - 缓存系统

## 概述

缓存系统提供内存缓存能力，支持 TTL、LRU 淘汰策略和缓存事件监听。

## 基本用法

```typescript
import { CacheSystem } from "./cache/CacheSystem.js";

const cache = new CacheSystem({ maxSize: 100, ttl: 3600 });

// 设置缓存
await cache.set("user:123", { name: "Alice" });

// 获取缓存
const user = await cache.get("user:123");

// 删除缓存
await cache.delete("user:123");

// 清空缓存
await cache.clear();
```

## 缓存配置

```typescript
const cache = new CacheSystem({
  maxSize: 1000,        // 最大条目数
  ttl: 3600,            // 默认过期时间（秒）
  maxMemory: 100 * 1024 * 1024, // 最大内存使用（字节）
  strategy: "lru"       // 淘汰策略
});
```

## 淘汰策略

| 策略 | 说明 |
|------|------|
| `lru` | 最近最少使用 |
| `lfu` | 最不常用 |
| `fifo` | 先进先出 |
| `ttl` | 过期时间优先 |

## 缓存策略

```typescript
import { CacheStrategyManager } from "./cache/index.js";

const strategyManager = new CacheStrategyManager();

// 切换淘汰策略
strategyManager.switchStrategy("lfu");
```

## 缓存监控

```typescript
import { CacheMonitor } from "./cache/index.js";

const monitor = new CacheMonitor(cache);

// 获取缓存统计
const stats = monitor.getStats();
console.log(stats);
// { hitRate: 0.85, missRate: 0.15, size: 100, memoryUsage: "25MB" }
```
