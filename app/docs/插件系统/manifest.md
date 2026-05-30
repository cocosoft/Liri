# 插件清单

## manifest.json 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 插件名称 |
| `version` | string | 是 | 语义化版本 |
| `description` | string | 是 | 插件描述 |
| `author` | string | 否 | 作者 |
| `license` | string | 否 | 许可证 |
| `entry` | string | 是 | 入口文件 |
| `dependencies` | object | 否 | 依赖关系 |
| `permissions` | string[] | 是 | 所需权限 |
| `hooks` | object | 否 | 钩子注册 |

## 完整示例

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "一个示例插件",
  "author": "Liri Team",
  "license": "MIT",
  "icon": "assets/icon.png",
  "entry": "dist/index.js",
  "minAppVersion": "1.0.0",
  "dependencies": {
    "py-app": ">=1.0.0"
  },
  "permissions": [
    "file:read",
    "file:write",
    "network:fetch"
  ],
  "hooks": {
    "onMessage": true,
    "onToolExecute": false
  },
  "config": {
    "apiKey": {
      "type": "string",
      "required": true,
      "description": "API 密钥"
    },
    "debugMode": {
      "type": "boolean",
      "default": false,
      "description": "调试模式"
    }
  }
}
```

## 权限声明

插件必须声明所需权限，用户安装时需确认：

- `file:read` - 读取文件
- `file:write` - 写入文件
- `network:fetch` - 网络请求
- `bash:exec` - 执行命令
- `admin:config` - 修改配置
