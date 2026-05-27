# I18n 注册表 - 国际化注册表

## 概述

I18nRegistry 提供国际化翻译注册和查找能力，支持多语言翻译注册、键值查找、参数插值和区域链回退。

## 基本用法

```typescript
import { I18nRegistry } from "./core/i18n/registry.js";

const registry = new I18nRegistry({ defaultLocale: "en" });

// 注册翻译
registry.registerTranslation("zh-CN", {
  greeting: "你好",
  farewell: "再见",
  errors: {
    notFound: "未找到资源"
  }
});

// 查找翻译
const greeting = registry.t("greeting", {}, "zh-CN");
console.log(greeting); // "你好"
```

## 功能特性

### 参数插值

```typescript
registry.registerTranslation("en", {
  welcome: "Hello, {name}! You have {count} messages."
});

const msg = registry.t("welcome", { name: "Alice", count: 5 }, "en");
// "Hello, Alice! You have 5 messages."
```

### 区域链回退

```typescript
// 查找链: zh-CN → en → fallbackLocales
registry.registerTranslation("en", {
  greeting: "Hello"
});

// zh-CN 未注册 greeting，回退到 en
const greeting = registry.t("greeting", {}, "zh-CN");
console.log(greeting); // "Hello"
```

### 点号键访问

```typescript
// 使用点号访问嵌套翻译
const msg = registry.t("errors.notFound", {}, "zh-CN");
```

## 注册方法

```typescript
// 批量注册翻译
registry.registerTranslation("ja", translations);

// 注册单个条目
registry.registerEntry("ja", "app.name", "PY_APP");
```

## API 参考

| 方法 | 说明 |
|------|------|
| `t(key, params, locale)` | 获取翻译 |
| `registerTranslation(locale, map)` | 注册翻译映射 |
| `registerEntry(locale, key, value)` | 注册单个翻译 |
| `setDefaultLocale(locale)` | 设置默认区域 |
| `getSupportedLocales()` | 获取支持的区域 |
| `hasTranslation(locale, key)` | 检查翻译是否存在 |
