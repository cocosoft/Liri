# 插件概述

## 架构

```
┌─────────────────────────────────────┐
│           插件管理器                  │
│  ┌─────┐ ┌─────┐ ┌─────┐           │
│  │插件A │ │插件B │ │插件C │  ...     │
│  └─────┘ └─────┘ └─────┘           │
│         │         │                  │
│         ▼         ▼                  │
│  ┌─────────────────────────────────┐ │
│  │        钩子系统                  │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 插件能力

- **工具注册**: 向系统注册新的工具
- **技能注册**: 添加新的技能模板
- **事件监听**: 响应系统事件
- **钩子注入**: 在系统流程中插入自定义逻辑
- **UI 扩展**: 扩展命令行界面

## 加载闸门（第三方插件，2026-10-25）

文件 / 安装型第三方插件在真正执行前要过**四道闸**（任一不过即拒绝，且都会给出可操作原因）：

| 顺序 | 闸门 | 判定 | 放行方式 |
|---|---|---|---|
| 1 | **准入** | 第三方代码默认**不在主进程**加载 | `LIRI_PLUGIN_TRUSTED_IDS=<插件id>`（逗号分隔） |
| 2 | **签名** | 有信任锚就必须是受信任公钥签过的清单 | 公钥放 `app/trusted-keys/`（随包官方钥）或 `<plugins 根>/trusted-keys/`（自建钥），并给清单签名（`bun run plugin:sign`） |
| 3 | **能力** | 清单声明的 `capabilities` 必须已授权 | 市场页「能力权限」勾选，或 `.env` 的 `LIRI_PLUGIN_CAPABILITY_GRANTS` |
| 4 | **进程** | 通过前三道后默认在**子进程**运行（`PLUGIN_HOST_PROCESS=true`） | 子进程只注入白名单 env，读不到宿主 `.env`；工具经 RPC 回主进程执行并留审计 |

- 第一方 bundled 插件不走这套闸；
- 第 2 道**只在有信任锚时启用**（随包官方钥 `app/trusted-keys/`、用户自建钥 `<plugins 根>/trusted-keys/`、
  `LIRI_PLUGIN_TRUSTED_KEYS_DIR` **三处并集**，任一目录有 `*.pem` 即开始校验，
  `LIRI_PLUGIN_REQUIRE_SIGNATURE=false` 可临时关闭）；
- 第 3 道在完全没有授权配置时不做门控（零行为变更），但清单里的**未知能力名永远被拒**。

## 安装插件

```bash
# 从插件市场安装
/plugin install plugin-name

# 从本地路径安装
/plugin install ./my-plugin

# 从 URL 安装
/plugin install https://example.com/plugin.zip
```

## 管理插件

```bash
# 列出已安装插件
/plugin list

# 启用插件
/plugin enable plugin-name

# 禁用插件
/plugin disable plugin-name

# 卸载插件
/plugin uninstall plugin-name
```
