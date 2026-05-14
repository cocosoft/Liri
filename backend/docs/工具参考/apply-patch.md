# apply_patch - 应用补丁工具

## 描述

应用补丁到指定的文件，支持精确的文本替换操作。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 目标文件路径 |
| `patch` | string | 是 | 补丁内容 |

## 使用示例

```javascript
// 应用简单补丁
apply_patch({
  file_path: "./src/index.ts",
  patch: `--- a/index.ts
+++ b/index.ts
@@ -1,3 +1,4 @@
-const port = 3000;
+const port = 8080;
`
})
```

## 补丁格式

使用统一的差异格式（unified diff format），支持多文件补丁。

## 限制

- 补丁必须精确匹配上下文
- 不支持二进制文件的补丁
- 大文件的补丁可能较慢
