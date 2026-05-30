# 版本发布流程

> 官方网站：https://openliri.com
> 版本管理规则详见 [versioning.md](file:///E:/PY/CODES/PY_APP/.trae/rules/versioning.md)。

## 版本号约定

| 组件 | 版本文件 | 当前版本 |
|------|----------|---------|
| 后端 (app/) | `app/package.json` | 0.1.0 |
| 前端客户端 (client/) | `client/package.json` | 0.1.0 |
| Tauri 配置 | `client/src-tauri/tauri.conf.json` | 0.1.0 |
| Cargo 配置 | `client/src-tauri/Cargo.toml` | 0.1.0 |

版本格式：`v<主版本>.<次版本>.<修订号>`（如 `v0.1.0`）

版本升级规则：日常每次提交递增修订号（patch），修订号满 100 进位次版本（minor），次版本满 10 进位主版本（major）。详见 [versioning.md](file:///E:/PY/CODES/PY_APP/.trae/rules/versioning.md)。

---

## 一、发布前检查清单

### 1.1 代码质量

- [ ] 后端类型检查通过：`cd app && bun run typecheck`
- [ ] 后端测试通过：`cd app && bun test`
- [ ] 前端类型检查通过：`cd client && npm run typecheck`
- [ ] 前端构建通过：`cd client && npm run build`
- [ ] 后端构建通过：`cd app && bun run build`

### 1.2 版本号对齐

> 所有组件版本号必须统一更新。

版本升级统一使用 `npm version patch` 自增修订号：

```bash
# ========== 获取当前版本并计算下一个修订号 ==========
$version = node -e "const v=require('./app/package.json').version; const p=v.split('.').map(Number); p[2]++; console.log(p.join('.'))"
echo "Bumping to: v$version"

# ========== 更新后端版本 ==========
cd app
bunx json -I -f package.json -e "this.version='$version'"
cd ..

# ========== 更新前端版本 ==========
cd client
npm version $version --no-git-tag-version
npx json -I -f src-tauri/tauri.conf.json -e "this.version='$version'"
cd ..

# ========== 更新 Cargo.toml ==========
$cargoPath = "client/src-tauri/Cargo.toml"
$content = Get-Content $cargoPath -Raw
$content = $content -replace '^version = "[\d\.]+"', "version = `"$version`""
Set-Content $cargoPath $content
```

进位次版本/主版本时手动设置目标版本号，替换 `$version` 即可。

### 1.3 生成变更日志

- [ ] `git log --oneline --no-decorate v{上一版本}..HEAD` 提取变更
- [ ] 按类型归类：Feature / Bugfix / Refactor / Docs

### 1.4 构建产物验证

- [ ] 后端编译产物正常：`cd app && bun run build:win`
- [ ] Tauri 桌面客户端可打包：`cd client && npm run tauri build`
- [ ] 客户端 dist/ 无报错（js/css 资源完整）

---

## 二、自动发布流程

### 2.1 打标签触发 GitHub Release

```bash
# 推送版本标签（会触发 .github/workflows/release.yml）
git tag -a "v$version" -m "Release v$version"
git push origin "v$version"
```

### 2.2 CI/CD 自动执行内容

`.github/workflows/release.yml` 当前包含：

| 步骤 | 说明 |
|------|------|
| `bundle` job | 检出代码 → 安装 Bun 依赖 → `bun build` 编译后端 JS → 上传 `dist/` 产物 |
| `release` job | 下载产物 → 使用 `softprops/action-gh-release` 创建 GitHub Release → 附加 `dist/main.js` |

### 2.3 Release 产物清单

| 产物 | 来源 | 用途 |
|------|------|------|
| `dist/main.js` | `app/` 后端 JS 编译产物 | 运行后端服务 |
| `client/src-tauri/target/release/Liri.*` | Tauri 原生打包 | 桌面客户端安装包 |

---

## 三、手动打包步骤（Windows）

### 3.1 后端独立编译

```powershell
cd app
bun run build:win
# 产物在 dist/py_app_coding.exe
```

### 3.2 Tauri 桌面客户端打包

```powershell
cd client
npm install
npm run tauri build
# 产物在 client/src-tauri/target/release/bundle/
# ├── msi/   — Windows 安装包
# └── nsis/  — NSIS 安装包
```

### 3.3 发布物目录结构

```
release-v0.1.0/
├── liri_coding.exe            # 后端独立可执行文件
├── Liri_0.1.0_x64.msi        # Tauri MSI 安装包
├── Liri_0.1.0_x64-setup.exe  # Tauri NSIS 安装包
└── CHANGELOG.md               # 版本变更日志
```

---

## 四、发布后检查

- [ ] GitHub Release 页面可见，release notes 完整
- [ ] Release 附件可下载（main.js + 安装包）
- [ ] 安装包在 Windows 全新环境可安装运行
- [ ] 后端启动正常，HTTP 端口 7890 可达
- [ ] 前端页面加载正常，所有 API 端点可达

---

## 五、故障处理

| 问题 | 处理方式 |
|------|---------|
| `bun build` 失败 | 检查 `app/` 依赖是否完整，`bun install` 重试 |
| `npm run tauri build` 失败 | `cd client/src-tauri && cargo build` 看具体 Rust 报错 |
| `json` 命令不存在 | `npm install -g json` 安装 json 命令行工具 |
| Cargo.toml 版本号不对 | 手动编辑 `[package] version` 字段 |
| Release 标签已存在 | `git tag -d v1.1.0 && git push origin :refs/tags/v1.1.0` 删除后重来 |

---

## 六、版本升级典型流程

```powershell
# 1. 确认当前分支（应在 main）
git branch

# 2. 确保工作区干净
git status

# 3. 获取当前版本并计算下一个修订号
$version = node -e "const v=require('./app/package.json').version; const p=v.split('.').map(Number); p[2]++; console.log(p.join('.'))"
echo "Bumping to: v$version"

# 4. 更新后端版本
cd app
bunx json -I -f package.json -e "this.version='$version'"
cd ..

# 5. 更新前端版本
cd client
npm version $version --no-git-tag-version
npx json -I -f src-tauri/tauri.conf.json -e "this.version='$version'"
cd ..

# 6. 更新 Cargo.toml
$cargoPath = "client/src-tauri/Cargo.toml"
$content = Get-Content $cargoPath -Raw
$content = $content -replace '^version = "[\d\.]+"', "version = `"$version`""
Set-Content $cargoPath $content

# 7. 提交版本更新
git add -A
git commit -m "chore: bump version to v$version"

# 8. 跑一遍验证
cd app && bun run typecheck && bun test && cd ..
cd client && npm run typecheck && npm run build && cd ..

# 9. 打标签并推送
git tag -a "v$version" -m "Release v$version"
git push origin main --tags
```
