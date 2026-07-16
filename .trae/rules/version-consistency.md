---
alwaysApply: false
description: 
---
# 版本号一致性规则

## 规则

项目版本号必须在以下 6 个文件中保持完全一致：

| # | 文件 | 字段 |
|---|------|------|
| 1 | `app/package.json` | `version` |
| 2 | `client/package.json` | `version` |
| 3 | `client/package-lock.json` | `version`（根级和 packages."" 级，共 2 处） |
| 4 | `client/src-tauri/Cargo.toml` | `package.version` |
| 5 | `client/src-tauri/tauri.conf.json` | `version` |
| 6 | `app/native/package.json` | `version` |
| 7 | `app/native/Cargo.toml` | `package.version` |

## 版本升级检查清单

每次升级版本号时，逐项确认：

- [ ] `app/package.json` → `"version": "X.Y.Z"`
- [ ] `client/package.json` → `"version": "X.Y.Z"`
- [ ] `client/package-lock.json` → 根级 `"version"` + `packages.""` 级 `"version"`
- [ ] `client/src-tauri/Cargo.toml` → `version = "X.Y.Z"`
- [ ] `client/src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
- [ ] `app/native/package.json` → `"version": "X.Y.Z"`
- [ ] `app/native/Cargo.toml` → `version = "X.Y.Z"`

## 验证命令

```bash
# 查找所有版本号（升级后确认无旧版本残留）
rg "0\.4\.XX" --glob '*.{json,toml}' | grep -v node_modules
```
