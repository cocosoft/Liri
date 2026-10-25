# 插件市场

## 概述

插件市场提供插件的发现、安装和管理功能。

## 浏览插件

```bash
# 浏览可用插件
/plugin market

# 搜索插件
/plugin search "database"

# 查看插件详情
/plugin info plugin-name
```

## 安装插件

```bash
# 从市场安装
/plugin install plugin-name

# 从本地安装
/plugin install ./path/to/plugin.zip

# 从 URL 安装
/plugin install https://example.com/plugins/my-plugin.zip
```

## 管理插件

```bash
# 查看已安装插件
/plugin list

# 启用插件
/plugin enable plugin-name

# 禁用插件
/plugin disable plugin-name

# 卸载插件
/plugin uninstall plugin-name

# 更新插件
/plugin update plugin-name
```

## 能力权限（2026-10-25）

第三方插件必须声明 `capabilities`，并在用户授权后才会被加载。桌面端在「插件市场 → 已安装插件」
每张卡片上点**能力权限**即可展开勾选（未实现的能力显示为禁用项，例如 `events`）。

- 勾选即保存，落 `~/.pyapp/plugins/capability-grants.json`，与 `.env` 的
  `LIRI_PLUGIN_CAPABILITY_GRANTS` **取并集**；
- 收回某能力 ⇒ 取消勾选；声明了但未勾选的能力会让该插件**拒绝加载**（fail-closed）；
- 接口：`GET` / `PUT /v1/plugins/marketplace/plugins/{id}/capabilities`
  （`PUT` 体 `{ granted: string[] }`，覆盖语义，需要 admin 权限）。

## 发布插件

1. 准备好插件包（zip 格式）
2. 提交到插件市场仓库
3. 经过审核后发布

## 版本管理

- 使用语义化版本控制
- 插件市场会显示兼容性信息
- 自动检查更新
