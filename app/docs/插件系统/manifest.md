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
| `capabilities` | string[] | 否 | **能力声明**（闭合集合 `tools` / `config` / `events`）；缺省按旧清单取 `["tools"]`。见下节 |

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

## 能力声明（2026-10-25）

`capabilities` 与 `permissions` 是**两件事**：`permissions` 是插件对外部资源的诉求，
`capabilities` 是**系统向你提供的 API 面**（闭合集合，集合外的名字会让清单被判非法）。

| 能力 | 提供的内容 | 状态 |
|---|---|---|
| `tools` | `ctx.services` / 工具注册（工具执行回主进程） | ✅ |
| `config` | `ctx.config.get/set/save`（仅本插件命名空间，落 `~/.pyapp/plugins/config/config.json`；Python 插件与 Node 插件**同一份**，旧 `<data>/plugin-config/` 首次启动自动并入） | ✅ |
| `events` | `ctx.events.on/off/emit` | ⏸ **未实现**：声明即拒绝（授权了也没有提供面） |

- 声明了但用户未授权 ⇒ **拒绝安装 / 拒绝加载**（fail-closed）；用户可从「插件市场 → 能力权限」勾选，
  或由管理员写 `.env`：`LIRI_PLUGIN_CAPABILITY_GRANTS=<插件id>:<能力>[,<能力>]`。
- 本机完全没配置任何授权时不做门控（零行为变更），但**清单里的未知能力名永远被拒**。

## 清单签名（`plugin.sig`，2026-10-25）

签名是可选的来源证明：`plugin.sig` 是对 **`plugin.json` 原始字节**的 Ed25519 签名（base64）。

```bash
# 生成密钥对（私钥自己保管，不要放进插件目录）
cd app && bun run plugin:sign keygen --out ./keys
# 签名（会写出 <插件目录>/plugin.sig）
bun run plugin:sign sign --plugin <插件目录> --key ./keys/plugin-signing.key
# 本地验签
bun run plugin:sign verify --plugin <插件目录> --keys ./keys
```

启用方式：把公钥 `*.pem` 放进下列**任一**目录即开始校验（三处取**并集**，互不替代）：

| 目录 | 用途 |
|------|------|
| `<安装目录>/app/trusted-keys/` | **随包官方钥**（只读；由发布方维护，用户无需改动） |
| `~/.pyapp/plugins/trusted-keys/` | 用户自建钥（自己签的插件放这里） |
| `LIRI_PLUGIN_TRUSTED_KEYS_DIR` 指向的目录 | 追加的信任锚（即使目录不存在也参与判定） |

当前安装包**已内置官方公钥**（`app/trusted-keys/`）⇒ **默认即校验**：未签名的第三方插件会被拒绝安装与加载；
需要灰度时显式写 `LIRI_PLUGIN_REQUIRE_SIGNATURE=false`。
