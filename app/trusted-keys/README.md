# 随包官方插件公钥（`app/trusted-keys/`）

本目录**随安装包分发**（`copy-seed-data.ts` 复制到 `<包>/app/trusted-keys/`；
Tauri 侧由 `bundle.resources` 映射到 `<resources>/app/trusted-keys`），运行时只读。

## 放什么

- **只放 `*.pem`** —— Ed25519 **公钥**（SPKI PEM），例如 `official-plugin-signing.pub.pem`。
- **绝不放私钥**：私钥只存在于发布者本地/密钥系统，不入库、不随包。
- 本说明文件不参与判定：加载器只读 `*.pem`，目录里没有 `*.pem` 时本目录视为「无官方钥」。

## 运行时口径（`app/src/plugins/utils/pluginSignature.ts`）

- 信任锚 = **并集**：本目录 ∪ 用户目录 `~/.pyapp/plugins/trusted-keys/` ∪
  `LIRI_PLUGIN_TRUSTED_KEYS_DIR`（显式配置）。
- 任一目录**真的含 `*.pem`** ⇒ 清单签名校验自动启用（「信任锚即意图」）；
  显式 `LIRI_PLUGIN_REQUIRE_SIGNATURE=false` 可临时关闭。
- 并集语义保证：用户自建钥不会把随包官方钥挤掉，反之亦然。

## 如何成为「官方钥」的发布者

```bash
cd app
bun run plugin:sign keygen --out ./keys    # 私钥 plugin-signing.key 留在本地密钥系统，不进仓库
cp ./keys/plugin-signing.pub.pem ./trusted-keys/official-plugin-signing.pub.pem
```

随后每次发包都带上该公钥；插件清单用 `bun run plugin:sign sign --plugin <dir> --key <私钥>` 签名，
`plugin.sig`（base64，对 `plugin.json` **原始字节**签）随插件目录分发。
