# Cache 系统 - 缓存系统

## 概述

缓存系统提供内存缓存能力，支持 TTL、LRU 淘汰策略和缓存事件监听。

## 基本用法

```typescript
import { Cache } from "./core/cache/Cache.js";

const cache = new Cache({ maxSize: 100, ttl: 3600 });

// 设置缓存
cache.set("user:123", { name: "Alice" });

// 获取缓存
const user = cache.get("user:123");

// 删除缓存
cache.delete("user:123");

// 清空缓存
cache.clear();
```

## 缓存配置

```typescript
const cache = new Cache({
  maxSize: 1000,        // 最大条目数
  ttl: 3600,            // 默认过期时间（秒）
  maxMemory: "100MB",   // 最大内存使用
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

## 缓存事件

```typescript
cache.on("set", (key, value) => {});
cache.on("delete", (key) => {});
cache.on("expire", (key) => {});
cache.on("evict", (key, reason) => {});
```

## 批量操作

```typescript
// 批量设置
cache.mset([
  { key: "a", value: 1 },
  { key: "b", value: 2 }
]);

// 批量获取
const values = cache.mget(["a", "b"]);

// 获取所有键
const keys = cache.keys();

// 获取缓存统计
const stats = cache.stats();
```
