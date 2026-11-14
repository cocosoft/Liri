# CLI 分发渠道（G2 剩余）

> 立项：2026-11-14（方案 `dev_docs/20261113/建议落地方案-20261114.md` §2 · G2 剩余）
> 一期口径：**清单与发布作业就位、可离线验证**；**不做**真实发布（无凭据/无网络），渠道商店端到端可用性未验证。

## 1. 取证（2026-11-14）

| 事实 | 证据 |
|---|---|
| CLI 能力已有：`bin` 4 项、可 `--project-dir` 任意目录启动 | `app/package.json`（`bin`：`Liri` / `liri-memory` / `liri-ink` …）；方案 §1 表 G2 行 |
| 入口自带 shebang，构建产物可执行 | `app/src/main.ts:1` `#!/usr/bin/env bun`；`bun run build` → `dist/main.js`（首行保留 shebang） |
| **不能**直接把 `app/package.json` 发布到 npm | 其依赖含 22 个 **workspace 包**（`@openliri/*`，未发布）；`dependencies` 数量大 ⇒ 独立发布包更诚实 |
| 已有 CI 只出桌面安装包 | `.github/workflows/release.yml`（Tauri 跨平台）—— 无 CLI 渠道作业 |
| 无任何分发清单 | 仓库无 `packaging/`；无 scoop/homebrew 清单 |

## 2. 一期交付

| 件 | 内容 |
|---|---|
| `scripts/gen-package-manifests.ts` 🆕 | 纯函数渲染三份清单（Scoop / Homebrew / npm）+ `sha256OfFile`；CLI：`--version --artifact`（真实哈希）/ `--check`（校验已提交清单）/ `--placeholder`（提交占位） |
| `packaging/scoop/liri.json` 🆕 | Scoop 清单：`depends: [bun]`、`bin: [[Liri.cmd, liri]]`、`checkver` / `autoupdate`（占位哈希 `0…0`，发版覆写） |
| `packaging/homebrew/liri.rb` 🆕 | formula：`depends_on "bun"`，安装 `dist/main.js` 到 `libexec` + 写 `bin/liri` shim，含 `test do` 冒烟 |
| `packaging/npm/package.json` 🆕 | **独立发布包**：`bin.Liri = dist/main.js`、`files: [dist/main.js]`、`engines.bun`；不继承 app 的 workspace 依赖 |
| `.github/workflows/release-cli-packages.yml` 🆕 | tag `v*` 触发：构建 → 打 `liri-cli-<ver>.tgz`（含 `Liri.cmd`）→ 用**真实 sha256** 重生成清单 → 上传 artifact / 附到 Release；配 `NPM_TOKEN` 才 `npm publish`（否则步骤内跳过） |
| `app/tests/packaging/packageManifests.test.ts` 🆕 | 6 条：sha256 已知向量 / 三份清单字段 / 渲染确定性 / **仓库清单 = 占位渲染结果**（防手改） |

## 3. 边界（如实）

| 项 | 口径 |
|---|---|
| 发布 | **未执行**：无 `NPM_TOKEN`、无网络；npm 包未真实 `npm publish` |
| Scoop / Homebrew | 只产出**可提交的清单**；提 PR 到 `openliri/scoop` / `openliri/homebrew-tap` 需人工；清单字段未在真实 bucket 上校验 |
| 运行时 | 产物是 **Bun target** 的 JS bundle ⇒ 三个渠道都以 `bun` 为运行前置（`depends: [bun]` / `depends_on "bun"` / `engines.bun`），不是独立二进制 |
| 签名 | 本渠道产物**未签名**；与插件签名闸无关（方案 §2 提到的签名策略评估仍待做） |
| CI 未验证 | 新 workflow 未在 GitHub 上跑过（本地只能校验 YAML 结构）；首次发版需观察 |
| 不做 | 独立单文件二进制（`bun build --compile`，需交叉编译矩阵）、Chocolatey、AUR、Docker CLI 镜像 |

## 4. 验收

| 验收项 | 判据 |
|---|---|
| 哈希正确 | `sha256OfFile("abc")` = 标准 `ba7816bf…15ad`（1 条） |
| Scoop 字段 | version / hash / url / `depends: [bun]` / `bin` 映射（1 条） |
| Homebrew 字段 | sha256 / version / `depends_on "bun"` / 产物名（1 条） |
| npm 字段 | `bin.Liri = dist/main.js` / `files` 白名单 / `engines.bun`（1 条） |
| 确定性 | 同输入两次逐字相同（1 条） |
| 防漂移 | 仓库内三份清单 == 脚本以「当前 app 版本 + 占位哈希」渲染的结果（1 条） |
| 生成器可用 | `--placeholder` 已实际生成三份清单；`--check` 在清单与产物一致时退出 0 |

## 5. 二期前置（未做，如实登记）

1. **凭据与真实发布**：`NPM_TOKEN`、tap/bucket 仓库、发版账号与 2FA 策略；
2. **签名与校验**：产物签名（与插件签名闸同批评估）、`bun` 版本下限校验；
3. **单文件二进制**：`bun build --compile` 的 win/mac/linux 交叉编译矩阵（可去掉 bun 前置）；
4. **CI 真跑**：workflow 首次发版观察（上传 artifact、Release 附档、npm 发布、清单校验）。
