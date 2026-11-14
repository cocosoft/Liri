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

## 6. 二期已交付（单文件二进制 + 校验和）

| 件 | 内容 |
|---|---|
| `scripts/build-cli-binary.ts` 🆕 | `bun build --compile` 产出**自带运行时**的单文件可执行（默认 `app/dist/cli-bin/liri-<os>-<arch>[.exe]`），并在同目录写 `SHA256SUMS`（`<sha256>  <name>`，按名升序）；纯函数 `defaultOutfile` / `parseBuildArgs` / `renderSha256Sums` / `sha256Of` |
| `app/tests/packaging/cliBinary.test.ts` 🆕 | 4 条：平台产物名 / 参数解析与覆盖 / 空值不静默 / 校验和渲染确定 |

**实测（2026-11-14，win32-x64）**：`bun run scripts/build-cli-binary.ts` 成功 —— `4762 modules`，
`bundle 551ms` + `compile 536ms`，产物 `app/dist/cli-bin/liri-win32-x64.exe`，
`SHA256SUMS` = `57f1858d…36cec`。

**运行验证受环境限制（如实）**：本机 Windows「应用程序控制策略」阻止执行新建 exe
（`应用程序控制策略已阻止此文件`）⇒ **只验证了构建与哈希**，未验证二进制可运行。

### 仍未做（如实）

1. **产物签名**：仓库无签名证书/密钥；`SHA256SUMS` 只做完整性校验，**不等于签名**（签名需发版侧配置，与插件签名闸同批评估）。（**已由 §7 接线**，证书/凭据仍待发版侧提供）
2. **交叉编译矩阵**：`bun build --compile` 只能产出**当前平台**产物 ⇒ 需 CI 三平台矩阵（win/mac/linux 各跑一次本脚本）后才谈"三渠道去 bun 前置"。（**矩阵已由 §7 落地**）
3. **清单 standalone 变体**：`packaging/**` 目前仍声明 `bun` 前置；去前置需在矩阵产物就绪后新增 `--standalone` 渲染（避免提前去掉前置却发不出二进制）。
4. **真实发布凭据**：`NPM_TOKEN` / tap / bucket 账号仍未配置。（**签名 secrets 已由 §7 登记**，值仍待配置）

## 7. 三期已交付（三平台矩阵 + 签名接线）

| 件 | 内容 |
|---|---|
| `scripts/sign-cli-binary.ts` 🆕 | 纯函数 `resolveSigningPlan(platform, file, options)` + `normalizePlatform` / `parseSignArgs` / `readSigningEnv`；CLI：未配置凭据 ⇒ 打印**跳过原因**继续（退出 0），已配置 ⇒ 逐条执行签名/校验命令（任一失败退出 1）；**签名后重算 `SHA256SUMS`**（签名改变字节） |
| `app/tests/packaging/cliSigning.test.ts` 🆕 | 11 条：平台归一化 / Windows 缺口令与缺证书跳过 / 签名+verify 命令序列与默认时间戳 / 自定义时间戳 / macOS 有身份无 p12 / 有 p12 的 keychain 导入顺序 / p12 缺口令跳过 / Linux 跳过 / 参数解析 / env 空串视为未配置 |
| `.github/workflows/release-cli-packages.yml` | ➕ `cli-binaries` 作业：`matrix.os = ubuntu / macos / windows` 三平台**原生**构建（`bun build --compile` 不支持交叉产出）→ 可选签名 → 上传 artifact → 附到 Release |

**签名凭据（发版侧 secrets，仓库内不含任何证书）**：

| secret | 用途 |
|---|---|
| `LIRI_SIGN_WIN_CERT_PFX_BASE64` / `LIRI_SIGN_WIN_CERT_PASSWORD` | Windows Authenticode（`signtool`，时间戳默认 DigiCert） |
| `LIRI_SIGN_MAC_IDENTITY` | macOS 签名身份（`Developer ID Application: …`） |
| `LIRI_SIGN_MAC_CERT_P12_BASE64` / `LIRI_SIGN_MAC_CERT_PASSWORD` | macOS `.p12`（可选；提供则建临时 keychain 导入） |

