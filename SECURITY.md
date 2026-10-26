# 安全政策（Security Policy）

> 适用仓库：https://github.com/cocosoft/Liri （Liri · 玲珑鸟）
> 最后更新：2026-10-26

## 支持的版本

只对**最新发布版本**提供安全修复；更早版本请先升级再复现。

| 版本 | 安全修复 |
|---|---|
| 最新 release（当前 0.5.x） | ✅ |
| 更早版本 | ❌（请先升级） |

## 报告漏洞

**请不要用公开 issue 报告安全漏洞。**

请通过 GitHub 私密渠道提交：

- https://github.com/cocosoft/Liri/security/advisories/new （Security → Report a vulnerability）

报告里请尽量包含：

1. 受影响版本 / commit；
2. 复现步骤与最小 PoC；
3. 影响面（能否越权读写、能否出网、是否影响多租户隔离）；
4. 运行环境（OS、是否回环部署、相关 `sandbox.*` 与 `LIRI_*` 配置）。

我们会**尽力**在 7 天内给出首次回应；修复与披露时间视影响面商定。默认在修复发布后致谢（要求匿名请注明）。

## 范围：哪些算安全漏洞

- **沙箱逃逸**：Linux（Landlock）/ macOS（Seatbelt `sandbox-exec`）/ Windows（Low IL + Job Object）三条兜底路径的绕过
- **鉴权与授权**：本地 HTTP 服务的 401/403 边界、管理写接口（admin 写路由集合）、多租户行级隔离
- **插件与工具**：准入 / 能力 / 签名三层闸的绕过；工具参数注入
- **命令执行**：bash 工具与 `code_run` 的命令注入、路径穿越、写越界
- **数据与隐私**：会话事件、导出、日志、遥测中的敏感信息泄露
- **供应链**：依赖来源、构建产物与发布链

## 不在范围

- 需要**先关闭安全开关**（如 `sandbox.landlock.enabled=false`、`sandbox.landlock.failClosed=false`，或把签名闸强制关掉）才成立的"漏洞"
- 第三方平台自身的问题（Telegram / Discord / 微信等渠道侧）
- 纯开发期脚本、示例配置、`dev_docs/`（本机文档面，不入库）里的内容
- 上游依赖的已知漏洞：请同时报给上游；告知我们有助于加快升级

### 已知的非 registry 来源依赖

| 依赖 | 来源 | 现状与风险面 |
|---|---|---|
| `xlsx` | SheetJS 官方 CDN（`xlsx-0.20.2.tgz`） | `bun.lock` 记录 **sha512** 完整性（篡改可被发现）；npm registry 上的 `xlsx` 停在 0.18.x 且 SheetJS 已迁出 registry，故不用 npm 版。残余风险：CDN 单点可用性、镜像/私服审计旁路 |

## 安全模型速览（用于判断是否越界）

- **默认单用户、回环绑定**（`127.0.0.1`）；对外暴露需显式配置 `LIRI_HTTP_HOST` 且启用登录态校验
- **进程隔离按平台落地**：`code_run` 与 bash 走对应平台的 OS 级隔离；不可用时按 `failClosed` **拒绝**，不静默降级
- **插件三层闸**：准入（信任锚）→ 能力授权 → 签名；默认值不写字面量，而是「信任锚目录是否含 `*.pem`」
- **写前持久化**：进入模型请求的内容先落 `events.jsonl`，便于审计与回放

开关与默认值的**唯一事实源**见 `.trae/rules/project_rules.md` §1.4（安全开关清单）。

## 致谢

感谢每一位负责任披露的研究者。修复发布后，我们会在 release notes 中致谢（除非你要求匿名）。
