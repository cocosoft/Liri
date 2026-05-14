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

## 发布插件

1. 准备好插件包（zip 格式）
2. 提交到插件市场仓库
3. 经过审核后发布

## 版本管理

- 使用语义化版本控制
- 插件市场会显示兼容性信息
- 自动检查更新