**边界（如实）**：
- **未真实签名**：仓库无证书、本机无凭据 ⇒ `signtool` / `codesign` 命令**从未执行**，只用例锁定"计划推导"；**CI 未真跑**（首次发版观察）；
- **Linux 不签名**：无通用二进制签名标准，`resolveSigningPlan` 如实 `skip`（不引入 GPG 分发）；
- **macOS 未公证**：仅 `codesign` + 校验；`notarytool` 公证需 Apple 账号与 zip 打包，未做；
- **清单仍声明 bun 前置**：`packaging/**` 未出 `--standalone` 变体（矩阵产物就绪后再切）。（**已由 §8 补齐**：standalone 清单在发版期按真实产物生成）
- **产物未在本机重新构建**：本期只新增签名脚本与 CI 作业；`bun build --compile` 已实测过一次（§6），签名后产物未复测。

## 8. 四期已交付（standalone 清单：去掉 bun 前置）

矩阵能产出四份单文件二进制后，清单层才有资格去掉 `bun` 前置。本期把这条链路接成**只认真实产物**：

| 件 | 内容 |
|---|---|
| `scripts/gen-package-manifests.ts` | ➕ `parseStandaloneName`（只认 `liri-<platform>-<arch>[.exe]`）/ `resolveStandaloneAssets`（按必需清单核对，**缺哪个报哪个**）/ `renderScoopStandaloneManifest`（无 `depends`）/ `renderHomebrewStandaloneFormula`（`on_macos` 分 arm/intel + `on_linux`，无 `depends_on "bun"`）/ `renderStandaloneManifests`（三文件 + 合并 `SHA256SUMS`，复用 `build-cli-binary` 的渲染）；CLI ➕ `--standalone --assets <dir>`（**无 `--placeholder`**，缺平台即退出 1） |
| `app/tests/packaging/standaloneManifests.test.ts` 🆕 | 7 条：命名解析 / 齐全与排序 / 缺平台只报缺失 / Scoop 无依赖且 url+hash 正确 / Homebrew 无 `depends_on "bun"` 且三分支齐全 / 合并 `SHA256SUMS` 确定性 / 渲染 fail-fast |
| `.github/workflows/release-cli-packages.yml` | ➕ `standalone-manifests`（`needs: cli-binaries`）：下载三平台 artifact → 按**真实 sha256** 生成 → 上传 artifact → 附到 Release |
| `.gitignore` | ➕ `packaging/standalone/`（发版期生成物，**不入库**，避免坏链接进仓库） |

**已本地实测（2026-11-14）**：
- 缺平台：`--standalone --assets app/dist/cli-bin`（本机只有 win32-x64）⇒ **退出 1**，输出 `liri-darwin-arm64, liri-darwin-x64, liri-linux-x64`，且**不创建输出目录**；
- 齐全：用临时目录放 4 个产物 ⇒ 生成 3 个文件（`scoop/liri.json` / `homebrew/liri.rb` / `SHA256SUMS`）后已清理。

**边界（如实）**：
- **npm 变体不做**：npm 去运行时前置需按平台分包（`optionalDependencies` + 主包探测），属独立设计；当前 `packaging/npm` 仍以 `bun` 为前置。（**已由 §9 补齐**：standalone 分包树在发版期生成）
- **未真实发版**：清单由 CI 在 tag 时生成，**本机未发布**、Release 上传步骤未真跑；
- **Homebrew 安装写法未在真实 tap 校验**：`bin.install Dir["*"].first => "liri"` 依赖"下载物即单文件可执行"这一事实，需首次发版在 macOS/Linux 实机安装验证；
- 单文件二进制**仍未签名**（§7 只接线，凭据待配）⇒ standalone 渠道暂时分发未签名二进制。

## 9. 五期已交付（npm standalone 变体：按平台分包）

Scoop / Homebrew 已在 §8 去掉 `bun` 前置；npm 侧需要另一种做法 —— **主包 + 平台包**
（与 esbuild / swc 同类），否则单包无法同时携带四个平台的二进制。

| 件 | 内容 |
|---|---|
| `scripts/gen-package-manifests.ts` | ➕ `npmPlatformTargets`（平台表**唯一事实源 = `REQUIRED_STANDALONE_TARGETS`**）/ `renderNpmStandaloneLauncher`（Node CJS 启动器：按 `process.platform-arch` 解析平台包二进制、`spawnSync` 透传 argv/退出码，不支持或缺包即报错退出 1）/ `renderNpmPlatformPackageJson`（`os`/`cpu` 限定 + `files` 只含二进制）/ `renderNpmStandaloneRootPackageJson`（**零 `dependencies`**，`optionalDependencies` 串联四个平台包，`engines.node >=18`）/ `renderNpmStandaloneTree`；CLI ➕ `--standalone-npm --version --assets`（把二进制**复制进各自平台包**，无占位模式，缺平台退出 1） |
| `app/tests/packaging/npmStandalone.test.ts` 🆕 | 6 条：平台包清单与排序 / `os`+`cpu` 限定 / 主包零依赖与 optionalDependencies 完整性 / 启动器平台表同源且**不含 bun** / 包树路径 / 渲染确定性 |
| `.github/workflows/release-cli-packages.yml` | ➕ `npm-standalone`（`needs: cli-binaries`）：下载产物 → 生成包树 → 上传 artifact → 有 `NPM_TOKEN` 时**先发平台包再发主包**（否则步骤内跳过） |
| `.gitignore` | ➕ `packaging/standalone-npm/`（生成物 + 二进制，不入库） |

**已本地实测（2026-11-14）**：
- 缺平台：`--standalone-npm --assets app/dist/cli-bin` ⇒ **退出 1**，列出 3 个缺失，且**不创建输出目录**；
- 齐全：临时目录放 4 个产物 ⇒ 生成 6 个清单文件 + 4 个二进制就位（10 个文件）后已清理。

**边界（如实）**：
- **未真实发布**：`NPM_TOKEN` 未配置，`npm publish` 未执行；平台包名 `@openliri/cli-*` 需先在 npm 注册 scope；
- **启动器未在真实安装树验证**：`require.resolve('<平台包>/<二进制>')` 依赖 npm 把二进制原样装入包内，需首次发布后 `npm i -g openliri` 实机验证；
- **旧 npm 渠道未撤**：`packaging/npm`（bun 前置单包）仍在，两者会争用同名包 `openliri` ⇒ 切 standalone 前需二者择一（本批不切换，避免"清单已切、发布未通"）。（**已由 §10 解决**：legacy 改名 `openliri-bun`）
- 二进制**仍未签名**（§7 凭据待配）。

## 10. 六期已交付（npm 渠道命名收敛：消除同名包冲突）

§9 遗留的冲突：legacy（bun 前置）与 standalone（分包）都要用包名 `openliri`，同时发布会互相覆盖。

**取舍**：`openliri` 留给 **standalone**（未来方向），legacy 改名 **`openliri-bun`**（保留可用回退，不删除 —— 无证书/凭据期间它是唯一"已能装"的 npm 渠道）。

| 件 | 内容 |
|---|---|
| `scripts/gen-package-manifests.ts` | `renderNpmPackageJson` 的 `name` `openliri` → **`openliri-bun`**（唯一改动点；standalone 主包 `renderNpmStandaloneRootPackageJson` 仍为 `openliri`） |
| `packaging/npm/package.json` | 由 `--placeholder` 重新生成（仅 `name` 变化），**防漂移用例**继续成立 |
| `app/tests/packaging/npmStandalone.test.ts` | ➕ 1 条**冲突门禁**：legacy = `openliri-bun`、standalone = `openliri`（两者不得相等） |

**边界（如实）**：
- **未真实发布**：两个包名都未在 npm 上创建；改名只体现在清单与工作流产物，**首次发布时才会真正生效**；
- **legacy 未删除**：`packaging/npm` 与 `package` 作业里的 npm 发布步骤保留（可回退路径），待 standalone 实机验证通过后再评估下线（届时按 `code-deletion.md` CD01–CD06 走流程）；
- 安装名会变：用户需按渠道区分（`npm i -g openliri` = 单文件二进制版；`npm i -g openliri-bun` = 需 Bun 运行时版），需在发版说明中写清。
