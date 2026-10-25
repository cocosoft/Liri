# 更新日志 / Changelog

> 本文件是 Liri **版本变更的完整历史**（**单一事实源**）。
> `README.md` 的「🚀 版本更新记录」仅保留**最新一版摘要**并指向本文件 —— 避免同一份变更记录两处维护（双源漂移）。
>
> - 版本号遵循[语义化版本](.trae/rules/versioning.md)；发布流程见其 §四。
> - 条目**倒序**（最新在上）；`## [未发布]` 段用于累积下一次发版内容。
> - 条目格式沿用 `README.md` 原「版本更新记录」的写法（`#### vX.Y.Z (日期)` + 摘要 + `- ✅` 列表），**逐字迁移、未改写**（2026-10-05 建库）。

> **说明（2026-10-06 补录）**：标「（git 历史补录）」的段落由**版本 tag 区间的真实 git 提交**归纳生成
> （精炼版：最多 6 条，按 `feat > fix > perf > refactor > 其它` 排序；全文见 `git log <prev>..<tag>`）。
> 与 2026-10-05 由 README **逐字迁移**的条目**来源不同**；要点为**原提交描述**，未改写、未编造。
> 该标记的完整约定（触发条件 / 事实统计 / 顺序 / 异常标注 / 工具与粒度红线）见 [`.trae/rules/versioning.md`](.trae/rules/versioning.md) **§3.1**。
>
> - 本次补录 **38** 个此前缺失的版本 tag（自 `v0.1` 起），使本文件覆盖 **56 个版本 tag / 1843 次提交**（局部历史见 `https://github.com/cocosoft/PY_APP`，即转入 Liri 仓库前的提交）。
> - ⚠️ **已知 tag 日期异常**：`v0.1.0` 的 tag 日期（2026-05-30）**晚于** `v0.1.1`（2026-05-28）。本文件统一按**版本号**降序（故 `v0.1.1` 在 `v0.1.0` 之前）；两段各自的提交区间为 `v0.1..v0.1.1` 与 `v0.1.1..v0.1.0`。

---

## [未发布]
<!-- EVIDENCE-VIEWS:BEGIN（生成物：未发布段。改 fix-evidence-log.jsonl 后跑 gen-evidence-views.ts 重新生成） -->
- ✅ **T25-08-P2-PY-E2E-CI**：CI 不允许静默 skip：Python 真链 E2E 缺解释器即报红 —— 验证 guard-red|e2e1|plugins99|workflows；基线 PATH='' ⇒ 1 fail/1 skip exit1；正常环境同开关 ⇒ 1 pass（详情见 archive/evidence-detail.jsonl#T25-08-P2-PY-E2E-CI）
- ✅ **T25-08-P2-PY-CONFIG-E2E**：Python 插件 config 真链 E2E（真实 spawn + 反向 RPC） —— 验证 e2e1|plugins99|typecheck|arch|doc-code；基线 真链证明 Python _Config → 反向 RPC → 宿主端口；无解释器整组 skip（详情见 archive/evidence-detail.jsonl#T25-08-P2-PY-CONFIG-E2E）
- ✅ **T25-08-P2-PY-CONFIG-MERGE**：插件 config 双轨收敛：Python 并入 PluginConfigManager —— 验证 plugins98|typecheck|arch|doc-code|doc-alias；基线 Python/Node 同一份配置；旧文件首次启动并入后改名 .migrated（详情见 archive/evidence-detail.jsonl#T25-08-P2-PY-CONFIG-MERGE）
- ✅ **T25-08-P2-OFFICIAL-KEY**：T25-08 P2：内置官方插件公钥（签名闸默认开启） —— 验证 plugins93|typecheck|doc-code|doc-alias；基线 缺省启用签名闸：未签第三方插件被拒；私钥在仓库外（详情见 archive/evidence-detail.jsonl#T25-08-P2-OFFICIAL-KEY）
- ✅ **T25-08-P2-BUNDLED-KEYS**：T25-08 P2：随包分发官方插件公钥（信任锚三处并集） —— 验证 sig18|paths29|typecheck|kernel|kernel-api|arch|doc-code|doc-alias；基线 信任锚单目录→三处并集；无 *.pem 的构建零行为变更（详情见 archive/evidence-detail.jsonl#T25-08-P2-BUNDLED-KEYS）

（v0.5.10 已发布；以下为发版后累积、待下一版带出）
- ✅ **内核发布形态修正（评审 A1/A3）** - `build` 撤销 bundler 打桶（消除桶与子路径双实例）、`exports` 去 6 条目录通配改为逐文件列举、新增 `smoke` 断言（无通配 / 目标存在 / 单例一致）
- ✅ **内核 DI 容器契约修复（架构评审 9 条）** - 环注册失败回滚、报错给出闭环路径、request 作用域改 AsyncLocalStorage（并发隔离）、
  transient 的 `onDispose` 注册期 fail-closed、注册期增量环检测（去 O(N²)）、自动装配只接受纯标识符、
  `disposeAll` 单点失败不中断、生命周期钩子依赖显式 `eager`；包内测试 20 → 31 例
- ✅ **提交前拦 GitHub Actions YAML 破损** - 新增 `lint:workflows`（workflows + composite action），pre-commit 与 doc-gate 双处接线
- ✅ **macOS 假红** - `mobilePairing` 用例不再用 1ms TTL 与 runner 时钟赛跑
<!-- EVIDENCE-VIEWS:END -->

#### v0.5.11 (2026-10-25)  租户级数据库 + 内核发布闭环就绪 + 可观测性补强 + 死面清理收尾

- ✅ **租户级数据库（多租户隔离）** - provider/task/cost/execution/checkpoint/knowledge/TAOR/session 等
  14+ 仓储迁租户库，`owner_key` 行级隔离 + 漏网清单 8 仓逐仓修（knowledge 5 + workspace 2 + tasks 1）；
  显式 dbPath 8 单例收口、按 owner 回收上下文缓存；多租户数据面边界裁定落盘
- ✅ **内核包发布闭环** - 单模块实例（撤 bundler 打桶）+ `exports` 非通配逐文件列举 + smoke 三断言；
  DI 容器契约 9 条修复（环回滚 / request 作用域 AsyncLocalStorage / disposeAll 超时）；
  发布通道 `kernel-release.yml` + README/LICENSE 随包 + 内核纳入 test 选择与版本守卫
- ✅ **暴露面登录态（REQUIRE_BEARER）** - 非回环暴露 / headless 必须有效 Bearer，回环零变更
- ✅ **可观测性补强** - 工具运行与 bash 命令执行全链补 app.log（安全门拦截 / 成败 / 异常三分支 + 主链 onToolCall 升 INFO）
- ✅ **死面清理收尾** - 删除 promptSuggestion / agent-persona 死面（先摘入口、后删实现，CD05）；Google AI 外部建议逐条裁定
- ✅ **门禁与 CI 补强** - 提交前拦 GitHub Actions YAML 破损（lint:workflows + pre-commit/doc-gate 双接线）；macOS 假红修复

#### v0.5.10 (2026-10-24)  内核独立包落地 + core 减重收口 + 内核面/基线门禁补强 + 侧车靶点复核

- ✅ **内核独立包 `@openliri/kernel`** - 源码物理迁出 `app/src/core`（P1–P6）；别名统一 `@openliri/kernel`；
  发布面收敛到 `dist`（双条件 `exports` + 声明树 + 显式依赖）；独立 CI（产物逐条校验 `exports` 目标可
  import）+ 秒级 `test:kernel` 回归回路；编译期边界：删 tsconfig 通配，非公开子路径由解析器拒绝。
- ✅ **core 减重** - 删除 `auto-reply` 死代码（6 文件）；B 档搬出 `media-generation` → `ai/`、
  `persona` → `agent/`、`migration` → `system/state/`；按方案 A 删 3 个三重零模块（18 文件）+
  观察期收尾（10 文件）⇒ core **146 → 113 文件**（导出面 146/1366 → 113/1044）。
- ✅ **内核门禁 K01–K08** - 静态/动态跨层、出工作区、SPI 禁实现类、三方依赖白名单、深路径棘轮
  （123 → 0）、导出面快照、**K08 体量棘轮**（文件/行/子目录只减不增；基线缺失 fail-closed）。
- ✅ **Q3 去产品化** - 产品身份（`appName` / `envPrefix`）改为**宿主注入**，默认 `pyapp` / `LIRI_`
  ⇒ 本仓零行为变更；`<prefix>HTTP_PORT` / `<prefix>BUILD_VARIANT` 读/写同键；字面量守卫钉住
  「内核不再自带产品名」。
- ✅ **门禁与规则补强** - 新增 `lint:doc-alias`（规则文档里的导入别名必须可解析）；
  `doc-gate` 承接 `.trae/architecture` 基线棘轮（原被 `ci.yml` 的 `paths-ignore` 跳过 ⇒ 假绿）；
  规则 §2.16 要求方案状态头与证据台账一致。
- ✅ **侧车靶点复核** - P2 媒体原生面 / P1 常驻 LSP 在开关开启下分别 **92 / 97 用例全绿**
  （含崩溃隔离、有界重启、进程树强杀、E2E），默认仍关；`liri-native` 以量化证据
  （1MB 计数原生 2.04ms vs JS 0.24ms）结案「不侧车化」。

#### v0.5.9 (2026-10-23)  主包瘦身 R4 收口 + bash 判定精度 + 评审遗留修复

- ✅ **主包瘦身 R4：被裁能力的配置项可读错误** - 编译期裁剪（`DROP_CHANNELS_ALL` / `DROP_CHANNEL_FEISHU`）
  后，配置里仍写着的通道不再静默失效：启动时逐个告警；`PUT/POST /v1/channels/:id` 返回
  `CHANNEL_DROPPED_BY_BUILD` / `CHANNEL_UNKNOWN` 机器码与可操作文案；`applyConfig` 由静默跳过改为 `errors` 回报。
- ✅ **bash 危险命令判定精度** - 从子串匹配改为 **token 边界匹配**（`result` / `git add` /
  `format-test` / `skill.js` 不再被误伤），带空格的组合（`rm -rf`）仍按整串匹配，与沙箱检查器同口径。
- ✅ **`POST /v1/agents/:id/stop` 特权显式化** - 不传 `sessionId` 时必须显式 `privileged: true`；
  二者同传或都不传一律 400（附 hint），不再「不传即特权」。
- ✅ **权限与工具修正** - `isWithinWorkingDirectory` 相对路径按**传入的 cwd** 解析（解锁长期 skip 的用例）；
  `GlobTool` 正则一次编译 + 递归拼接相对路径；聊天流单轮复用 `turnModel` 解析。
- ✅ **判据与测试清理** - 断言自检单列 no-op 变形（不再虚高有效检查数）；eval 快照子进程解析
  `git` / `tar` 绝对路径（PATH 缺失不再 `spawn ENOENT`）；`subagent_type` 用例改用独占探针角色名
  （消除并行顺序敏感）；移除已修复用例的 skip 登记。

#### v0.5.8 (2026-10-23)  工具审批四档与自动执行 + 影子工具接线 + 归属/断环收口

- ✅ **工具审批四档与长程自动执行** - 审批卡支持「本次 / 本会话 / 始终允许 / 拒绝」；
  「始终允许」按工具 + 参数指纹落盘；会话级 `auto-local` 仅自动放行**只读 + 工作区内本地写**
  （默认关）；审批提交前去重 + Inbox 部分唯一索引兜底（并发冲突返回既有卡）。
- ✅ **声明式风险 + 沙箱豁免 + 文件工具隔离** - 风险从"按工具名猜"改为工具声明
  `riskClass` / `riskClassFor`（未声明 fail-safe）；沙箱信号单点解析并接入 chat / LRO / MCP；
  文件类工具在容器/SSH 工作区有挂载映射时经适配器读写，多挂载按最长前缀匹配。
- ✅ **命令规则与审计** - 白名单/黑名单新增 `matchType: prefix | regex`（存量默认前缀），
  决策链与 bash 前置检查同源；自动放行审计落 `security-audit.log`，安全页支持明细与 CSV 导出。
- ✅ **Q-18 影子工具接线** - `agents_list` / `kanban` / `mcp_auth` / `tts` 接线进生效面
  （`mcp_auth` 受 `FEATURE_MCP_OAUTH` 门控）；`music_generate` 移除假成功；
  6 个下线类影子工具按 CD05 摘声明并删除实现，`voice_output` 摘登记保留观察。
- ✅ **思考预算与命令入口** - `/effort` 第二步：Provider 按 DB `capabilities.thinking` 下发
  思考预算；`/fast` 分流 quick；prompt 型斜杠命令（security-review 等）在聊天入口生效；
  `brief` 会话摘要接入 GUI，`insights` 四子命令改用真实数据源并上 UI。
- ✅ **归属与安全收口** - 事件派生读取（消息 / 事件 / 派生校验）补显式归属校验；
  工具侧会话消息与 transcript 按身份作用域读写；HTTP/CoreAPI 入口补必填参数 fail-closed；
  命令入口 × 会话归属组合验证补齐。
- ✅ **断环与启动面** - 沙箱权限位解析下沉为独立模块、AgentTool 真身解析改反向登记，
  madge 循环依赖回到 0；删除 `StartupProfiler` 未使用导入，启动面棘轮恢复 282 文件。

> 本版为功能 + 修复混合版：工具审批/沙箱隔离是主线，另含影子工具接线与多处归属/契约收口（详见正文）。

#### v0.5.7 (2026-10-22)  工作台导航重排（搜索/最近/6 组）+ 收掉第二个工作台外壳 + 两条后端契约缺陷

- ✅ **工作台目录可搜、可记、可收** - 30 个入口此前在 4 组里同权重平铺（侧栏更是塞进 80px 窄栏、
  55vh 滚动），人只能逐个读字找功能。现：顶部搜索（标题 + id + 同义词、多关键词 AND）、
  「最近使用」（本地 6 条、不预设置顶）、分组默认只展开第一组；侧栏与移动底栏的「工作台」
  不再内联展开 30 项抽屉，统一落到 `/workbench` 整页目录（一处工作面）。
- ✅ **分组 4 → 6、每组 ≤6 项** - Agent 与自动化 / 模型与能力 / 接入与凭据 / 可观测与安全 /
  内容与媒体 / 个人；终端归「能力」、后台任务归「观测」、语音测试归「内容与媒体」。
  6 个原本借用 `settings.*` 命名的入口（权限 / API 密钥 / OAuth / 日志 / 沙箱 / 安全概览）
  收回工作台命名；新增结构不变量用例，防止"加一个入口把组撑回 9 项"。
- ✅ **收掉第二个工作台外壳（`/work`）** - 该页原用 9 个标签复用工作台目录**同一批页面组件**
  （`rules` 标签只是设置页自定义规则的适配器，`/plans` `/semantic` 早已重定向），且没有任何
  导航入口指向它。现只保留其独有能力（**工作项**：新建 / 列表 / 删除 / 进入规划），
  标签状态 store 与三个遗留文件一并删除。
- ✅ **设置 ↔ 工作台 同域互链** - 设置面板标题下新增「相关入口：X →」（模型管理 / 语音测试 /
  权限管理 / 用户中心 / 办公），点击先收起抽屉再跳转；设置里的「办公设置」改名「办公集成」
  以区分工作台的办公产品页。判定规则落盘到 `.trae/rules/frontend.md §4.4`（偏好 vs 实体）。
- ✅ **知识库删除后不再「复活」** - `DELETE /v1/knowledge/bases/:name` 返回 200 但列表仍在：
  删除只摘注册表条目、目录还留着，`listBases()` 的自动扫描又把它登记回来。现删除时把目录移入
  `.trash-bases/<name>-<ts>`（扫描跳过 `.` 开头目录，文档仍可人工恢复），且先移目录后改注册表，
  移动失败不留"删了一半"。
- ✅ **不存在的 `session_id` 返回 404** - `canUseSession()` 对本地身份恒 `true`，跳过存在性判断，
  使不存在的 id 被下游静默建造成新会话并回 200。现任何身份都要求会话确实存在
  （缓存 → 按身份分区存储），`session_id` **缺失**时仍按既有语义由下游建新会话。

> 本版为补丁版：工作台/设置导航重排（可搜、可收、一组 ≤6）并收掉重复工作面，另修 2 条后端契约缺陷（详见正文）。

#### v0.5.6 (2026-10-22)  供应商未就绪 fail-fast + 用量口径归一 + 帮助中心/关于页修正

- ✅ **供应商未就绪不再静默回落** - 模型有归属供应商、但该供应商未注册（凭据缺失被同步跳过 / 已停用）时，
  此前会把该模型名发给默认供应商，得到上游 400 又被折成「正常回复」（HTTP 200 假成功）；
  现于调用前抛 `AppError{CONFIGURATION, MEDIUM, AI_CRED_1001}`，非流式回 500 + 可操作文案
  （12ms、零上游调用），流式回 `__pyapp_error_code`。
- ✅ **用量落盘二次加固** - `UsageStatsService` 单例在首次 import 时固化库路径，测试期"先绑真实库、后换临时根"
  时第一道护栏会放行、每轮仍漏约 4 行；新增「实例路径 ≠ 当前解析路径 ⇒ 跳过」判据。
- ✅ **帮助中心「快捷键」分区修复** - 该分区此前把**默认收起的模态**当内联内容渲染（`open=false` 时 `return null`），
  只显示标题、列表恒为空；抽出纯展示的 `ShortcutList` 供模态与帮助页共用，真机复显 9 条。
- ✅ **i18n 缺键清理** - 静态扫描 4274 个 `t()` 键，补齐 zh/en 双双缺失的 16 处
  （`agent.legend` / `common.download` 等裸 key 上屏，及 `chat` / `office` 共 12 处英文环境回退中文）；
  新增「字典覆盖棘轮」用例防回流。
- ✅ **llama 体积展示去掉浮点噪声** - 后端 `_generateReason` 与前端推荐卡统一按「至多 1 位小数」渲染 GB，
  消除 `预计占用 4.470348358154298GB`。
- ✅ **用量记录按数据源归一模型名** - 用量/成本库此前把同一模型拆成多档：供应商 wire 名（`deepseek-flash`）
  因别名未解析被原样落库；调用方拿不到模型名时又写死 `unknown`（历史 2288 行、cost 走兜底价、事后无法还原）。
  现由 `model_registry.provider_mappings` 反查别名 → 规范 modelId，模型名缺失时回退响应体真实模型名。
- ✅ **关于 Liri 使用应用图标** - 卡片头部改为与顶栏 / favicon 同源的 `/liri_logo.png`（替换手绘渐变 "L" 占位块）。

> 本版为补丁版：修复供应商路由假成功、用量口径与展示面 3 类缺陷，并清理 16 处 i18n 缺键（详见正文）。

#### v0.5.5 (2026-10-22)  前端巡检缺陷修复（渠道凭据容错 / 工作空间作用域 / dev 代理边界 / 推荐卡标识 / 会话指针自愈 / 用量落盘护栏）

- ✅ **渠道凭据回显逐条容错** - 单条密文损坏不再把 `GET /v1/channels` 打成 500（此前渠道页统计全 0、仪表盘
  「消息渠道」指标失真）；坏字段经 `unreadableCredentialFields` 回报，前端提示「凭据不可读 — 请重填」；
  建立连接用的 `get()` 仍 fail-closed（绝不把坏凭据当空串发请求）。
- ✅ **Agent 高级管理只对项目工作空间查 Swarm** - 系统工作空间 id（如 `knowledge`）曾被当作后端 workspace 查询
  （`404 Workspace not found`，错误被 `.catch()` 吞掉、面板静默空白）；现按 `workspaceSource !== 'system'` 过滤，
  并为 Swarm / 模型绑定给出引导文案。
- ✅ **dev 代理边界修正** - Vite 的 `"/api"` 前缀匹配吞掉前端路由 `/apikeys`（直链/刷新返回后端 404 JSON 而非页面）；
  改为边界正则 `^/api(/|$)`，`/apikeys` 恢复 `200 + text/html` 与 SPA 渲染。
- ✅ **llama 推荐卡标识复合化** - 卡片 `key` 与下载中状态改用 `modelId:quantVersion`，消除「同量化多模型」
  重复 key 警告与"多卡同时显示下载中"；`isBestRecommendation` 改按元素身份，只标一个「最佳推荐」。
- ✅ **幽灵会话指针自愈** - 当前会话指针指向已删除会话时，回退最近会话后回写后端（`switch`），
  告警不再每轮重复出现。
- ✅ **测试期用量落盘护栏** - `NODE_ENV=test` 且调用方未显式隔离数据目录时 `trackUsage()` 不落盘
  （此前单测向真实库写入 `fake-model` / `test-provider` / `mock` 共 45.9 万行，已备份后清理）。
- ✅ **回归用例** - 新增/扩展 6 组：渠道凭据容错、用量护栏判据、工作空间作用域接线、代理边界配置棘轮、
  推荐卡渲染（重复 key 断言）、会话指针回写（含负向）。

#### v0.5.4 (2026-10-22)  服务端多租户闭环 + 内核瘦身/启动面门禁 + 变体矩阵落地

- ✅ **服务端多租户 P0–P5 闭环** - 请求级 `Principal{tenantId,userId,roles}` 贯穿会话 / 工具 / 事件；
  存储按 `tenants/<tenantId>/users/<userId>/` 分区（会话、核心库、检查点、审批 Inbox、黏性路由、
  余额、结算台账、知识图谱、查询日志、LLM 记录）；SSE 按请求身份投递、登录态变更重建连接；
  工具 cwd / 沙箱默认工作区 / AlwaysOn 配额 / 放行缓存 / 待交互条目均按归属判定。
  租户从"恒为 local"变成**账号属性**（认证链 + `LIRI_TENANT_SELF_REGISTER` 开关，请求不自报），
  并补管理员端点：建号 / 迁移 / 解绑 / 删租户时解绑其账号（不留悬空身份）。
- ✅ **删租户（purge）全量清除闭环** - 顺序固定为「断流 → 关连接 → 清共享库归属行 → 删分区目录」；
  按身份缓存的 SQLite 实例统一登记进 `scopedResources`（13 处接线，closer 一律"关连接 + 摘除自身缓存"），
  真机 `blocked=1 → 0`；非 DB 缓存逐类失效（凭据实例 / 会话存储实例 / 成本桶 / 自主运行配额 /
  分析埋点与工具桶 / trace 统计桶）；每循环的 TAOR 检查点库收尾即关；`ResumeManager` 的存储按请求身份
  解析；**启动期按身份**扫待恢复检查点（不再只扫宿主库）；`notPurged` 里可清的项已收回，剩下的是无归属
  索引的全局文件面与用户级目录（需数据模型改动）。
- ✅ **内核瘦身与启动面门禁** - chronos / memory 惰性加载（eager 673 → 543 → 419 → 280，P3 后 monitoring
  barrel 不再静态转发 OTel），17 个纯记账模块降级 `ON_DEMAND`；新增 `lint:startup-graph`（启动面字节棘轮）、
  `lint:critical-modules`（CRITICAL 清单棘轮）、`lint:kernel-surface`（内核面白名单）三道门禁，另加架构边界
  双规则门禁（W2 分层循环 / W4 工具面自审）。
- ✅ **变体矩阵与编译期裁剪** - 变体矩阵收敛为单一事实源；`DROP_CHANNELS_ALL`（整组）/ 单通道开关
  （**均未声明即全量，默认零行为变更**），实测整组产物 −16.7%；core 变体收敛为 7 个工具、headless 变体
  （物理剔除 ink/REPL）、`build:win:enterprise` 编译入口；企业版 `.hbs` 模板随产物分发（模板根按
  源码 / bundle / compile 三形态解析）；分发前置落地动态端口顺延 + 实例锁 + `.env` 只写用户级。
- ✅ **移动端通道（P2.5）** - 入站 `POST /v1/channels/mobile/messages` 走单管线（帧验证 / 去重 / DM 策略 /
  Inbox 桥接）、设备配对 + 短期 token、入站与配对审计留痕、卡片出站；工具面硬约束为 `messaging`。
- ✅ **治理与观测** - 语义护栏便宜版（只读意图 + 变更动作升级审批）、严格重放默认开
  （`PREPARED_SNAPSHOT_REPLAY=true`）、只读时间旅行端点 `timeline?untilSeq`、上下文压缩升级判据（默认关）、
  SWARM 会话级并发批次键（事件按批次配对不再串线）、Trace/Analytics 内存累计按身份分桶。
- …（本版区间 `git log v0.5.3..v0.5.4` 共 **93** 条实质提交，以上为精炼摘要）

- 🔧 **编译期裁剪机制（P1-0 / P1-pre / 通道侧收口，默认零行为变更）** - `ChannelCatalog` 支持三层反向开关：
  `DROP_CHANNELS_ALL`（整组）/ `DROP_CHANNEL_FEISHU`（单通道）/ 均未声明（全量，**默认行为不变**）；
  同时拆除 `channels/index.ts` 中 25 个通道实现的再导出（11 个引用方均只用 registry / 类型 / 常量，零消费者）。
  **产物验收**：默认 46.61 MB → 单飞书 **39.89 MB（−14.4%）** → 整组 **38.85 MB（−16.7%）**；
  通道目录 44→20，`@larksuiteoapi` 6.39 MB 归零。
  **结论**：通道侧收益已收口（整组仅比单飞书多省 1.04 MB），剩余空间在工具侧。

- ✅ **主动消息可投递到 IM 通道（U-01 方案 A）** - 新增 `proactive.target.channelId` + `proactive.target.conversationId`
  配置：**两者同时非空**才把 Cron / AlwaysOn 的完成通知经 `DeliveryRouter` 发到该通道，否则维持通知中心
  （零意外外发）。目标解析收敛为单一纯函数，两处生产者共用；空串/空白/非字符串一律按未配置处理。

- ✅ **AlwaysOn 接入 snapshot-copy 回退** - git-worktree 不可用（非 git 仓库 / 工作区脏）时改用目录快照隔离
  （`<data>/alwayson/snapshots/<runId>`，排除 `.git`/`node_modules`/`dist` 等，>1 GiB 拒绝），
  解决这类项目"每轮跳过 ⇒ AlwaysOn 不可用"的盲区；该模式无 git 语义、不自动回灌 ⇒ 隔离区一律保留，
  报告改为 `Diff` / `Snapshot Kept` 并指路取改动。开关 `ALWAYSON_SNAPSHOT_FALLBACK` 默认开。

- ✅ **AlwaysOn 目标达成自评** - 每轮执行收尾后由宿主注入的 `evaluateGoal` 做一次**只读**模型调用，
  三值判定 `achieved / not_achieved / unverified` 写入报告与主动通知（`Goal Achievement` 行）。
  证据只取「计划 + 执行输出 + 错误 + 工具调用数 + 补丁字节」，prompt 明令禁止调工具/读文件
  （本轮改动只在隔离区且未 apply，读仓库会误判为"没改"）；解析失败/非法取值/异常/预算锁定
  一律 `unverified`（`source` 标注原因），不臆造达成；未达成只如实报告，不自动重试。
  开关 `ALWAYSON_GOAL_EVAL` 默认开（回退 `FEATURE_ALWAYSON_GOAL_EVAL=false`）。
  顺带修复：执行收尾后会话 cwd 复位到项目根（原会悬空指向已删 worktree）。

- ✅ **轮次 USD 前置判定默认开启** - `FEATURE_USD_TURN_PREFLIGHT` 由 `false` 改为 `true`（2026-10-20 用户裁定「开启」）：
  金额轨在发模型前按「当前模型价 × 本轮估算（含附件折 token）」预判，`已结算 + 本轮估算 > 上限` 即短路拒发
  （`DAILY_BUDGET_EXCEEDED`，先释放预扣）⇒ 覆盖 2026-10-15「金额轨无本轮预估」口径，消除单轮穿透上限；
  灰度回退：`FEATURE_USD_TURN_PREFLIGHT=false`。

---

#### v0.5.3 (2026-10-20)  AlwaysOn v2 worktree 隔离 + 预算防穿透 + 状态字面量 Register-or-Fail 门禁

- ✅ **AlwaysOn v2（worktree 隔离闭环）** - 执行前 `GitWorktreeProvider` 隔离（`refuseDirty`，脏仓/非 git 跳过本轮），
  会话 `metadata.workspacePath` 按轮指向隔离区 + `workspaceStrict` 严格路径边界（越界拒绝，与 LRO 同一判据）；
  `alwayson` 命名空间独立于 Bridge，启动期回收已注册残留；产物只留补丁
  （`<data>/alwayson/reports/<runId>.patch`，**不自动 apply**），未回灌即保留隔离区（`keptIsolation`）；
  报告显式标注 Patch / Worktree Kept / `Goal Achievement: unverified`；v1.2 先行落了 `alwayson_discovery` 专用任务类
- ✅ **预算防穿透（外部建议 ②）** - 新增**轮次 USD 前置判定** `turnUsdPreflight`（纯函数 + `preSend` 接线），受 `FEATURE_USD_TURN_PREFLIGHT`（**默认 false ⇒ 零行为变更**）门控；开启后 `已结算 + 本轮估算（含附件折 token）> 上限` 即短路拒发（同 `DAILY_BUDGET_EXCEEDED`，先释放预扣）
- ✅ **状态字面量棘轮门禁（外部建议 ⑦ Register-or-Fail）** - 新增 `lint:state-ratchet` 并接入 `ci`：词汇表单一事实源 = `stateMachineCatalog`（34 值，含 `requires_approval`/`awaiting_approval` 瞬态），扫描 `app/src` 字符串字面量，未报备 (value,file) ⇒ CI 阻断；现存 1795 对收编基线（只拦增量、零误报），端到端证伪通过
- ✅ **蜂群批次落编排历史** - `PARALLEL_START/END` 补 `sessionId` 载荷并进历史白名单（此前只上 SSE、不落盘，离线观测缺蜂群段）
- ✅ **snapshot-copy 扫雷** - `runAutonomousTask` 修复"未回灌却删隔离区"：占位 diff / publish 抛错 ⇒ `dispose(keep:true)` 保留现场
- ✅ **订正** - `executionProjection.ts`「SUSPENDED 尚未实现」失实注释（生产者 = `query/budgetSuspend.ts:186`）
- ✅ **回归** - 全链 `bun run ci` exit 0：**7488 pass / 45 skip / 0 fail**（7533 tests / 868 files）；`lint:arch` 0 违规

#### v0.5.2 (2026-10-20)  AlwaysOn v1.1：处理方案 §9 五项已知偏差

- ✅ **主动通知**：报告写盘后入主动队列（`kind='task_result'`、去重键 `alwayson:<planId>`、成功 `low` / 失败 `normal`），复用同一门禁（DND/冷却/限流）。
- ✅ **工具面收窄**：discovery 走 `metadata.taskType='messaging'`（只读面，不含 file/shell/code/mcp 等写与执行类），execution 走 `'coding'`。
- ✅ **超时真正中止**：改用 `streamMessage` + `AbortSignal`，超时 `abort()` 底层请求并记 `timeout: Nmin`（原仅标记失败）。
- ✅ **会话跨重启复用**：`~/.pyapp/data/alwayson/sessions.json`（projectId → sessionId），无记录才新建并回写。
- ✅ **多工作空间**：项目来源改为 `WorkspaceRegistry.listAll()` + `default`，按项目 id 去重。
- ✅ **回归**：`alwaysOnMinimal.test.ts` 12 → 17 例（会话复用/新建、taskType 收窄、超时 abort、通知投递）。
- ⚠️ **v2 遗留**（方案 §9 末尾登记）：`messaging` 面非严格只读（含 session/channel 类）、worktree 隔离、目标达成自评。

#### v0.5.1 (2026-10-20)  工具治理收口（出参结构全量声明 / send_message 接线）+ 主动汇报默认开启 + 无人值守自动通过 + AlwaysOn 最小可用自主执行

- ✅ **U-03 出参结构（第 19~21 批）**：`outputJsonSchema` 契约扩展支持**数组**与**标量**（string/number/boolean）；media 其余 8 个工具补 `data` 并声明；`notebook` 分支归一后并集声明；`brief` / `nodes` / `file_convert` 收尾 —— 生效面 **54 个工具** + media 15 个 + `knowledge_snapshots` 已声明。
- ✅ **U-03 D5 能力棘轮**：`extends BaseTool` 有 `TOOL_EFFECTS` 条目即视为已声明（用户裁定）；判据补识别字段初始化器写法；基线 **61 → 11**。
- ✅ **U-03 `send_message` 接线**：`SEND_MESSAGE` 默认 `false → true`（生效面 **77 → 78**），补 `TOOL_EFFECTS` 与标量出参声明；参数/描述资源与 en-US 译文同步。
- ✅ **U-01 主动汇报默认开启**：`PROACTIVE: false → true`（回退 `FEATURE_PROACTIVE=false`）。
- ✅ **U-02 无人值守阶段审批自动通过**：`UNATTENDED_MODE` 下两条编排链共用自动答复 + `interaction_auto_answered` 审计；开关默认关 ⇒ 普通交互零变化。
- ✅ **U-02 AlwaysOn 最小可用自主执行 v1**：计划解析（高风险放弃）+ 四阶段桥接（依赖注入）+ 启动接线（项目注册 / 门禁开启 / `manager.start()`）；新 flag `ALWAYSON` 默认开。v1 偏差（worktree 隔离 / 主动通知 / 只读收窄 / 超时中止）见 `dev_docs/20261020/AlwaysOn-最小可用自主执行-方案.md` §9。

#### v0.5.0 (2026-10-18)  多批次治理收口：提示词资源链 / 编排可观测 / 通道与硬编码治理 / 长程任务修复

- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-74**：调度检查间隔收敛为 types 单一事实源 —— 验证 tc0|arch0；基线 改前 DreamScheduler 与 archivalCronTask 各定义 CHECK_INTERVAL_MS=60s（基线 173 键）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-74）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-72-73**：按域消歧 DEFAULT_MAX_ENTRIES / MAX_RECORDS —— 验证 tc0|arch0；基线 改前两对同名常量语义/取值不同（200 vs 500、50 vs 1000）；基线 175 键（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-72-73）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-70-71**：缓存容量 + SSL 错误码收敛到单一事实源 —— 验证 tc0|arch0；基线 改前 READ_FILE_STATE_CACHE_SIZE/SSL_ERROR_CODES 各定义 2 份（基线 177 键）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-70-71）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-69**：媒体根目录三常量收敛为 core 单一事实源 —— 验证 tc0|arch0；基线 改前 IMAGES/MEDIA_IMAGES/ATTACHMENTS_ROOT 各定义 2 份（基线 180 键）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-69）
- ✅ **ARCH-R03-002-SKILLS-SECURITY-CLOSE**：D-3-c 批次⑥⑦ + 结项（11 收口 / 5 保留） —— 验证 tc0|arch0；基线 改前 skills 3 键 + security 4 键走叶子直连；其余 5 键无复核日（详情见 archive/evidence-detail.jsonl#ARCH-R03-002-SKILLS-SECURITY-CLOSE）
- ✅ **FILE-SIZE-EXCEPTION-REFRESH**：文件尺寸例外实测基线刷新 + U-22 拆分计划 —— 验证 doc-only；基线 改前例外 lines 字段与实际（5922/3060/…）漂移（详情见 archive/evidence-detail.jsonl#FILE-SIZE-EXCEPTION-REFRESH）
- ✅ **ARCH-R03-002-SECURITY-ENTRIES**：security patterns/redact 子入口收口（D-3-c 批次⑤） —— 验证 tc0|arch0；基线 改前 patterns/redact 仅类型入桶，统一规则集与脱敏中间件走叶子直连（详情见 archive/evidence-detail.jsonl#ARCH-R03-002-SECURITY-ENTRIES）
- ✅ **STATE-PROJECTION-4-3-UW**：状态机 4.3 统一出站管道 UW 口径与触发条件 —— 验证 doc-only；基线 改前只写「暂缓 ⇒ UW」，缺重开触发条件（详情见 archive/evidence-detail.jsonl#STATE-PROJECTION-4-3-UW）
- ✅ **ORCH-SNAPSHOT-CAPABLE-ASSESS**：Council/PDCA 接入 ISnapshotCapable 评估（不接入） —— 验证 doc-only；基线 改前方案要求导出可选接口，未评估消费者与持久化语义（详情见 archive/evidence-detail.jsonl#ORCH-SNAPSHOT-CAPABLE-ASSESS）
- ✅ **ARCH-R03-002-TOKENBUDGET-ENTRIES**：tokenBudget 子入口收口（D-3-c 批次④） —— 验证 tc0|arch0；基线 改前 tokenBudget 两键子路径直连，桶未导出叶子（详情见 archive/evidence-detail.jsonl#ARCH-R03-002-TOKENBUDGET-ENTRIES）
- ✅ **SESSION-BUDGET-PHASE-C**：会话预算阶段 C（续跑状态 + 交接单/成本度量脚本） —— 验证 tc0|arch0；基线 改前 SB06/SB07 仅有规范，无状态文件与生成脚本（详情见 archive/evidence-detail.jsonl#SESSION-BUDGET-PHASE-C）
- ✅ **PDF-CANVAS-OPTIONAL-DEP**：@napi-rs/canvas 可选依赖 + 缺依赖可执行报错 —— 验证 tc0|arch0；基线 改前依赖未声明，缺失时抛裸 Cannot find module（详情见 archive/evidence-detail.jsonl#PDF-CANVAS-OPTIONAL-DEP）
- ✅ **TOOL-READ-OUTPUT-FALLBACK-FASTPATH-UI**：read_project_file 回读 output/ 兜底 + fast-path 设置 UI —— 验证 tc0|ut4|arch0；基线 改前裸名回读 output/ 恒 not-found；fastPath 无设置 UI（详情见 archive/evidence-detail.jsonl#TOOL-READ-OUTPUT-FALLBACK-FASTPATH-UI）
- ✅ **CHANNEL-ATTACHMENT-MIME-POLICY**：入站附件 MIME 分类与单附件/条数上限 —— 验证 tc0|ut9|arch0；基线 改前非图像附件无 MIME 分类与上限，超大附件直接抬高预留（详情见 archive/evidence-detail.jsonl#CHANNEL-ATTACHMENT-MIME-POLICY）
- ✅ **LRO-WORKSPACE-SYMLINK-ESCAPE**：workspace 守卫补符号链接真实路径判定 —— 验证 tc0|ut2|arch0；基线 改前仅词法判定，workspace 内链接指向外部可绕过（详情见 archive/evidence-detail.jsonl#LRO-WORKSPACE-SYMLINK-ESCAPE）
- ✅ **STREAM-API-MESSAGES-BUILD**：apiMessages 构建段外移为内层 generator —— 验证 tc0|ut3|arch0；基线 改前构建段内联 97 行，runStreamMessage 2218 行（详情见 archive/evidence-detail.jsonl#STREAM-API-MESSAGES-BUILD）
- ✅ **A2A-SIDECAR-KILL-TREE**：A2A sidecar 取消/超时进程树强杀 —— 验证 tc0|ut2|arch0；基线 改前 stop() 仅 child.kill()，超时/取消会留下孙进程孤儿（详情见 archive/evidence-detail.jsonl#A2A-SIDECAR-KILL-TREE）
- ✅ **BUDGET-WAIVER-USD-PRECHECK**：waive-once 放行前 USD 事务预检 —— 验证 tc0|ut5|arch0；基线 改前只有事后记账，放行轮无金额预占（详情见 archive/evidence-detail.jsonl#BUDGET-WAIVER-USD-PRECHECK）
- ✅ **DOCS-SECURITY-IMPORT-FIX**：API/开发文档失效导入修正 —— 验证 doc-only；基线 改前文档导入已删除的工厂，照抄必失败（详情见 archive/evidence-detail.jsonl#DOCS-SECURITY-IMPORT-FIX）
- ✅ **SECRET-SCANNER-NEW-PREFIXES**：秘密扫描补 OpenAI/Anthropic 新前缀 —— 验证 tc0|ut4；基线 改前仅旧 sk-...T3BlbkFJ 格式，新前缀漏检（详情见 archive/evidence-detail.jsonl#SECRET-SCANNER-NEW-PREFIXES）
- ✅ **CHANNEL-QUESTION-ANSWER-STAGE2**：渠道交互提问 Stage 2（下一条消息即答案） —— 验证 tc0|ut15|arch0；基线 改前渠道 question 只能 fail-closed；无法把下一条消息作为答案（详情见 archive/evidence-detail.jsonl#CHANNEL-QUESTION-ANSWER-STAGE2）
- ✅ **TASK-GHOST-GRACE-CONFIG**：ghost 宽限期读取改走 ConfigManager —— 验证 tc0|ut5|arch0；基线 改前直接 process.env 读取，触发 R05-012 警告（详情见 archive/evidence-detail.jsonl#TASK-GHOST-GRACE-CONFIG）
- ✅ **STREAM-FALLBACK-DEDUPE**：已分类失败不再落通用 fallback —— 验证 tc0|ut1；基线 改前所有零产出失败都落通用 fallback，与 error chunk 重复（详情见 archive/evidence-detail.jsonl#STREAM-FALLBACK-DEDUPE）
- ✅ **MIGRATOR-READ-FAILURE-SPLIT**：迁移空文件/读取失败告警拆分 —— 验证 tc0|ut5；基线 改前空文件与读取失败共用一条告警，无法区分 disk-behind/权限（详情见 archive/evidence-detail.jsonl#MIGRATOR-READ-FAILURE-SPLIT）
- ✅ **BUDGET-DIMINISHING-PROGRESS**：收益递减纳入工具结果/产物维度 —— 验证 tc0|ut3|arch0|size0；基线 改前只按 Token 增量判定，工具有效推进但 Token 低会被误停（详情见 archive/evidence-detail.jsonl#BUDGET-DIMINISHING-PROGRESS）
- ✅ **LRO-STEP-CONSTRAINTS-WORKSPACE**：LRO 步骤硬约束 + 工具路径 workspace 收敛 —— 验证 tc0|ut5|arch0；基线 改前步骤提示无禁问/禁管道/交付口径；LRO 工具可传绝对路径越界（详情见 archive/evidence-detail.jsonl#LRO-STEP-CONSTRAINTS-WORKSPACE）
- ✅ **CHANNEL-MESSAGEID-PASSTHROUGH**：渠道入站 messageId 透传 + 回答能力字段 —— 验证 tc0|ut1|arch0；基线 改前 Router 不传 messageId，后端自行生成 id（详情见 archive/evidence-detail.jsonl#CHANNEL-MESSAGEID-PASSTHROUGH）
- ✅ **CHANNEL-QUESTION-FAIL-CLOSED-TIMER**：渠道 question fail-closed + 占位独立定时器 —— 验证 tc0|ut5|arch0；基线 改前 question 只记日志；静默期占位判定在循环体内永不触发（详情见 archive/evidence-detail.jsonl#CHANNEL-QUESTION-FAIL-CLOSED-TIMER）
- ✅ **SEARCH-ROOT-SCOPE-EBUSY**：搜索根作用域系统目录跳过 + EBUSY 窗口聚合 —— 验证 tc0|ut14|arch0；基线 改前只跳构建目录；home 扫描深入 AppData 且 EBUSY 逐条上报（详情见 archive/evidence-detail.jsonl#SEARCH-ROOT-SCOPE-EBUSY）
- ✅ **LRO-GHOST-PLAN-HEARTBEAT**：TaskOrchestrator 同步加载 + ghost 心跳宽限 —— 验证 tc0|ut5|arch0；基线 改前 void initialize() 与创建交叉；pending 无活跃步骤即被 abort（详情见 archive/evidence-detail.jsonl#LRO-GHOST-PLAN-HEARTBEAT）
- ✅ **LRO-PLAN-PARSE-ADMISSION**：Planner 计划解析 fail-closed + 准入/零产出硬停止 —— 验证 tc0|ut17|arch0；基线 改前 JSON.parse 失败按行切前 10 行；坏计划只会跑到轮次上限（详情见 archive/evidence-detail.jsonl#LRO-PLAN-PARSE-ADMISSION）
- ✅ **ARCH-BRL002-BARREL-EXPORTS**：CLI handlers barrel 去重（30→10），移除 BRL-002 例外 —— 验证 tc0|arch0；基线 改前 30 行 export，超 R06-010 上限 20，依赖 2026-10-31 到期例外（详情见 archive/evidence-detail.jsonl#ARCH-BRL002-BARREL-EXPORTS）
- ✅ **CHANNEL-FILE-CONTENT-DEDUPE**：出站附件按内容 MD5 去重 + 契约禁「为投递而复制」—— 修重复附件 —— 验证 ut3|tc2|ts6712；基线 改前：同一 test.md 被写到项目 output 与 ~/.pyapp/output 并都写进正文 ⇒ 用户收到两个同名附件（详情见 archive/evidence-detail.jsonl#CHANNEL-FILE-CONTENT-DEDUPE）
- ✅ **FILE-WRITE-RESOLVED-PATH**：写入回执给实际绝对路径 + 出站提取认 `~/`（修「写了却发不出」） —— 验证 ut7|tc2|ts6709；基线 改前：file_write 只回显相对入参 ⇒ 模型以为在 ~/.pyapp/output，正文写该路径；文件实际在工作区根 ⇒ 候选 0（详情见 archive/evidence-detail.jsonl#FILE-WRITE-RESOLVED-PATH）
- ✅ **CHANNEL-DELIVERY-CONTRACT**：通道入站注入投递契约（按请求）：附件自动投递、模型不得臆断发送状态 —— 验证 ut8|tc2|ts6702；基线 改前：模型无投递事实源 ⇒ 两次臆断（「附件还没发出」/ 编造 broadcast send 返回 false），文件均随后送达（详情见 archive/evidence-detail.jsonl#CHANNEL-DELIVERY-CONTRACT）
- ✅ **QQ-FILE-UPLOAD-FILE-NAME**：QQ 二进制上传补 file_name（官方必填）—— 修附件气泡显示「未命名」 —— 验证 e2e1|ut1|tc1|ts6694；基线 改前：只发 file_type+file_data ⇒ QQ 拿不到文件名，9,444 字节的报告显示「未命名」（详情见 archive/evidence-detail.jsonl#QQ-FILE-UPLOAD-FILE-NAME）
- ✅ **CHANNEL-RELIEF-CARD-COPY-DEDUPE**：预算挂起收尾去重：发卡成功不再重复发文本；纯文本兜底去 Markdown 星号 —— 验证 ut8|tc1|ts6694；基线 改前：真机同一条「已挂起 + 出路」发了两遍（文本 ⏸ + 卡片），且纯文本里 ** 星号明文（详情见 archive/evidence-detail.jsonl#CHANNEL-RELIEF-CARD-COPY-DEDUPE）
- ✅ **COREAPI-FINISH-REASON-BUDGET-SUSPEND**：修 chatStream 出口把终止原因降级为 stop（回落读 metadata） —— 验证 e2e3|ut5|tc1|ts6686；基线 改前：出口只读顶层 finishReason ⇒ budget_exhausted 变 stop ⇒ 通道发卡判据永不成立（详情见 archive/evidence-detail.jsonl#COREAPI-FINISH-REASON-BUDGET-SUSPEND）
- ✅ **BALANCE-WARN-PERSIST**：余额告警闸门落盘：跨进程重启不重复刷（查询成功即清除，保留状态变化上报） —— 验证 e2e3|ut10|tc1|ts6681；基线 改前：闸门仅进程内 ⇒ dev 每次存盘重启后又刷一条（真机实测一轮编辑触发 3 次重启）（详情见 archive/evidence-detail.jsonl#BALANCE-WARN-PERSIST）
- ✅ **BALANCE-WARN-DEDUPE**：余额查询的持续性告警收敛为只记一次（进程内闸门 + 恢复即清记忆） —— 验证 e2e3|ut5|tc1|ts6676；基线 改前：同一持续性故障（SiliconFlow /user/info 已被官方下线）每轮轮询重复刷同一 warning（真机 00:32、00:51 各一条，无限重复且零新信息）（详情见 archive/evidence-detail.jsonl#BALANCE-WARN-DEDUPE）
- ✅ **QQ-FILE-OUTBOUND-ELIGIBILITY**：QQ 出站文件「可外发资格」收窄：交付面内 或 本轮新产出，其余静默忽略 —— 验证 ut10|tc1|ts6671；基线 改前：资格=存在+非禁区 ⇒ 回复正文回显任一既有路径即被当投递意图（真机连续两条消息各误触发一次）（详情见 archive/evidence-detail.jsonl#QQ-FILE-OUTBOUND-ELIGIBILITY）
- ✅ **QQ-FILE-UPLOAD-MEDIA-PAYLOAD**：QQ 文件外发口径订正：上传改 JSON（file_data/url）+ 发送改 media.file_info —— 验证 e2e1|ut5|tc1|ts6661；基线 改前：上传用 multipart + 字段 file ⇒ 真机 400；发送还用 media.file_uuid（文档要求 file_info）（详情见 archive/evidence-detail.jsonl#QQ-FILE-UPLOAD-MEDIA-PAYLOAD）
- ✅ **LOOP-BUDGET-COMPRESS-THEN-CONTINUE**：取证结论：'loop'（上下文窗口）预算的「先压缩再续跑」已由既有机制落地（对称记账退款 + 真实用量 + 每轮压缩 + 一次宽限轮）⇒ 不新增实现 —— 验证 read6|grep5；基线 搁置项原口径：'loop' 窗口预算撞顶即硬终止、需改为「先压缩再续跑」（疑似需解语义冲突）—— 取证后推翻：该行为已存在（且有四处单测钉住）（详情见 archive/evidence-detail.jsonl#LOOP-BUDGET-COMPRESS-THEN-CONTINUE）
- ✅ **CHANNEL-RELIEF-FEISHU-WEBHOOK-INTEG**：飞书 webhook 卡片回传的传输层验证：真起 HTTP 服务 + 真发 POST（200 / {toast} / 动作端口被调） —— 验证 integ5|tc1|ts6656；基线 改前：该路由的凭据只到纯函数单测（识别体式 + 造回执）；分支顺序/状态码/响应体三件事测不到 —— 若把通用 200 挪到卡片分流之前，单测全绿而真机必然超时（详情见 archive/evidence-detail.jsonl#CHANNEL-RELIEF-FEISHU-WEBHOOK-INTEG）
- ✅ **CHANNEL-RELIEF-FEISHU-INBOUND**：飞书卡片回传入站接线：两版回调体（card.action.trigger / 旧版扁平）→ 同一放行动作端口 + {toast} 回执；飞书加入按钮白名单 —— 验证 ut45|tc1|ts6651；基线 改前：飞书出站按钮已实现但入站只处理消息事件（长连接/webhook 两条路都无卡片回传分支）⇒ 白名单只有 qq，飞书只能收无按钮文案（详情见 archive/evidence-detail.jsonl#CHANNEL-RELIEF-FEISHU-INBOUND）
- ✅ **CHANNEL-RELIEF-BUTTON-GATE**：通道就地放行的按钮按白名单给：入站回调未接线的通道不得给按钮（防「点了没反应」的假按钮） —— 验证 ut26|tc1|ts6632；基线 改前：出站按 sendInteractive 能力给按钮，而入站回调只接了 QQ ⇒ 飞书等 11 个通道会给出「点了毫无反应」的按钮（用户以为按了、其实什么都没发生）（详情见 archive/evidence-detail.jsonl#CHANNEL-RELIEF-BUTTON-GATE）
- ✅ **CHANNEL-BUDGET-INLINE-RELIEF**：通道侧「就地放行」：预算挂起卡片（带按钮）+ 按钮回调入站动作（先做 QQ） —— 验证 ut24|tc1|ts6630；基线 改前：通道侧只有「发送被拦」一种文案；运行中被挂起时把桌面措辞当普通文本投递；入站零「一次交互→动作」通道；QQ 的 sendInteractiveMessage 把卡片拍平成 Markdown（详情见 archive/evidence-detail.jsonl#CHANNEL-BUDGET-INLINE-RELIEF）
- ✅ **BUDGET-SUSPEND-RESTART-IDEMPOTENT**：挂起事实的失效条件：修「已放行续跑过的会话每次重启又变回已挂起」（只认最新检查点 + 放行成功落已恢复标记） —— 验证 e2e1|ut4|tc1|ts6606；基线 改前：启动扫描扫全部检查点（find）且挂起标记无失效机制 ⇒ 已续跑过的会话每次重启/重载又被登记为「已挂起」（真机同一会话当日 10 次、用户被迫再点一次）（详情见 archive/evidence-detail.jsonl#BUDGET-SUSPEND-RESTART-IDEMPOTENT）
- ✅ **BUDGET-SUSPEND-DELETE-RELEASE**：会话删除/清空一并释放预算挂起协调器的内存登记：不再留「已删会话仍在挂起清单」的幽灵条目 —— 验证 e2e1|ut3|tc1|ts6602；基线 改前：删除仍挂起的会话只清检查点（磁盘），协调器内存登记不释放 ⇒ 真机实测删后挂起清单仍是 2 条（含已删会话）（详情见 archive/evidence-detail.jsonl#BUDGET-SUSPEND-DELETE-RELEASE）
- ✅ **BUDGET-SUSPEND-WAKE-SCOPE**：放行可带「唤醒收窄目标」：点一条会话的「继续」不再唤醒当日别的挂起会话 —— 验证 e2e1|ut7|cln634|tc1|ts6599；基线 改前：卡片「继续」走全局放行 ⇒ 协调器按挂起时间唤醒当日最多 3 条挂起会话（真机 woken:[用户的会话, 我的会话]），别的会话自行开跑并花钱（详情见 archive/evidence-detail.jsonl#BUDGET-SUSPEND-WAKE-SCOPE）
- ✅ **BUDGET-SUSPEND-CONTINUE-ENTRY**：补「预算挂起」后的继续入口：撞限卡两态化（挂起态主按钮=放行并自动续跑） —— 验证 e2e1|ut3|cln633|tc1|ts6592；基线 改前：撞限当时有卡片，挂起态却无入口 —— 没当场点继续、或重启/切会话后 errorCode 已不在内存，会话一直挂起却找不到继续按钮（详情见 archive/evidence-detail.jsonl#BUDGET-SUSPEND-CONTINUE-ENTRY）
- ✅ **BUDGET-EXHAUSTED-TERMINATION-COPY**：修预算耗尽收尾文案：按 kind（窗口预算/日限额）+ 是否已挂起三态区分 + 给可执行出路 —— 验证 ut4|ts907|tc1|ts6592；基线 改前：两种语义共用一句「已达到本轮 token 预算上限，工具链提前终止」；日预算已挂起可续跑时也这么说（详情见 archive/evidence-detail.jsonl#BUDGET-EXHAUSTED-TERMINATION-COPY）
- ✅ **TOAST-SINGLE-CHANNEL**：toast 收敛为唯一通道：KnowledgePage 摘除第二套 + 删除 hooks/useToast + 写明错误呈现口径 + 守卫 —— 验证 guard1|ut630|tc1|ts6630；基线 改前：toast 两套并行（store 与 hooks/useToast），KnowledgePage 同页两条通道、两种位置样式（详情见 archive/evidence-detail.jsonl#TOAST-SINGLE-CHANNEL）
- ✅ **CAPS-CAPABILITY-LOAD-FAILED-MSG**：补「能力加载失败」专用文案键：两组件如实报错（空态三态区分）+ 契约 ⑤ 钉住 —— 验证 ct14|ut629|tc1；基线 改前：加载失败时 CapabilitySelector 显示「暂无可用能力」、ModelMetaEditor 一片空白 —— 均把故障读成正常（详情见 archive/evidence-detail.jsonl#CAPS-CAPABILITY-LOAD-FAILED-MSG）
- ✅ **CAPS-CAPABILITY-PRESET-CLEANUP**：清理客户端伪造能力降级数据：删两处硬编码能力列表 + 硬编码默认能力 + 加防回流锁 —— 验证 ct13|ut629|tc1|grep2；基线 改前：加载失败即注入 10 项硬编码能力（28 项的部分副本、无 labelKey ⇒ 只能显示英文 fallback）（详情见 archive/evidence-detail.jsonl#CAPS-CAPABILITY-PRESET-CLEANUP）
- ✅ **CAPS-CAPABILITY-LABEL-CONVENTION**：能力标签解析修复：locale 的 model.capability 块上移为顶层 capability —— 验证 ct13|ut629|tc1|ts6628|probe1；基线 改前：28 个 labelKey 与 locale 的 model.capability.* 不匹配 ⇒ t() 恒 miss（详情见 archive/evidence-detail.jsonl#CAPS-CAPABILITY-LABEL-CONVENTION）
- ✅ **CAPS-CATEGORY-LABEL-SINGLE-SOURCE**：分类标签跨端单源：服务端 labelKey 补 model. 前缀 + 客户端删 4 处副本 + 契约 B4 —— 验证 ct12|ut629|tc1|ts6625；基线 改前：labelKey 缺 model. 前缀 ⇒ t() 恒 miss，客户端遂各自复制（含两处 categoryOrder）（详情见 archive/evidence-detail.jsonl#CAPS-CATEGORY-LABEL-SINGLE-SOURCE）
- ✅ **CAPS-CATEGORY-SINGLE-SOURCE**：收敛「能力分类」三处同名声明为单一真源（代码 CATEGORY_ORDER）；删除 YAML categories 死面 + 门禁 C5 改锚代码 —— 验证 gate1|ut14|ct9|ts6625；基线 改前：分类事实有三处声明（代码枚举 / 代码顺序表 / YAML categories 块——零读取者）；改后：单一真源 CATEGORY_ORDER（详情见 archive/evidence-detail.jsonl#CAPS-CATEGORY-SINGLE-SOURCE）
- ✅ **LINTCAPS-C6-COVERAGE**：补 lint:capabilities 的 C6 覆盖面：分类 key 唯一性 + sortOrder 缺失明确报「缺少」，不再退化成「undefined 重复」 —— 验证 gate1|ut14|tc1|pf1；基线 改前：C6 漏查分类 key 重复；且 sortOrder 缺失会被 String(undefined) 报成「undefined 重复」（真源字段齐全，两条均未触发）（详情见 archive/evidence-detail.jsonl#LINTCAPS-C6-COVERAGE）
- ✅ **FNSIZE-BASELINE-ACCEPT-GROWTH**：上调 fn-size 棘轮基线接受既有增长：runStreamMessage 2167→2218 / 文件 2345→2398（源自 2e757024b） —— 验证 gate3|grep2|read3；基线 改前：基线停在 65cf8b062（2026-10-11），而 2e757024b 已把该函数 +51 行 ⇒ HEAD 上 lint:fn-size 恒红（非本次改动引入）（详情见 archive/evidence-detail.jsonl#FNSIZE-BASELINE-ACCEPT-GROWTH）
- ✅ **LINTCAPS-CONSISTENCY-GATE**：新建 lint:capabilities 能力声明静态一致性门禁（C1–C7）+ 修 4 处废弃 token（code→coding） —— 验证 gate|ut12|tc1|grep1；基线 改前：code→coding 改名只落到 taskMappings，capabilities[].taskTypes 的 4 处遗留无门禁可查（详情见 archive/evidence-detail.jsonl#LINTCAPS-CONSISTENCY-GATE）
- ✅ **SESSION-ADAPTER-METADATA-BRIDGE**：旧链 metadata 桥（UnifiedStorageAdapter）取证：只透传 title/tags/mode 但无生产消费者 ⇒ 不补不删，钉注释 —— 验证 grep4|ut332|tc1|gate8；基线 改前：该桥的有损只在早先一片的 notes 里含糊记为「不在 P4 范围」，未区分「有损且有消费者」与「有损且无消费者」（详情见 archive/evidence-detail.jsonl#SESSION-ADAPTER-METADATA-BRIDGE）
- ✅ **LINTMODELS-TASK-EXEMPT**：lint-models 能力覆盖加「故意无模型」豁免表（task:capability 精确键 + 理由非空 + 豁免如实打印） —— 验证 tc1|probe4|gate13；基线 改前：已登记的 tts/stt 也会打进 ⚠️ 告警；改后：已登记项打 ⚪ 豁免（不计入告警），未登记者仍 ⚠️（详情见 archive/evidence-detail.jsonl#LINTMODELS-TASK-EXEMPT）
- ✅ **VOICE-TTS-STT-NO-MODEL-NEEDED**：排查结论：tts/stt 无需在模型管理里配模型（语音走独立子系统 + 该 taskMapping 无消费者） —— 验证 read1|probe1|gate1；基线 两条 ⚠️ 能力断链（task=tts/stt 各 0 个 enabled 模型）曾被读作「需要配模型」；实测为声明面遗留 + 语音链路不读模型表（详情见 archive/evidence-detail.jsonl#VOICE-TTS-STT-NO-MODEL-NEEDED）
- ✅ **LINTMODELS-CAPABILITY-WARN**：lint-models 能力覆盖：DB_PATHS 补真实数据目录（本地终于生效）+ 按裁定降为告警不阻断 —— 验证 tc1|probe2|gate7；基线 改前：DB_PATHS 两条都在仓库内 ⇒ 本机/CI 都查不到 DB，子检查形同不存在（且其发现会硬失败）（详情见 archive/evidence-detail.jsonl#LINTMODELS-CAPABILITY-WARN）
- ✅ **LINTMODELS-DB-EXISTS-PROBE**：lint-models 的 DB 存在性判断改 existsSync（原 readFileSync 整读文件且漏判空文件） —— 验证 tc1|probe2|gate7；基线 修前：try { if (readFileSync(full,utf-8)) … } catch {} —— 用整读文件当存在性判断（真实 DB 129MB/次），空文件会因空串为假被漏判（详情见 archive/evidence-detail.jsonl#LINTMODELS-DB-EXISTS-PROBE）
- ✅ **LINTMODELS-CAPABILITY-SCOPE**：lint-models 能力覆盖子检查定性为「语义本地专属，CI 永不适用」+ 修「跳过被说成通过」的措辞 —— 验证 probe1|tc1|gate7|ci0；基线 修前：无 DB 时输出「✅ 能力覆盖检查通过（DB 未找到，跳过）」+ 汇总「结果：PASS」⇒ 把未执行显示成通过（详情见 archive/evidence-detail.jsonl#LINTMODELS-CAPABILITY-SCOPE）
- ✅ **CI-GATES-LOCAL-SET-EXPAND**：7 项本地门禁接入 CI（unref/script-refs/mock/no-module-mock/legacy-env/models/tool-schema）；lint:case 未纳入 —— 验证 ci8|gate7|tc0；基线 接入前：CI 覆盖约 20 项，下列 7 项只在 app/package.json 的 ci 聚合脚本（本地全链）里 ⇒ 本地绿、CI 不拦（详情见 archive/evidence-detail.jsonl#CI-GATES-LOCAL-SET-EXPAND）
- ✅ **LINTEXIT-CI-WIRING**：把 lint:exit 补进 CI（static-check 新步骤）+ 订正上一片「同族门禁不在 CI」的错误陈述 —— 验证 ci1|exit46|tc0|gate7；基线 订正前的前提：以为 lint:consts/locale/endpoints/failmsg-refs/... 同样不在 CI；复核发现 CI 实际覆盖约 20 项，它们都在（详情见 archive/evidence-detail.jsonl#LINTEXIT-CI-WIRING）
- ✅ **LINTEXIT-RATCHET-RETURN-CODE**：lint:exit 治本：ratchet() 改返回退出码，出口移回 5 个入口（fail-closed 已实证） —— 验证 tc1|exit46|gate7|probe5；基线 治本前：退出发生在 lib 的 ratchet() 内，入口无 exit 记号 ⇒ 上一片只能用入口兜底行（详情见 archive/evidence-detail.jsonl#LINTEXIT-RATCHET-RETURN-CODE）
- ✅ **LINTEXIT-ENTRY-EXPLICIT-EXIT**：修 lint:exit 的 5 处误报：入口补兜底显式收尾（实退由 ratchet() 承担） —— 验证 tc1|exit46|gate7；基线 修前 lint:exit 红：5 个入口脚本文本内无 exit，真实退出发生在 lib 的 ratchet() 内（详情见 archive/evidence-detail.jsonl#LINTEXIT-ENTRY-EXPLICIT-EXIT）
- ✅ **APPCLEAN-ONEOFF-FILES**：app/ 顶层一次性文件清理（17 个：零引用脚本/日志/产物/2B 残留 + 10.5MB src.zip）+ 补 7 条产物忽略规则 —— 验证 tc1|gate7；基线 清理前：app/ 顶层混有 6 个 ad-hoc 调试脚本、1 个指向不存在路径的死 bat、3 个日志、5 个产物与 10.5MB src.zip（详情见 archive/evidence-detail.jsonl#APPCLEAN-ONEOFF-FILES）
- ✅ **TOOLVIS-P4B-PROPOSE-PLAN-RETIRE**：propose_plan 下线：审批入口合并到 ask_user_question（生成物 78→77、声明面 90→89、差额集仍 12） —— 验证 tc1|ut1489|gate6；基线 下线前：propose_plan 已由 P4b 接线（78 名、interaction 类别、PLAN flag 门控），与 ask_user_question 同为审批入口（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-PROPOSE-PLAN-RETIRE）
- ✅ **ROOTCLEAN-REPORTS-INTO-DEV_DOCS**：根目录清零：7 篇被引用报告移入 dev_docs/ + 7 处引用路径同步（5 源码/测试 + 2 spec） —— 验证 tc1|doc2|gate6；基线 上一提交只清了零引用子集（7 篇）⇒ 被引用的 7 篇仍在根目录；本次原位移入 dev_docs 并改指引用（不删、留档不丢）（详情见 archive/evidence-detail.jsonl#ROOTCLEAN-REPORTS-INTO-DEV_DOCS）
- ✅ **TOOLVIS-P2-BOUNDARY-RULING**：P2 两条如实边界终局裁定「均不做」：flag-gated-off 归因（对象集 ≤3）+ on 对 conditional —— 验证 doc2|tc0|gate6；基线 首版仅理念性理由；本次量化：81 loader / 3 返回 null / 排除 12 名（9 个连 loader 都没有）⇒ 精确归因对象 ≤3，收益 < 成本（详情见 archive/evidence-detail.jsonl#TOOLVIS-P2-BOUNDARY-RULING）
- ✅ **TOOLVIS-P4B-INTERACTION-RULING**：propose_plan vs ask_user_question 终局裁定「保留两个」+ 补 ask_user_question 契约（真实现标记此前无守卫） —— 验证 tc1|ut1453|gate6；基线 裁定前记为「无异议即维持」的默认（未取得单独裁定）；复核后升格为终局裁定 + 三条重开触发条件（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-INTERACTION-RULING）
- ✅ **ROOTCLEAN-REPORTS-SCRIPTS**：根目录清理：CD01 取证推翻原清单（14 篇中 7 篇被引用），移出 7 篇零引用报告 + 删 2 个调试脚本 + 死规则 —— 验证 tc0|ut9|gate6；基线 原计划删 14 篇根级 .md + 3 脚本；CD01 实测 7 篇被引用（debug-long-task-interrupt.md 被 4 源文件 + 1 测试引用）⇒ 只做可证安全子集（详情见 archive/evidence-detail.jsonl#ROOTCLEAN-REPORTS-SCRIPTS）
- ✅ **TOOLVIS-P4B-TOOLPROFILE**：P4b 收口：toolProfile 写入口（PATCH meta 校验 + 落库 + 副本补字段） —— 验证 tc2|ut22|e2e3|gate6；基线 接线前只有读方无写方：handler 白名单不含 tool_profile ⇒ 传了被静默丢弃；两份 SessionMetadata 副本缺字段 ⇒ 落库/回读再丢一次（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-TOOLPROFILE）
- ✅ **QH2-CLIENT-TZ-SINGLE-SOURCE-GUARD**：修正过期的时区守卫（客户端单一真源后恒红） —— 验证 tc0|ut6606|gate4；基线 修前恒红：断言组件源码含 Asia/Shanghai 字面量，而客户端已改用 constants/locale 真源并禁止写死（详情见 archive/evidence-detail.jsonl#QH2-CLIENT-TZ-SINGLE-SOURCE-GUARD）
- ✅ **TOOLVIS-P4B-SEND-MESSAGE-SKIP**：P4b 第 4 项裁定：send_message 保持默认关闭（有意不做，零行为变更） —— 验证 doc2|gate3；基线 裁定前：send_message 属 D 类（loader + 类别 notify 已就绪，仅缺 SEND_MESSAGE flag 默认值）；裁定：保持默认关闭 ⇒ 不改代码（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-SEND-MESSAGE-SKIP）
- ✅ **TOOLVIS-P4B-PDF**：P4b 接线③：pdf 转生效工具（生成物 77→78）+ 收口 extract/info 两个假成功分支 —— 验证 tc1|ut887|e2e3|gate3；基线 真机：接线前 pdf = conditional+misc；接线后 registered+doc（default 可见，与 doc_generate 同档）；extract/info 由假成功改为 fail-closed（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-PDF）
- ✅ **TOOLVIS-P4B-PROPOSE-PLAN**：P4b 接线②：propose_plan 转生效工具（生成物 76→77，conditional 14→13） —— 验证 tc1|ut1436|e2e3|gate3；基线 真机：接线前 conditional+misc，接线后 registered+interaction（default 可见、coding 不可见，与 ask_user_question 逐项同档）（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-PROPOSE-PLAN）
- ✅ **TOOLVIS-P4B-TASK-OUTPUT**：P4b 接线①：task_output 转生效工具（生成物 75→76，conditional 15→14） —— 验证 tc1|ut884|e2e4|gate5；基线 真机：接线前 conditional+misc，接线后 registered+task（default 不可见、coding/agent 可见）（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4B-TASK-OUTPUT）
- ✅ **TOOLVIS-P4A-EVAL**：15 个影子工具逐条评估（接线 3 / 保持条件化 12 / 删除常量 0）+ 两条口径纠正 —— 验证 doc2|gate5；基线 评估前：15 个统一按「E 类实现了但没接线」叙述；实测 14 个无 loader（E 类）、send_message 有 loader+flag（D 类），且 12 个的 execute 为空壳/桩（不可直接接线）（详情见 archive/evidence-detail.jsonl#TOOLVIS-P4A-EVAL）
- ✅ **TOOLVIS-P3-PANEL**：工具可见性设置页：三态覆写 + 原因徽标 + 高风险二次确认（另修真机暴露的抽屉不可达与保存后须刷新） —— 验证 tc2|ut37|e2e6|gate7；基线 真机：抽屉 tab 与 /settings?nav=tools 双路径渲染 90 条（可见 48 / 未接线 15）；computer_use 二次确认后无需刷新即转「已强制开启」；复验另暴露 BUG-1（桌面抽屉真机不可达）与 BUG-2（保存后须刷新）（详情见 archive/evidence-detail.jsonl#TOOLVIS-P3-PANEL）
- ✅ **TOOLVIS-P2-OVERRIDES**：工具可见性三态覆写层（auto/on/off）：默认空表 ⇒ 逐元素恒等、零行为变更 —— 验证 tc1|ut18|e2e5|gate7；基线 真机 PUT 开 computer_use（此前 archived 且被裁）⇒ 报表 effective=visible + user-on-bypass；bash:off ⇒ hidden + user-off；非法值与未知名被丢弃；重放路径强制集不变（详情见 archive/evidence-detail.jsonl#TOOLVIS-P2-OVERRIDES）
- ✅ **TOOLVIS-P1-REPORT**：工具可见性报表：解释每个工具为什么不可见（只读、零行为变更） —— 验证 tc1|ut11|e2e6|gate6；基线 真机 GET /v1/tools/visibility 200 / 90 条：computer_use=archived、pdf=conditional、code 类随 taskType 改判；此前可见性从不外露（GET /v1/tools 仅注册表全量）（详情见 archive/evidence-detail.jsonl#TOOLVIS-P1-REPORT）
- ✅ **SIDEBAR-NARROW-AUTOCOLLAPSE-LEAK**：窄屏自动折叠不再写偏好、回宽屏恢复偏好，且 48px 折叠栏 hover 真正展开出会话列表 —— 验证 tc0|ut9|e2e1|gate6；基线 真机 1090x569：窗口曾 <=1023px ⇒ localStorage 被写 false 且无回宽屏恢复 ⇒ 侧栏永久 48px，折叠态 DOM 零会话行（占位符）选不了会话（详情见 archive/evidence-detail.jsonl#SIDEBAR-NARROW-AUTOCOLLAPSE-LEAK）
- ✅ **TRAJECTORY-TYPE-FILTER-DYNAMIC**：轨迹类型按钮改动态候选（原静态 21 项只覆盖 39%，最吵两类反而筛不到）+ 标签单一实现 —— 验证 tc0|ut10|e2e1|gate6；基线 真机：静态清单无 metric/timing（6.5%）与 request/start（3.3%）⇒ 每 1000 条约 98 行筛不掉；另 12 按钮无中文标签、9 标签无按钮（详情见 archive/evidence-detail.jsonl#TRAJECTORY-TYPE-FILTER-DYNAMIC）
- ✅ **CLIENT-EVENT-TYPE-SET-SINGLE-SOURCE**：消掉每轮刷屏的「未知事件类型」误报（手写副本漂移 20/54）+ 守则测试钉单一事实源 —— 验证 tc0|ut3|e2e1|gate6；基线 真机：derive 的已知事件集是手写副本（34/54）⇒ request/start 3137、context/model-input 503、session/title 105 次等累计 ≈3775 条误报（详情见 archive/evidence-detail.jsonl#CLIENT-EVENT-TYPE-SET-SINGLE-SOURCE）
- ✅ **FORK-PREFIX-WINDOW**：fork 三项前置判据改分页读全前缀（治 read() 默认 1000 条窗口误判）+ 分支标题落 manual/locked 锁 —— 验证 tc0|ut12|e2e2|gate6；基线 真机：fork 三判据误用 read() 默认 1000 条窗口 ⇒ 长会话全量 fork 恒被拒（open turn@925）、窗口外边界解析漏检；fork 子会话无标题标记 ⇒ 分支标题被占位/LLM 命名覆盖（三段标题链）（详情见 archive/evidence-detail.jsonl#FORK-PREFIX-WINDOW）
- ✅ **FORK-BOUNDARY-BEFORE-MESSAGE**：非首条编辑的分支边界改由后端在源事件上解析（取编辑点前最后一个已闭合轮次的 turn/end）；首轮⇒零种子分支 —— 验证 tc0|ut4|e2e2|gate6；基线 真机：fork 全量 + 事后 editTruncate 恒 404（子会话只有事件、无投影）⇒ 分支重载后旧消息回显；客户端自算边界两次被真机打回（详情见 archive/evidence-detail.jsonl#FORK-BOUNDARY-BEFORE-MESSAGE）
- ✅ **BRANCH-EDIT-ZERO-HISTORY**：「编辑并另存为分支」编辑首条 ⇒ 零历史（不再 fork 全量 + 事后截断）；非首条待后端解析边界 —— 验证 tc0|ut4|e2e1|gate6；基线 真机：首条编辑仍 fork 全量 + 事后 `editTruncate` ⇒ `Target message not found` ⇒ 分支重载后旧消息回显；次版用前一条 `lastEventSeq` 算边界被真机打回（`prevSeq: null`）（详情见 archive/evidence-detail.jsonl#BRANCH-EDIT-ZERO-HISTORY）
- ✅ **BRANCH-EDIT-FORK-UPSERT**：「编辑并另存为分支」先 upsert 再切（fork 后 G5 丢弃切换 ⇒ 截断打错会话） —— 验证 tc0|ut3|e2e1|gate6；基线 真机：fork 后逐字 `switchChatSession:目标会话已不在列表，丢弃切换` ⇒ 回落旧会话 ⇒ `editTruncate` 用旧会话消息 id 打新会话（`Target message not found`）（详情见 archive/evidence-detail.jsonl#BRANCH-EDIT-FORK-UPSERT）
- ✅ **ABORT-TURN-END-BACKFILL**：中止补齐 `turn/end{canceled}`（切走会话杀长任务后不再呈现无报错的假空闲） —— 验证 tc0|ut2|e2e1|gate6；基线 真机：切走后事件日志停在 `seq=680 assistant/thinking` 无 `turn/end`、94 条消息 `finishReason` 全空 ⇒ 切回后进度冻结、Console 零 warn/error（详情见 archive/evidence-detail.jsonl#ABORT-TURN-END-BACKFILL）
- ✅ **COMMAND-OUTPUT-PLAIN-TEXT-HEADINGS**：命令输出去 markdown 标题（6 文件约 40 处）+ 回退提示词载荷越界（`agents.ts`） —— 验证 tc0|gate6；基线 Terminal 页 / ink / legacy REPL 显字面 `## Git 状态`；`getPromptForCommand` 载荷与终端输出**同形**（易误改）（详情见 archive/evidence-detail.jsonl#COMMAND-OUTPUT-PLAIN-TEXT-HEADINGS）
- ✅ **COMMAND-OUTPUT-PLAIN-TEXT-STARS**：命令输出去 markdown 强调星号（6 文件约 50 处改纯文本）+ 守则测试钉住 —— 验证 tc0|ut1|gate6；基线 命令输出在 Terminal 页 / ink / legacy REPL 显字面 `**标签**`（四显现面中 3 面不渲染 markdown）（详情见 archive/evidence-detail.jsonl#COMMAND-OUTPUT-PLAIN-TEXT-STARS）
- ✅ **SLASH-COMMAND-DISPATCH-STREAM**：斜杠命令全链路派发（流式接入 + 取值单一实现 + ink help/补全接注册表 + Budget 去星号） —— 验证 tc0|ut6|gate6；基线 流式链路零命令派发（唯一派发点=非流式 `_handleCommand`）⇒ 聊天/渠道打 `/budget` 进模型；ink help 硬编码 5 条、补全 7 条静态（详情见 archive/evidence-detail.jsonl#SLASH-COMMAND-DISPATCH-STREAM）
- ✅ **INK-REPL-SLASH-COMMAND-DISPATCH**：未派发的 `/xxx`（如 `/budget`）不再进模型，统一交全局命令注册表 —— 验证 tc3|ut3|gate6；基线 默认 ink 只硬编码 5 类命令，其余 `/xxx` 落 `streamMessage` 进模型（真机：模型自述命令应由应用层处理）（详情见 archive/evidence-detail.jsonl#INK-REPL-SLASH-COMMAND-DISPATCH）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-68-MODEL-SENTINEL-CONTRACT**：跨包契约一等公民化（门禁登记 + 三方同值守卫）⇒ 同名常量 2>0 —— 验证 tc0|ut87|gate6；基线 同名常量:DEFAULT_MODEL_SENTINEL 2>0（后端 0 识别点）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-68-MODEL-SENTINEL-CONTRACT）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-67-FORK-BOILERPLATE**：删 `xml.ts` 的 `FORK_BOILERPLATE_TAG` 死副本（同义异值）⇒ 同名常量 2>0 —— 验证 tc0|ut110|gate6；基线 同名常量:FORK_BOILERPLATE_TAG 2>0（独立提交 e464d0655 可 revert）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-67-FORK-BOILERPLATE）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-66-TOOL-NAMES**：`TOOL_NAMES`×2 按域消歧（后端生成真源保留 / client 图像注册表改名）⇒ 同名常量 2>0 —— 验证 tc0|ut110|gate6；基线 同名常量:TOOL_NAMES 2>0（首选名 IMAGE_TOOL_NAMES 已被 ToolExecutionService 占用）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-66-TOOL-NAMES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-65-FILE-READ-TOOL-NAME**：`FILE_READ_TOOL_NAME` 合一到真源（同值同事实；补齐第三个 `FILE_*` 名）⇒ 同名常量 2>0 —— 验证 tc0|ut110|gate6；基线 同名常量:FILE_READ_TOOL_NAME 2>0（㉙ 遗留：当时真源未导出故留私有）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-65-FILE-READ-TOOL-NAME）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-64-LINT-CONSTS-VENDORED**：`lint:consts` 加 vendored 排除（ink 上游副本）⇒ 解 4 键假阳性 —— 验证 tc0|ut83|gate6；基线 vendored ink 内部常量与本仓真源同名同值；基线一次删 5 键（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-64-LINT-CONSTS-VENDORED）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-63-MAX-TOOL-RESULTS-CHARS**：删 `toolLimits` 死副本（同义异值 200k/250k）⇒ 同名常量 2>0 —— 验证 tc0|ut83|gate6；基线 同名常量:MAX_TOOL_RESULTS_PER_MESSAGE_CHARS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-63-MAX-TOOL-RESULTS-CHARS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-62-MAX-TOOL-RESULT-BYTES**：`MAX_TOOL_RESULT_BYTES`×2 按域消歧（上下文上限 / 落盘阈值异值）⇒ 同名常量 2>0 —— 验证 tc0|ut81|gate6；基线 同名常量:MAX_TOOL_RESULT_BYTES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-62-MAX-TOOL-RESULT-BYTES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-61-DEFAULT-MAX-TOKENS**：`DEFAULT_MAX_TOKENS`×2 按域消歧（通用 4096 真源保留 / evals 红队 16384 改名）⇒ 同名常量 2>0 —— 验证 tc0|ut80|gate6；基线 同名常量:DEFAULT_MAX_TOKENS 2>0（本轮基线播种被跳过，基线待下调）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-61-DEFAULT-MAX-TOKENS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-60-DEFAULT-MODEL**：`DEFAULT_MODEL` 已合一到真源（同值同事实：空串「未指定模型」）⇒ 同名常量 2>0 —— 验证 tc0|ut80|gate6；基线 同名常量:DEFAULT_MODEL 2>0（本轮基线播种被跳过，基线待下调；另 `DEFAULT_MODEL_SENTINEL` 属跨包契约未处置）（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-60-DEFAULT-MODEL）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-59-MAX-FILENAME-LENGTH**：`MAX_FILENAME_LENGTH`×2 按域消歧（app FS 255 真源保留 / client 导出名 120 改名）⇒ 同名常量 2>0 —— 验证 tc0|ut78|gate6；基线 同名常量:MAX_FILENAME_LENGTH 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-59-MAX-FILENAME-LENGTH）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-58-DEFAULT-SESSION-TIMEOUT**：`DEFAULT_SESSION_TIMEOUT`×2 按域消歧（通用 30min 真源保留 / voice 10min 改名）⇒ 同名常量 2>0 —— 验证 tc0|ut78|gate6；基线 同名常量:DEFAULT_SESSION_TIMEOUT 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-58-DEFAULT-SESSION-TIMEOUT）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-57-MDM-SUBPROCESS-TIMEOUT-MS**：`MDM_SUBPROCESS_TIMEOUT_MS` 合一到 mdm 真源（同值同事实 5000）⇒ 同名常量 2>0 —— 验证 tc0|ut78|gate6；基线 同名常量:MDM_SUBPROCESS_TIMEOUT_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-57-MDM-SUBPROCESS-TIMEOUT-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-56-VALID-STATUSES**：`VALID_STATUSES`×2 按域消歧（task 五态 / todo 三态，异值异域）⇒ 同名常量 2>0 —— 验证 tc0|ut75|gate6；基线 同名常量:VALID_STATUSES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-56-VALID-STATUSES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-55-SAFE-ENV-VARS**：`SAFE_ENV_VARS`×2 按域消歧（托管设置 / bash 继承，异值异域；只改名不放宽）⇒ 同名常量 2>0 —— 验证 tc0|ut75|gate6；基线 同名常量:SAFE_ENV_VARS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-55-SAFE-ENV-VARS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-54-AUTOCOMPACT-BUFFER-TOKENS**：`AUTOCOMPACT_BUFFER_TOKENS` 合一到真源（同值同事实 13000）⇒ 同名常量 2>0 —— 验证 tc0|ut75|gate6；基线 同名常量:AUTOCOMPACT_BUFFER_TOKENS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-54-AUTOCOMPACT-BUFFER-TOKENS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-53-AGENT-TYPES**：`AGENT_TYPES`×2 已合一到真源（= `BUILTIN_AGENTS` 的键；CLI 两命令改桶引用，取值/顺序一字未改）⇒ 同名常量:AGENT_TYPES 2>0 —— 验证 tc0|ut76|gate6；基线 同名常量:AGENT_TYPES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-53-AGENT-TYPES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-52-SKIP-DIRS**：`SKIP_DIRS`×2 按域消歧（插件安全扫描 / files 递归守卫，异值异域；搜索工具真源另在 searchSkipDirs.ts）⇒ 同名常量:SKIP_DIRS 2>0 —— 验证 tc0|ut76|gate6；基线 同名常量:SKIP_DIRS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-52-SKIP-DIRS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-51-TABLE**：`TABLE`×2 按域消歧（定时任务表 / 人设绑定表，取值一字未改）⇒ 同名常量:TABLE 2>0 —— 验证 tc0|ut76|gate6；基线 同名常量:TABLE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-51-TABLE）
- ✅ **BUDGET-OBSERVE-LEFTOVER-CLEANUP**：预算口径遗留清理（删死 i18n 键 + 哨兵/注释统一到金额闸门 + 更正 Token 分支死面误判） —— 验证 tc0|ut40|gate6；基线 死键 `dailyLimitEffectiveLimit` 无消费者；Token 分支原记「不可达」（取证推翻：killSwitch 与口径无关 ⇒ 可达）（详情见 archive/evidence-detail.jsonl#BUDGET-OBSERVE-LEFTOVER-CLEANUP）
- ✅ **SESSION-COMBINED-GATEWAY-INIT**：共享上下文网关启动未初始化（写端恒抛被吞、读端恒空） —— 验证 tc0|ut2|e2e3|gate6；基线 `shared_session` 阶段 trace=fail；`No active gateway found for session: shared-context`（全日志 1 次）（详情见 archive/evidence-detail.jsonl#SESSION-COMBINED-GATEWAY-INIT）
- ✅ **BUDGET-E2E-FOUND-DEFECTS**：真机 E2E 发现并修复四处缺陷（面板 Token 阈值输入绑定错/无闸门按基座取值/i18n 星号字面渲染/冗余有效上限卡；CLI 同步） —— 验证 tc0|ut29|e2e4|arch0|gate6；基线 Token 阈值输入回显 50 且保存覆盖 30,000,000；无闸门显示 relief 抬高的 150,000,000；面板字面渲染 **（详情见 archive/evidence-detail.jsonl#BUDGET-E2E-FOUND-DEFECTS）
- ✅ **BUDGET-CLI-CHANNEL-WORDING**：CLI 与通道撞限文案纠偏（/budget 明示闸门状态 + Token 数字改称观测阈值；IM 撞限文案改称金额预算并指向金额上限） —— 验证 tc0|ut10|arch0|gate6；基线 CLI 仍打印「日 Token 限额/已用-上限/档位正常」、IM 仍称「今日 Token 预算已用完…调高每日上限」⇒ 用户去调 Token 观测阈值（无用）（详情见 archive/evidence-detail.jsonl#BUDGET-CLI-CHANNEL-WORDING）
- ✅ **BUDGET-PANEL-OBSERVE-WORDING**：日预算面板措辞纠偏（未配金额上限时明示「无预算硬闸门」；Token 阈值不再称「日上限」、档位改示「观测（不拦截）」） —— 验证 tc0|ut15|arch0|gate6；基线 无闸门状态下面板仍以「日上限/正常」呈现 Token 观测阈值 ⇒ 误读为生效额度（详情见 archive/evidence-detail.jsonl#BUDGET-PANEL-OBSERVE-WORDING）
- ✅ **BUDGET-TOKEN-OBSERVE-ONLY**：Token 轨只观测、不启用闸门（撤回 §225 回落兜底）+ 观测阈值按 58 天分布重设为 30_000_000 —— 验证 tc0|ut275|e2e2|arch0|gate6；基线 50 万阈值低于除 1 天外所有历史日（中位 9.34M）⇒ 回落路径约 13 次调用即锁死（详情见 archive/evidence-detail.jsonl#BUDGET-TOKEN-OBSERVE-ONLY）
- ✅ **BUDGET-USD-STREAM-LEDGER**：流式主链 USD 台账漏记修复（StreamPipeline 补传 model）+ 债四 S3 真机端到端复核 —— 验证 tc0|ut5|e2e5|arch0|gate6；基线 12,691 tokens 真实调用 usedUsd 增量为 0（dailyBudget:usd_skip model=null）（详情见 archive/evidence-detail.jsonl#BUDGET-USD-STREAM-LEDGER）
- ✅ **BUDGET-USD-PRIMARY**：日预算闸门主口径切金额（债四 S3）：Token 轨降级为观测告警，USD 为唯一硬闸门 —— 验证 tc0|ut33|arch0|gate6；基线 token 基数 50 万 vs 当日 13,186,080（26.4×）⇒ 恒 locked、闸门空转（详情见 archive/evidence-detail.jsonl#BUDGET-USD-PRIMARY）
- ✅ **BUDGET-USD-RESTORE**：USD 台账重启即清零修复（restore 补透传 usedUsd/debtUsd）+ 闸门 USD_BUDGET_GATE 默认开 —— 验证 tc0|ut3|arch0|gate6；基线 状态文件 usedUsd=0.863076 vs API usedUsd:0（详情见 archive/evidence-detail.jsonl#BUDGET-USD-RESTORE）
- ✅ **BUDGET-GHOST-RESUME**：Durable Resume 过滤 phase=completed 检查点（根除会话轮次/消息反复累加） —— 验证 tc0|ut3|arch0|gate6；基线 diag-budget-gate-2 已完成检查点当日被恢复 8 次（详情见 archive/evidence-detail.jsonl#BUDGET-GHOST-RESUME）
- ✅ **BUDGET-USD-LEDGER**：USD 台账同源化：CLI 对话路径补传 model 参 + 跳过日志升 warn + 放行留痕 —— 验证 tc0|ut5|arch0|gate6；基线 CLI 路径 USD 台账 0.863 vs 计费 3.6866（漏记 71%）（详情见 archive/evidence-detail.jsonl#BUDGET-USD-LEDGER）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-53-MAX-ENTRYPOINT-LINES**：`MAX_ENTRYPOINT_LINES` ×2 消歧（异值异域，dream 记忆根改名 DREAM_MAX_ENTRYPOINT_LINES） —— 验证 tc0|guard69|arch0|gate6；基线 同名常量:MAX_ENTRYPOINT_LINES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-53-MAX-ENTRYPOINT-LINES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-52-ENTRYPOINT-NAME**：`ENTRYPOINT_NAME` ×2 消歧（异值异域，dream 记忆根改名 DREAM_ENTRYPOINT_NAME） —— 验证 tc0|guard68|arch0|gate6；基线 同名常量:ENTRYPOINT_NAME 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-52-ENTRYPOINT-NAME）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-51-DIR-EXISTS-GUIDANCE**：`DIR_EXISTS_GUIDANCE` ×2 消歧（异值异域，dream 目录清单/memory 已存在提示） —— 验证 tc0|guard67|arch0|gate6；基线 同名常量:DIR_EXISTS_GUIDANCE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-51-DIR-EXISTS-GUIDANCE）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-50-META-KEY**：`META_KEY` ×2 消歧（异值异域，流式/普通检查点分域改名） —— 验证 tc0|guard66|arch0|gate6；基线 同名常量:META_KEY 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-50-META-KEY）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-49-CACHE-MAX-SIZE**：`CACHE_MAX_SIZE` ×2 消歧（异值异域，议会/路径校验分域改名） —— 验证 tc0|guard65|arch0|gate6；基线 同名常量:CACHE_MAX_SIZE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-49-CACHE-MAX-SIZE）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-48-DEFAULT-CACHE-TTL-MS**：`DEFAULT_CACHE_TTL_MS` ×2 消歧（异值异域，图片下载/市场分域改名） —— 验证 tc0|guard64|arch0|gate6；基线 同名常量:DEFAULT_CACHE_TTL_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-48-DEFAULT-CACHE-TTL-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-47-MARKDOWN-STRUCTURE-RE**：`MARKDOWN_STRUCTURE_RE` ×2 消歧（client/app 异域同值） —— 验证 tc0|guard63|arch0|gate6；基线 同名常量:MARKDOWN_STRUCTURE_RE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-47-MARKDOWN-STRUCTURE-RE）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-46-EXPLORATION-SENTENCE-PATTERNS**：`EXPLORATION_SENTENCE_PATTERNS` ×2 消歧（client/app 异域同值） —— 验证 tc0|guard62|arch0|gate6；基线 同名常量:EXPLORATION_SENTENCE_PATTERNS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-46-EXPLORATION-SENTENCE-PATTERNS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-45-REVIEW-GUIDELINES**：`REVIEW_GUIDELINES` ×2 按域消歧（异值异域，方案评审/回复复核分域改名） —— 验证 tc0|guard61|arch0|gate6；基线 同名常量:REVIEW_GUIDELINES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-45-REVIEW-GUIDELINES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-44-THINKING-BATCH-MS**：`THINKING_BATCH_MS` ×2 合一（同值同事实，chat 域 thinking 防抖时间窗真源化） —— 验证 tc0|guard60|arch0|gate6；基线 同名常量:THINKING_BATCH_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-44-THINKING-BATCH-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-43-THINKING-BATCH-SIZE**：`THINKING_BATCH_SIZE` ×2 合一（同值同事实，chat 域 thinking 防抖批阈值真源化至 streamingLlm.ts 顶层） —— 验证 tc0|guard59|arch0|gate6；基线 同名常量:THINKING_BATCH_SIZE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-43-THINKING-BATCH-SIZE）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-42-CHANNEL-ARROW**：`CHANNEL_ARROW` ×2 按域消歧（figures ← / parser → 异值，来源箭头改名 MSG_SOURCE_ARROW） —— 验证 tc0|guard58|arch0|gate6；基线 同名常量:CHANNEL_ARROW 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-42-CHANNEL-ARROW）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-41-STREAM-IDLE-TIMEOUT-MS**：`STREAM_IDLE_TIMEOUT_MS` ×2 按域消歧（client/app 异域同值，副本改名 SSE_IDLE_TIMEOUT_MS） —— 验证 tc0|guard57|arch0|gate6；基线 同名常量:STREAM_IDLE_TIMEOUT_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-41-STREAM-IDLE-TIMEOUT-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-40-EYES**：`EYES` ×2 按域消歧（client/app 异域同值，副本改名 BUDDY_EYES）⇒ 同名常量 2→0 —— 验证 tc0|guard56|arch0|gate6；基线 同名常量:EYES 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-40-EYES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-39-EMPTY-POLL-LOG-INTERVAL**：`EMPTY_POLL_LOG_INTERVAL` ×2 合一（同值同事实，bridge/api 空轮询日志节流真源化）⇒ 同名常量 2→0 —— 验证 tc0|guard55|arch0|gate6；基线 同名常量:EMPTY_POLL_LOG_INTERVAL 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-39-EMPTY-POLL-LOG-INTERVAL）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-38-SAFE-ID-PATTERN**：`SAFE_ID_PATTERN` ×2 合一（同值同事实，bridge/api ID 校验真源化）⇒ 同名常量 2→0 —— 验证 tc0|guard54|arch0|gate6；基线 同名常量:SAFE_ID_PATTERN 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-38-SAFE-ID-PATTERN）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-37-IMAGE-EXTS**：`IMAGE_EXTS` ×2 按域消歧（files-handlers 7 项 / ToolExecution 5 项）⇒ 同名常量 2→0 —— 验证 tc0|guard53|arch0|gate6；基线 同名常量:IMAGE_EXTS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-37-IMAGE-EXTS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-36-IMAGE-EXTENSIONS**：`IMAGE_EXTENSIONS` ×3 按域消歧（MediaCache 8 项 / Brief 7 项 / FileRead 13 项）⇒ 同名常量 2→0 —— 验证 tc0|guard52|arch0|gate6；基线 同名常量:IMAGE_EXTENSIONS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-36-IMAGE-EXTENSIONS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-35-HEARTBEAT-INTERVAL**：`HEARTBEAT_INTERVAL` ×2 按域消歧（OTel 4min / 通用 30s）⇒ 同名常量 2→0 —— 验证 tc0|guard51|arch0|gate6；基线 同名常量:HEARTBEAT_INTERVAL 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-35-HEARTBEAT-INTERVAL）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-34-DEFAULT-REQUEST-TIMEOUT-MS**：`DEFAULT_REQUEST_TIMEOUT_MS` 按域消歧（JsonRpcBridge / LspSidecar）⇒ 2→0 —— 验证 tc0|guard50|arch0|gate6；基线 同名常量:DEFAULT_REQUEST_TIMEOUT_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-34-DEFAULT-REQUEST-TIMEOUT-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-33-DEFAULT-INTERVAL-MS**：`DEFAULT_INTERVAL_MS` ×2 按域消歧（TopologyWatcher 5s / DataArchivalStrategy 1h）⇒ 同名常量 2→0 —— 验证 tc0|guard49|arch0|gate6；基线 同名常量:DEFAULT_INTERVAL_MS 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-33-DEFAULT-INTERVAL-MS）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-32-MAX-POLL-TIME**：`MAX_POLL_TIME` ×3 按域消歧（FAL 5min / SiliconFlow 30min / OpenAI 兼容 5min，取值一字未改）⇒ 同名常量:MAX_POLL_TIME 3→0 —— 验证 tc0|guard48|arch0|gate6；基线 同名常量:MAX_POLL_TIME 3>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-32-MAX-POLL-TIME）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-31-UUID-RE**：`UUID_RE` 8 份同值副本（2 const + 6 内联）合一到 core/ids.ts 真源 ⇒ 同名常量:UUID_RE 2→0 —— 验证 tc0|guard47|gates11|arch0|gate6；基线 同名常量:UUID_RE 2>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-31-UUID-RE）
- ✅ **HARDCODE-GATE-CONSTS-TYPED-BLINDSPOT**：`lint:consts` 补「同名常量」盲区：纳入标量基础类型的带类型写法（棘轮零增长，口径外数组/对象另有登记） —— 验证 tc0|gates11|arch0|gate6；基线 同名常量 122 组（零增长）（详情见 archive/evidence-detail.jsonl#HARDCODE-GATE-CONSTS-TYPED-BLINDSPOT）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-30-ACTIVE-NAV-KEY**：`ACTIVE_NAV_KEY` 三处按域消歧（client 三视图各自私有、取值各异）⇒ 同名常量:ACTIVE_NAV_KEY 3→0 —— 验证 tc0|guard46|arch0|gate5；基线 同名常量:ACTIVE_NAV_KEY 3>0（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-30-ACTIVE-NAV-KEY）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-29-FILE-TOOL-NAMES**：`FILE_{EDIT,WRITE}_TOOL_NAME` 合一到 constants 真源（prompt.ts 改转发导出）⇒ consts 227>225 —— 验证 tc0|guard45|tools853|arch0|gate5；基线 227>225（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-29-FILE-TOOL-NAMES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-28-MAGIC-GUID**：`MAGIC_GUID` 合一到 core 真源（RFC 6455，5 处→1）⇒ consts 228>227 —— 验证 tc0|guard44|voice+acp202|arch0|gate5；基线 228>227（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-28-MAGIC-GUID）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-27-MAX-MESSAGES**：`MAX_MESSAGES`×3 按域消歧（office 回放 50 / LRO 取尾 12 / teammate 容量 500）⇒ consts 229>228 —— 验证 tc0|guard43|tasks378|gate4；基线 229>228（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-27-MAX-MESSAGES）
- ✅ **HARDCODE-SAME-NAME-CONSTS-B5-2-26-DEFAULT-TIMEOUT**：`DEFAULT_TIMEOUT`×3 按域消歧（httpUtils 留 / toolService / SessionLock）⇒ consts 230>229 —— 验证 tc0|guard42|sess311|gate5；基线 230>229（详情见 archive/evidence-detail.jsonl#HARDCODE-SAME-NAME-CONSTS-B5-2-26-DEFAULT-TIMEOUT）

- ✅ **硬编码治理 · 「同名常量」B5-2 第二十五项：`DEFAULT_CONFIG` ×3 按域消歧 —— `lint:consts` 231 → 230 键（−1）**
  - 判定：3 处默认配置形状各异（同目录三家 STT 提供者）⇒ `CLOUD_STT_DEFAULT_CONFIG`（`model: 'whisper-1'`）· `LOCAL_STT_DEFAULT_CONFIG`（`model: 'base'`）· `SENSE_VOICE_STT_DEFAULT_CONFIG`（`model: 'SenseVoiceSmall'`）；**内容一字未改**（各含 `{ ...新名, ...config }` 用法同步）。
  - **口径澄清（重要）**：门禁正则 `^\s*(export )?const NAME\s*=` **只认无类型标注**的同名定义 ⇒ 本键恰为这 3 个文件（同目录 `streamSTTProvider.ts` 用带类型写法，因此不计入）。
  - ⚠️ **门禁盲区（已登记，本片未动）**：带类型写法 `const DEFAULT_CONFIG: T = {…}` 全仓仍有 **16+ 处**（bridge / voice / config-enterprise / core / ai-python / agent / utils / client…）⇒ 建议单独裁定（扩门禁正则 或 单批统一）。
  - 验证：守卫 41 pass / 0 fail · `typecheck` 0 · `tests/services`+`tests/voice` 201 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二十四项：`ENABLED` ×3 按域消歧 —— `lint:consts` 232 → 231 键（−1）**
  - 判定：3 处取值均为 **env 表达式**、各属独立模块开关（全为文件内私有）⇒ `MEM_PROFILE_ENABLED`（`MEM_PROFILE === '1'`，内存画像）· `MEM_PRESSURE_ENABLED`（`MEM_PRESSURE !== '0'`，内存压力）· `QUERY_PROFILER_ENABLED`（`Liri_PROFILE_QUERY === '1'`，查询分析器）；**表达式一字未改**。
  - 附带：**tests 侧同名别名**一并消歧（`pathShieldSandboxE2E.test.ts` 的 `ENABLED` → `PATH_SHIELD_E2E_ENABLED`，非门禁扫描面）⇒ 全仓不再有同名定义。
  - 验证：守卫 40 pass / 0 fail · `typecheck` 0 · `tests/monitoring`+`tests/query` 378 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二十三项：`POLL_INTERVAL` ×3 按域消歧 —— `lint:consts` 233 → 232 键（−1）**
  - 判定：3 处取值各异、分属独立轮询域（全在 `client/`、全为文件内私有）⇒ `COMPILE_POLL_INTERVAL_MS`（`1000` · Knowledge 编译轮询）· `VIDEO_TASK_POLL_INTERVAL_MS`（`2000`）· `SSE_FALLBACK_POLL_INTERVAL_MS`（`15000` · 断线兜底）；**数值一字未改**。
  - **注释同步**：`sseService.ts` 两处注释随名改指新名（防悬空引用）；**守卫改钉**：⑮ 用例原钉的 `POLL_INTERVAL`（已消歧）改钉同族非本键 `POLL_INTERVAL_QR_MS`（wechat `1_500`）。
  - 验证：守卫 39 pass / 0 fail · app/client `typecheck` 0 · 5 门禁 exit 0；`client` 全量仍为 **180 fail / 12 error（既有，与本片逐字一致）**；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二十二项：`CURRENT_SCHEMA_VERSION` ×3 按域消歧 —— `lint:consts` 234 → 233 键（−1）**
  - 判定：三处**域与取值/类型均不同**（memory `2` 数值 · knowledge `1` 数值 · context `'1.0'` **字符串**）⇒ 按域消歧、**不合并**。
  - 处置：① `memory/types/MemoryMetadata.ts` 为**导出真源**（被 `MemorySchemaRegistry` 消费）⇒ **保留原名**；② `knowledge/KnowledgeSchemaMigration.ts` ⇒ `KNOWLEDGE_SCHEMA_VERSION`；③ `context/persistence/ContextPersistence.ts` ⇒ `CONTEXT_PERSISTENCE_SCHEMA_VERSION`（后两处均文件私有 ⇒ 零跨文件复改）。
  - 验证：守卫 38 pass / 0 fail · `typecheck` 0 · `tests/memory`+`tests/knowledge`+`tests/context` 211 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二十一项：`DEFAULT_MAX_RESULT_SIZE_CHARS` 收敛单一真源 —— `lint:consts` 235 → 234 键（−1）**
  - 判定：三处**同值同事实**（均 `50000` / `50_000`）⇒ 不再「消歧」而是**合一**（沿用 B2 `BYTES_PER_TOKEN` 的既有形态）。
  - 处置：① 真源 = `constants/toolLimits.ts`（**保留**，唯一定义处）；② `context/budget/ToolResultBudget.ts` 私有副本 ⇒ 删本地、改**引用真源**；③ `services/toolResultStorage/types.ts` ⇒ **仅保留导出面**（`export { … } from '@modules/constants'`，消费者零改动）。
  - 旁证：同文件的 `MAX_TOOL_RESULT_BYTES`/`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` 与真源**值不同**（1e6 vs 4e5 · 25e4 vs 2e5）⇒ 属**别的键**，本片未动（已记入 `reopenWhen`）。
  - 验证：守卫 37 pass / 0 fail · `typecheck` 0 · `tests/context`+`tests/services` 119 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二十项：`BINARY_EXTENSIONS` 三定义文件 ⇒ 1（真源保留 / 同文件两副本合一 / 按域消歧）—— `lint:consts` 236 → 235 键（−1）**
  - 判定（**门禁按「定义文件数」计**，故 4 处定义 = 3）：三处实为**两个不同事实 + 一处同文件重复**。
  - 处置：① `constants/files.ts` 为**导出真源**（媒体/压缩类，自用 `hasBinaryExtension`）⇒ **保留原名**（唯一真源）；② `knowledge-handlers.ts` 内**两处逐字相同**的函数级副本 ⇒ **合一**为模块级 `KNOWLEDGE_CONVERT_BINARY_EXTENSIONS`（文档转换类），4 个消费点改指新名；③ `FileReadTool.ts` 自带**不同**清单（26 项）⇒ 按域消歧 `FILE_READ_BINARY_EXTENSIONS`。**内容一字未改**。
  - 验证：守卫 36 pass / 0 fail · `typecheck` 0 · `tests/tools` 853 pass · `tests/infrastructure` 27 pass · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十九项：`COLORS` ×3 按域消歧 —— `lint:consts` 237 → 236 键（−1）**
  - 判定：3 处内容各异、分属独立域 ⇒ `TOAST_TYPE_COLORS`（toast 样式表 · `ToastContainer.tsx`）· `CANVAS_TOOLBAR_COLORS`（画布 8 色调色板 · `CanvasToolbar.tsx`）· `AVATAR_COLORS`（头像底色 8 色 · `Avatar.tsx`）；**内容一字未改**。
  - 全仓核验：3 处全为文件内私有（无 `export`、无消费面）⇒ **零跨文件复改**；同族非本键 `*_COLORS`（`PROVIDER_COLORS`/`TYPE_COLORS`/`EVENT_COLORS` 等）**未动**（守卫正向钉住）。
  - 本片**跨 `client/` + `app/` 双侧**⇒ 两侧 `typecheck` 均 0 错。
  - ⚠️ **既有红（与本片无关）**：`client` 全量测试 180 fail / 12 error —— 经 **stash 对照**（撤掉本片 2 处 client 改动后同为 180 fail）证明为**改动前既有**，本片不引入、不修（已在台账如实登记）。
  - 验证：守卫 35 pass / 0 fail · app/client typecheck 0 · 5 门禁 exit 0；`e2eVerified=false`（未做真机目视）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十八项：`SUBCOMMANDS` ×3 按域消歧 —— `lint:consts` 238 → 237 键（−1）**
  - 判定：3 处子命令清单分属 3 个命令模块 ⇒ `NOTEBOOK_SUBCOMMANDS`（`10` 项 · `commands/tools/dev/notebook.ts`）· `AGENTS_SUBCOMMANDS`（`4` 项 · `commands/tools/ai/agents.ts`）· `AGENT_SUBCOMMANDS`（`5` 项 · `commands/tools/ai/agent.ts`，其报错文本自述为 `/subagent-run`）；**取值一字未改**。
  - 全仓核验：3 处全为文件内私有（无 `export`、无消费面）⇒ **零跨文件复改**；同族非本键 `GIT_SUBCOMMANDS` / `GIT_READ_ONLY_SUBCOMMANDS`（`security/**`）**未动**。
  - ⚠️ **新发现（仅登记，未处理）**：`agents.ts` 的 `AGENTS_SUBCOMMANDS` **本文件内零引用** ⇒ 疑死常量，本片**只改名不删**（删除须过 CD01–CD06）。
  - 验证：守卫 34 pass / 0 fail · `typecheck` 0 · `tests/commands` 13 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十七项：`MAX_DEPTH` ×3 按域消歧 —— `lint:consts` 239 → 238 键（−1）**
  - 判定：3 处定义分属独立域 ⇒ `PHASE_STACK_MAX_DEPTH`（`64`，诊断相位栈上限）· `FILES_MAX_DEPTH`（`4`，`/files` 递归守卫）· `PROJECT_ARTIFACT_MAX_DEPTH`（`4`，工件扫描）；**数值一字未改**。
  - 全仓核验：3 处全为文件内私有（无 `export`、无消费面）⇒ **零跨文件复改**；另把 **tests 侧同名局部别名**一并消歧（`SUBAGENT_MAX_DEPTH`，非门禁扫描面）；同族非本键 `DEFAULT_ROOT_CAUSE_MAX_DEPTH`（systemgraph 导出真源）**未动**。
  - 涉及 tests 注释同步：`files-clean.test.ts` 两处注释改指新名（避免悬空引用）。
  - 验证：守卫 33 pass / 0 fail · `typecheck` 0 · 相关 tests 5 pass · 5 门禁 exit 0；`e2eVerified=false`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十六项：`DEFAULT_THROTTLE_MS` ×3 按渠道消歧 —— `lint:consts` 240 → 239 键（−1）**
  - 判定：3 处取值各异、各受渠道上游限流约束 ⇒ `DISCORD_DEFAULT_THROTTLE_MS`（`800`）· `MATRIX_DEFAULT_THROTTLE_MS`（`1000`）· `MSTEAMS_DEFAULT_THROTTLE_MS`（`1500`）；**数值一字未改**。
  - 全仓核验：该名全仓仅 6 处命中（定义 1 + 用法 1 ×3），**全在这 3 个文件内**（无 `export`、无消费面）⇒ **零跨文件复改**；同族非本键 `STREAMING_UPDATE_THROTTLE_MS`（飞书）**未动**（守卫正向钉住）。
  - 验证：守卫 32 pass / 0 fail · `typecheck` 0 · `channels` 域 324 pass / 0 fail · 5 门禁 exit 0；`e2eVerified=false`（未做真机渠道走查）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十五项：`POLL_INTERVAL_MS` ×3 按域消歧 —— `lint:consts` 241 → 240 键（−1）**
  - 判定：3 处取值各异、分属三个独立域 ⇒ `BLUEBUBBLES_POLL_INTERVAL_MS`（`8000`，渠道轮询）· `AGENT_TASK_POLL_INTERVAL_MS`（`5000`，任务面板刷新）· `REPLICATE_POLL_INTERVAL_MS`（`2000`，供应商作业轮询）；**数值一字未改**。
  - 全仓核验：该名全仓仅 7 处命中（定义 1 + 用法 1 ×3），**全在这 3 个文件内**（无 `export`、无消费面）⇒ **零跨文件复改**；同族非本键 `POLL_INTERVAL` ×3 · `POLL_INTERVAL_QR_MS` · `POLL_MAX_ATTEMPTS` **未动**（守卫正向钉住）。
  - 本片**跨 `app/` + `client/` 双侧**（⑬⑭ 仅 `app`）⇒ 两侧 `typecheck` 均跑了 0 错。
  - 验证：守卫 31 pass / 0 fail · app typecheck 0 · client typecheck 0 · 5 门禁 exit 0；`e2eVerified=false`（未做真机轮询走查）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十四项：`MIN_INITIAL_CHARS` ×3 按渠道消歧 —— `lint:consts` 242 → 241 键（−1）**
  - 判定：3 处取值各异、各属独立渠道流式首帧阈值 ⇒ `DISCORD_MIN_INITIAL_CHARS`（`10`）· `MATRIX_MIN_INITIAL_CHARS`（`15`）· `MSTEAMS_MIN_INITIAL_CHARS`（`20`）；**数值一字未改**。
  - 全仓核验：该名全仓仅 6 处命中（定义 1 + 用法 1 ×3），**全在这 3 个文件内**（无 `export`、无消费面）⇒ **零跨文件复改**。
  - 验证：守卫 30 pass / 0 fail · `typecheck` 0 · 5 门禁 exit 0；`e2eVerified=false`（未做真机渠道走查）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十三项：`DISPLAY_PREFIX` ×3 按域消歧 —— `lint:consts` 243 → 242 键（−1）**
  - 判定：3 处取值各异、各属独立媒体类型 ⇒ `AUDIO_DISPLAY_PREFIX`（`/v1/audio/static/`）· `IMAGE_DISPLAY_PREFIX`（`/v1/images/static/media/`）· `VIDEO_DISPLAY_PREFIX`（`/v1/videos/static/`）；**数值一字未改**。
  - 全仓核验：该名全仓仅 10 处命中，**全在这 3 个文件内**（无 `export`、无消费面）⇒ **零跨文件复改**。
  - 验证：守卫 29 pass / 0 fail · `typecheck` 0 · 5 门禁 exit 0；`e2eVerified=false`（未做真机 URL 走查）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十二项（代为收尾）：`DEFAULT_IDLE_TIMEOUT_MS` ×2 按域消歧 —— `lint:consts` 244 → 243 键（−1）**
  - 判定：2 处同值 30min 但**异事实** ⇒ `ACP_SESSION_IDLE_TIMEOUT_MS`（ACP 会话空闲回收）· `IDLE_SCALE_TIMEOUT_MS`（空闲降载监控）；**数值一字未改**。
  - 收尾背景：原切片会话终止于「代码+守卫完成 → 未收紧基线/未写台账/未提交」（60s 零写入 + HEAD 未前进 ⇒ 判已静止）；本次补基线（消陈键 `同名常量:DEFAULT_IDLE_TIMEOUT_MS`）+ 提交 + 台账。
  - 验证：守卫 28 pass / 0 fail · `typecheck` 0 · 5 门禁 exit 0 · `hardcodeGateBlocking` 8 pass / 0 fail；`e2eVerified=false`（未做真机走查）。
  - 同族 `STREAM_/REPL_IDLE_TIMEOUT_MS` 与裸 `IDLE_TIMEOUT_MS` 非本键、未动；台账遵 **SB03 短行**（本键为首例）。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十一项：`CLEANUP_INTERVAL_MS` ×4 按域消歧 —— `lint:consts` 245 → 244 键（−1）** - **取证（CS06）**：4 处同名 `CLEANUP_INTERVAL_MS` —— `chronos/maintenance/cleanup.ts` `24 * 60 * 60 * 1000`（chronos 每日清理）· `media/image/TempFileManager.ts` `5 * 60 * 1000`（临时文件清理扫描）· `tools/CanvasTool/CanvasTool.ts` `5 * 60 * 1000`（画布实例自动清理）· `permission/ApprovedCommandRegistry.ts` `30_000`（已批准命令定时清理）。**判定**：四处分属**独立清理器**，取值 3 种（两个 `5min` 分属临时文件与画布实例 ⇒ **非同一事实**）⇒ **命名太泛** ⇒ 按域消歧、不因同值而合一。**落地**：`CHRONOS_CLEANUP_INTERVAL_MS` · `TEMP_FILE_CLEANUP_INTERVAL_MS` · `CANVAS_CLEANUP_INTERVAL_MS` · `APPROVED_COMMAND_CLEANUP_INTERVAL_MS`；**4 个数值一字未改 ⇒ 零行为变化**。**全仓核验**：全仓命中 6 文件 = 4 definer + 2 **前缀名**（`RECURRING_CLEANUP_INTERVAL_MS`@`ChronosBackgroundHousekeeping.ts` 24h · `DEFAULT_CLEANUP_INTERVAL_MS`@`channels/dedup/index.ts` 1h）⇒ 前缀名**非本键、未动**（守卫正向钉住）、`replace_all` 不误伤。**⚠️ 同值同域观察（未处理，如实登记）**：`cleanup.ts#CHRONOS_CLEANUP_INTERVAL_MS` 与 `ChronosBackgroundHousekeeping.ts#RECURRING_CLEANUP_INTERVAL_MS` **同值 24h 且同属 chronos 维护面** ⇒ 疑为**同一事实**（两条清理路径是否同时触发未验）；因标识符不同（非本键）本片**未动** ⇒ 记 `reopenWhen`。**效果（可证伪）**：`lint:consts` **245 → 244**（−1 键），门禁自报 `同名常量:CLEANUP_INTERVAL_MS` **4→0** ⇒ 基线已**下调至 244 键**。**守卫**（第 **27** 例）：4 文件均不含 `const CLEANUP_INTERVAL_MS = ` 且各含确切新名与取值；另正向钉住两个同族前缀名仍在。**验证**：`typecheck`（app 三 tsconfig，含 scripts）**0**；相关域 **1059 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① `permission/**` 属 **CD07 关键域**、`chronos/**`/`media/**`/`tools/**` 属敏感面 ⇒ **仅改名、未删实现、未改数值**；② 未做真机走查（四类清理器真实触发节奏未验）⇒ `e2eVerified=false`；③ 未跑全量 `bun test`。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-11-CLEANUP-INTERVAL-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第十项：`MAX_RECONNECT_ATTEMPTS` ×4 按域消歧 —— `lint:consts` 246 → 245 键（−1）** - **取证（CS06）**：4 处同名 `MAX_RECONNECT_ATTEMPTS` —— `channels/qq/types.ts` `export const ... = 50`（**导出真源**，消费侧 `channels/qq/QQChannel.ts` 有 **7 处**引用）· `session/websocket/SessionsWebSocket.ts` `5` · `services/mcp/MCPConnectionManager.ts` `5` · `services/mcp/client.ts` `5`。**判定**：**命名太泛** ⇒ 按域消歧；**三处同值 `5` 未合一**（会话 WS 与 MCP 属不同子系统；**MCP 两处同模块 + 三元组形状同构** ⇒ 合一候选，须先定真源 + 验依赖方向）⇒ 记 `reopenWhen`。**落地**：`QQ_MAX_RECONNECT_ATTEMPTS`（**导出真源 + 消费侧同步**） · `SESSIONS_WS_MAX_RECONNECT_ATTEMPTS` · `MCP_MANAGER_MAX_RECONNECT_ATTEMPTS` · `MCP_CLIENT_MAX_RECONNECT_ATTEMPTS`；**4 个数值一字未改 ⇒ 零行为变化**。**⚠️ 新发现（未处理，如实登记）**：`services/mcp/client.ts:21-23` 的「重连常量」三元组在该文件内**零引用**（`noUnusedLocals: false` 故 `typecheck` 不报）⇒ **疑为死常量块**；本片**只改名、未删除**（删除须过 CD01–CD06，另案）。**同族前缀名** `WS_MAX_RECONNECT_ATTEMPTS`（飞书 `10`）**非本键、未动**（守卫正向钉住）。**效果（可证伪）**：`lint:consts` **246 → 245**（−1 键），门禁自报 `同名常量:MAX_RECONNECT_ATTEMPTS` **4→0** ⇒ 基线已**下调至 245 键**。**守卫**（第 **26** 例）：4 文件均不含 `const MAX_RECONNECT_ATTEMPTS = ` 且各含确切新名与取值；另断言 `QQChannel` 含新名、`WS_MAX_RECONNECT_ATTEMPTS` 仍在。**验证**：`typecheck`（app 三 tsconfig，含 scripts）**0**（同时证明导出面与消费侧一致）；相关域 **697 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① `channels/**` 属 CD07 关键域、`session/**`/`services/mcp/**` 属敏感面 ⇒ **仅改名**；② 未做真机走查（QQ/会话 WS/MCP 真实重连行为未验）⇒ `e2eVerified=false`；③ 未跑全量 `bun test`。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-10-MAX-RECONNECT-ATTEMPTS`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第九项：`MAX_STREAM_AGE_MS` ×4 按渠道消歧 —— `lint:consts` 247 → 246 键（−1）** - **取证（CS06）**：4 处同名 `MAX_STREAM_AGE_MS`（各 2 处，共 8 处）全在 `app/src/channels/**` 的流式消息模块 —— `msteams/streaming-message.ts` `45000` · `feishu/streaming-card.ts` `60000` · `matrix/streaming-message.ts` `300000` · `discord/streaming-message.ts` `900000`；四处**注释同形**（「流最大存活时间（毫秒）」）⇒ 同一**概念**在四个渠道各有**上游不同约束**。**判定**：取值全不同且受各上游平台约束 ⇒ **命名太泛** ⇒ **按渠道改名消歧**、**不得归一**（归一即改行为）。**落地**：`MSTEAMS_MAX_STREAM_AGE_MS` · `FEISHU_MAX_STREAM_AGE_MS` · `MATRIX_MAX_STREAM_AGE_MS` · `DISCORD_MAX_STREAM_AGE_MS`；**4 个数值一字未改 ⇒ 零行为变化**。**全仓核验**：该名全仓仅这 4 文件 ×2（含 `app/scripts`/`app/tests`/`client` 已扫）⇒ 无同族超长名、`replace_all` 不误伤。**效果（可证伪）**：`lint:consts` **247 → 246**（−1 键），门禁自报 `同名常量:MAX_STREAM_AGE_MS` **4→0** ⇒ 基线已**下调至 246 键**。**守卫**（第 **25** 例）：4 文件均不含 `const MAX_STREAM_AGE_MS = ` 且各含确切新名与取值。**验证**：`typecheck`（app 三 tsconfig，含 scripts）**0**；相关域 **355 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① `channels/**` 属 **CD07 关键域** ⇒ **仅改名、未删实现、未改数值**；② **未做真机渠道走查**（四个渠道的真实流式消息行为未验）⇒ `e2eVerified=false`；③ 未跑全量 `bun test`；④ 未跑 client（无 client 侧改动）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-9-MAX-STREAM-AGE-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第八项：`MAX_HISTORY` ×4 按域消歧（全在 client 侧）—— `lint:consts` 248 → 247 键（−1）** - **取证（CS06）**：4 处同名 `MAX_HISTORY` **全在 client** —— `components/views/image/taskHistoryStore.ts` `50`（图像任务历史）· `components/views/TTSPlayground.tsx` `100`（TTS 试听历史）· `components/views/STTTestPage.tsx` `50`（STT 测试页历史）· `services/connectionMonitor.ts` `20`（连接状态历史）。**判定**：四处分属**四个互不相关的列表**，两个 `50` **非同一事实** ⇒ **命名太泛** ⇒ 按域消歧（不因同值而合一）。**落地**：`IMAGE_TASK_MAX_HISTORY` · `TTS_PLAYGROUND_MAX_HISTORY` · `STT_TEST_MAX_HISTORY` · `CONNECTION_MONITOR_MAX_HISTORY`；**4 个数值一字未改 ⇒ 零行为变化**。**全仓核验（按 B5-2⑦ 教训）**：该名**全仓仅这 4 处定义**（含 `app/scripts`/`app/tests` 均已扫）⇒ 无脚本/测试面 definer；同族后缀名 `MAX_HISTORY_ENTRIES`（app `CompactionMetrics.ts`）**非本键、未动**（守卫正向钉住）。**效果（可证伪）**：`lint:consts` **248 → 247**（−1 键），门禁自报 `同名常量:MAX_HISTORY` **4→0** ⇒ 基线已**下调至 247 键**。**守卫**（第 **24** 例）：4 文件均不含 `const MAX_HISTORY = ` 且各含确切新名与取值。**验证**：`typecheck`（client）**0**；**client 全量 vitest 73 文件全绿**；4 硬编码门禁全 **exit 0**。**如实边界**：① 本片**改动全在 client** ⇒ **未跑 app 侧域测试**（app 源码零改动）；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-8-MAX-HISTORY`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第七项：`MAX_FILES` ×5 按域消歧 —— `lint:consts` 249 → 248 键（−1）** - **取证（CS06）**：门禁口径 4 处 —— `tools/GlobTool/GlobTool.ts` `100`（glob 结果上限）· `context/promptSections/builtinSections.ts` `20`（sandbox 目录展示上限）· `infrastructure/http/handlers/project-artifact-handlers.ts` `500`（产物遍历上限）· `skills/loaders/adapter/clawhub/ClawHubInstaller.ts` `50`（安装包文件数上限）；**另有扫描面外 1 处**：`app/scripts/bench-truncation-closure.ts` `400`（压测规模）。**判定**：5 处取值全不同（20/50/100/400/500）且各属独立上限 ⇒ **命名太泛** ⇒ 按域消歧；**扫描面外那处一并改名**（求全仓同名归零）。**落地**：`GLOB_TOOL_MAX_FILES` · `BUILTIN_SECTION_MAX_FILES` · `PROJECT_ARTIFACT_MAX_FILES` · `CLAWHUB_INSTALL_MAX_FILES` · `BENCH_MAX_FILES`；**5 个数值一字未改 ⇒ 零行为变化**。**顺带同步**：`tests/tools/GlobTool/globAsync.test.ts` 3 处说明性文本/标题改为新名（**既有断言一字未改**）。**效果（可证伪）**：`lint:consts` **249 → 248**（−1 键），门禁自报 `同名常量:MAX_FILES` **4→0** ⇒ 基线已**下调至 248 键**。**守卫**（第 **23** 例）：5 文件（含脚本）均不含 `const MAX_FILES = ` 且各含确切新名与取值；另**正向钉住** `MAX_FILES_PER_REPLY` 仍在（防误并入同族后缀名）。**验证**：`typecheck`（app 三 tsconfig，含 scripts）**0**；相关域 **1292 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界（重要实证）**：`lint:consts` 扫描面**只含 `app/src` + `client/src`** ⇒ **`app/scripts/**` 与 `app/tests/**` 不在其中**；后续续项若**只以门禁计数为准**可能漏扫脚本/测试面 ⇒ 每项仍须**全仓 grep**（本会话曾因只搜仓库根 `scripts/` 漏掉 `app/scripts/`，由 `typecheck` 拦下）。未跑全量 `bun test`；未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-7-MAX-FILES`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第六项：`FENCE_RE` ×4 按域消歧 —— `lint:consts` 250 → 249 键（−1）** - **取证（CS06）**：4 处同名 `FENCE_RE`（各 2 处：1 定义 + 1 用例）—— `app/src/utils/structureCut.ts` `/^\s*```/`（**围栏行**）· `app/src/channels/messageSplitter.ts` `/^\s*```/`（**围栏行**）· `app/src/chat/services/bareExplorationStripper.ts` ``` /```[\s\S]*?```/g ```（**围栏块**，函数内局部）· `client/src/stores/chat/chat-toolcall.slice.ts`（**围栏块**，函数内局部）。**判定**：分属 4 个模块、语义分两类 ⇒ **命名太泛** ⇒ 按域消歧（**不按语义并成 2 个名字** —— 那会在新建的键上再次同名，棘轮门禁会拦）。**落地**：`STRUCTURE_CUT_FENCE_RE` · `MESSAGE_SPLITTER_FENCE_RE` · `BARE_EXPLORATION_FENCE_RE` · `CHAT_TOOLCALL_FENCE_RE`；**4 个正则字面量一字未改 ⇒ 零行为变化**。**效果（可证伪）**：`lint:consts` **250 → 249**（−1 键），门禁自报 `同名常量:FENCE_RE` **4→0** ⇒ 基线已**下调至 249 键**。**守卫**（第 **22** 例）：4 文件均不含 `const FENCE_RE = ` 且各含确切新名与**正则字面量**。**验证**：`typecheck`（app 三 tsconfig）**0** · `typecheck`（client）**0**；app 相关域 **1260 pass / 0 fail**；**client 全量 vitest 73 文件全绿**；4 硬编码门禁全 **exit 0**。**如实边界（重要发现）**：`bareExplorationStripper.ts`（app）与 `chat-toolcall.slice.ts`（client）**各有一份同名同实现的 `splitSentencesPreservingFences`**（同算法 + 同 `\u0000FENCE{n}\u0000` 占位协议）⇒ 属方案 §4.2 类**跨部署单元双写**；本片**只消歧常量名、未动该双写**（跨包无法共享模块，治理须单独立片 + 契约测试）⇒ 已写入台账 `reopenWhen` ②。同族子串 `CONTEXT_FENCE_REPLACEMENT`（`StreamingContextScrubber.ts`）**非本键、未动**。未跑全量 `bun test`；未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-6-FENCE-RE`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第五项：`CACHE_TTL` ×4 按域消歧（含 2 处 client 侧）—— `lint:consts` 251 → 250 键（−1）** - **取证（CS06）**：4 处同名 `CACHE_TTL` —— `app/src/ink/ink/line-width-cache.ts` `60000`（ink 行宽缓存）· `app/src/lsp/schemas.ts` `60000`（LSP schema 缓存）· `client/src/components/views/media/thumbCache.ts` `30 * 60 * 1000`（缩略图持久缓存）· `client/src/services/capabilityService.ts` `5 * 60 * 1000`（能力列表缓存）。**判定**：4 处各属**独立缓存**；**两个 `60000` 分属完全不同子系统**（终端行宽计算 vs LSP schema 解析）⇒ **不因同值而合一** ⇒ 按域改名消歧。**落地**：`LINE_WIDTH_CACHE_TTL_MS` · `LSP_SCHEMA_CACHE_TTL_MS` · `THUMB_CACHE_TTL_MS` · `CAPABILITY_CACHE_TTL_MS`；**4 个 TTL 数值一字未改 ⇒ 零行为变化**。**`replace_all` 安全性**：同族长名（`DEFAULT_CACHE_TTL`/`LIST_CACHE_TTL`/`POSITIVE_/NEGATIVE_CACHE_TTL_MS`）已**逐目标文件**核验均不在 4 个目标文件内 ⇒ 不误伤（且它们不在本键、未动）。**效果（可证伪）**：`lint:consts` **251 → 250**（−1 键），门禁自报 `同名常量:CACHE_TTL` **4→0** ⇒ 基线已**下调至 250 键**。**守卫**（第 **21** 例）：4 文件均不含 `const CACHE_TTL = ` 且各含确切新名与取值。**验证**：`typecheck`（app 三 tsconfig）**0** · `typecheck`（client）**0**；app 相关域 **880 pass / 0 fail**；**client 全量 vitest 73 文件全绿**（本片含 2 处 client 侧改动 ⇒ 不止跑 typecheck）；4 硬编码门禁全 **exit 0**。**如实边界**：① **本地化 vendored（`ink/`）第二次改动**（前次为 B5-2④ 的 `LINE_WIDTH_CACHE_MAX_ENTRIES`）⇒ 与上游分叉扩大，回并上游须一并处理；② 未跑全量 `bun test`（app 侧仅相关域）；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-5-CACHE-TTL`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第四项：`MAX_CACHE_SIZE` ×4 按域消歧（含单位入名）—— `lint:consts` 252 → 251 键（−1）** - **取证（CS06）**：门禁口径 4 文件 —— `constants/common.ts` `100 * 1024 * 1024`（**单位：字节**；**零消费者 ⇒ 假真源**）· `ink/ink/line-width-cache.ts` `1000`（条数）· `tokenBudget/ModelContextCache.ts` `10000`（条数）· `tools/ImageGenerateTool/ImageGenerationCache.ts` `100`（条数）。**判定**：4 处**连单位都不一致**（字节 vs 条数）⇒ **命名太泛** ⇒ 按域消歧，并**把量纲写进名字**（消除「同名不同量纲」误读风险）。**落地**：`MAX_CACHE_SIZE_BYTES` · `LINE_WIDTH_CACHE_MAX_ENTRIES` · `MODEL_CONTEXT_CACHE_MAX_ENTRIES` · `IMAGE_GENERATION_CACHE_MAX_ENTRIES`；**4 处数值与单位一字未改 ⇒ 零行为变化**。**关键决定（如实）**：本键**必须满 4 处才消键**（做 3 处会剩 2 definer、键仍在）⇒ 不可避免地动了两处非常规成员：**(a) 假真源** `constants/common.ts`（**只改名、未删除** —— 删除须过 CD01–CD06，另案；`typecheck` 0 反证零消费者）；**(b) 本地化 vendored** `ink/ink/line-width-cache.ts`（只改内部**私有**常量名，不引入依赖；该文件本已有中文化改动，若回并上游须处理此差异）。**效果（可证伪）**：`lint:consts` **252 → 251**（−1 键），门禁自报 `同名常量:MAX_CACHE_SIZE` **4→0** ⇒ 基线已**下调至 251 键**。**守卫**（第 **20** 例）：4 文件均不含 `const MAX_CACHE_SIZE = ` 且各含确切新名与取值。**验证**：`typecheck`（app 三 tsconfig）**0**；相关域 **1431 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① `memory/stores/MemoryStore.ts` 的**类私有属性**同名单**不在门禁键内** ⇒ 未动（同 `SimpleMutex` 先例）；② 假真源**未删**、vendored 面**已改动**（均记 `reopenWhen` ②）；③ 未跑全量 `bun test`；④ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-4-MAX-CACHE-SIZE`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第三项：`REQUEST_TIMEOUT_MS` ×5 按域消歧 —— `lint:consts` 253 → 252 键（−1）** - **取证（CS06）**：5 处同名 `REQUEST_TIMEOUT_MS` **全为文件内局部**（无 `export`）、取值 5 个全不同 —— `ai/providers/BalanceChecker.ts` `10000` · `channels/bluebubbles/BlueBubblesChannel.ts` `20000` · `channels/mattermost/MattermostChannel.ts` `15000` · `services/voice/services/senseVoiceSTTProvider.ts` `60_000` · `services/voice/services/localSTTProvider.ts` `30_000`。**判定**：分属**不同出站集成**（余额检查 / iMessage 渠道 / Mattermost 渠道 / 两个 STT 后端），各上游自有超时口径 ⇒ **命名太泛、不得归一** ⇒ 按域改名消歧。**落地**：`BALANCE_CHECK_REQUEST_TIMEOUT_MS` · `BLUEBUBBLES_REQUEST_TIMEOUT_MS` · `MATTERMOST_REQUEST_TIMEOUT_MS` · `SENSEVOICE_STT_REQUEST_TIMEOUT_MS` · `LOCAL_STT_REQUEST_TIMEOUT_MS`；**5 个超时数值一字未改 ⇒ 零行为变化**；**无 export ⇒ 零跨文件影响**。**`replace_all` 安全性核验**：同族长名（`DEFAULT_REQUEST_TIMEOUT_MS`/`OCR_REQUEST_TIMEOUT_MS`/`LSP_REQUEST_TIMEOUT_MS`）**均在别的文件** ⇒ 逐文件核验不误伤，且三者**不在本键、未动**。**效果（可证伪）**：`lint:consts` **253 → 252**（−1 键），门禁自报 `同名常量:REQUEST_TIMEOUT_MS` **5→0** ⇒ 基线已**下调至 252 键**。**守卫**（第 **19** 例）：5 文件均不含 `const REQUEST_TIMEOUT_MS = ` 且各含确切新名与取值。**验证**：`typecheck`（app 三 tsconfig）**0**；相关域 **624 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① `channels/**` 属 CD07 关键域 ⇒ **仅改名、未删实现、未改数值**；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-3-REQUEST-TIMEOUT-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-2 第二项：`SCHEMA` ×6 按域消歧 —— `lint:consts` 254 → 253 键（−1）** - **取证（CS06）**：6 处同名 `SCHEMA` 各是**不同表的 SQL DDL** —— `dream/DreamCycleDb.ts`（`dream_cycles`）· `tasks/db/schema.ts`（**export**，`task_states`，tasks DB 真源）· `tasks/cron/DeliveryQueue.ts`（`delivery_queue`）· `tasks/cron/CronRunLog.ts`（表名经 `${TABLE_CRON_RUN_LOGS}` 插值）· `tasks/cron/CronJobStore.ts`（`cron_jobs`）· `modules/calendar/AIScheduleIndex.ts`（`ai_schedules`）。**判定**：目标表名互异、无可合并事实 ⇒ **按域改名消歧**。**落地**：`DREAM_CYCLE_SCHEMA` · `TASKS_SCHEMA` · `DELIVERY_QUEUE_SCHEMA` · `CRON_RUN_LOG_SCHEMA` · `CRON_JOB_SCHEMA` · `AI_SCHEDULE_SCHEMA`；**DDL 文本与表名一字未改 ⇒ 对既有 SQLite 库零影响**。**跨文件同步（关键）**：`tasks/db/schema.ts#SCHEMA → TASKS_SCHEMA` 属**公开导出面** ⇒ 2 处 import（`SqliteTaskStore`/`GoalMetricsService`）+ 2 处 barrel 转出（`tasks/db/index.ts`/`tasks/index.ts`）+ **1 处 seed 脚本**（`app/scripts/seed-test-tasks.ts`，原以 `SCHEMA as TASK_SCHEMA` 别名导入）全部同步。**⚠️ 如实记录教训**：初查「脚本侧消费者」时只搜了仓库根 `scripts/`、**漏了 `app/scripts/`**（本仓有两处 `scripts` 目录）⇒ 由 **`typecheck`（含 `tsconfig.scripts.json`）当场拦下**（`TS2305`），修复后 0 ⇒ **跨文件改名必须依赖 `typecheck` 兜底，不能只靠 grep**。**效果（可证伪）**：`lint:consts` **254 → 253**（−1 键），门禁自报 `同名常量:SCHEMA` **6→0** ⇒ 基线已**下调至 253 键**；全仓 grep 复核裸 `SCHEMA` **仅剩 2 处注释**。**守卫**（第 **18** 例）：6 文件均不含 `const SCHEMA = ` 且各含确切新名与**目标表名**；并钉住 4 处导出面 + seed 脚本同步形态（含防别名回流断言）。**验证**：`typecheck`（app 三 tsconfig，含 scripts）**0**；相关域 **570 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① 本片**未夹带任何 DDL/表名变更**（加列/迁移须另立迁移片）；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-2-SCHEMA-DDL`。
- ✅ **硬编码治理 · 「同名常量」B5-2 首项：`DEFAULT_TTL_MS` ×9 按域消歧 —— `lint:consts` 255 → 254 键（−1）** - **取证（CS06）**：9 处同名 `DEFAULT_TTL_MS` 各属**独立缓存/锁** —— `cost/DailyCostCache.ts` `60_000` · `tasks/CrossProcessLock.ts` `60_000` · `core/cache/SessionCache.ts` `5 * 60 * 1000` · `core/approval/ApprovalCache.ts` `5 * 60 * 1000` · `memory/FrozenSnapshotService.ts` `60 * 60 * 1000` · `media/image/TempFileManager.ts` `30 * 60 * 1000` · `permission/ApprovedCommandRegistry.ts` `300_000` · `tools/ImageGenerateTool/ImageGenerationCache.ts` `3600 * 1000` · `services/file/FileStatsService.ts` `60_000`（取值 6 种、失效语义各异）。**判定**：属「**命名太泛**」⇒ **按域改名消歧**、**不强行合一**（含「同值不同写法」的快照 1h 与生图缓存 1h 亦不合一）。**落地**：`DAILY_COST_CACHE_TTL_MS` · `CROSS_PROCESS_LOCK_TTL_MS` · `SESSION_CACHE_TTL_MS` · `APPROVAL_CACHE_TTL_MS` · `FROZEN_SNAPSHOT_TTL_MS` · `TEMP_FILE_TTL_MS` · `APPROVED_COMMAND_TTL_MS` · `IMAGE_GENERATION_CACHE_TTL_MS` · `FILE_STATS_CACHE_TTL_MS`；**本键无跨文件消费侧**（全为文件内用例）· **9 个 TTL 数值一字未改 ⇒ 零行为变化**；`permission`（CD07 关键域）**仅改名不删**。**效果（可证伪）**：`lint:consts` **255 → 254**（−1 键），门禁自报 `同名常量:DEFAULT_TTL_MS` **9→0** ⇒ 基线已**下调至 254 键**。**守卫**（第 **17** 例）：9 文件均不含 `const DEFAULT_TTL_MS =` 且各含确切新名与取值。**验证**：`typecheck`（app 三 tsconfig）**0**；相关域 **793 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① 本片是 **B5-2 首项**（续项见台账 `reopenWhen`：`SCHEMA` 6 · `REQUEST_TIMEOUT_MS` 5 …）；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-2-1-DEFAULT-TTL-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-1 子项⑤（B5-1 收口）：`MAX_FILE_SIZE` ×6 按域消歧 —— `lint:consts` 256 → 255 键（−1）** - **取证（CS06）**：6 处同名 `MAX_FILE_SIZE` —— `app/src/constants/common.ts:72`（**export，零消费者 ⇒ 假真源**）`10 * 1024 * 1024` · `tools/FileReadTool/FileReadTool.ts:33` `10 MiB` · `tools/FileEditTool/FileEditTool.ts:73` `1 GiB` · `tools/FileWriteTool/FileWriteTool.ts:73` `1 GiB` · `client/src/components/ChatArea/FileAttachmentBar.tsx:33` `20 MiB` · `client/src/components/ChatArea/ChatInput.tsx:464` `20 MiB`（回调内局部）。**判定（如实标注与前四子项不同）**：本键**含 3 组同值对**（10 MiB / 1 GiB / 20 MiB）⇒ 但**合一须先裁定真源落位**（兄弟工具互引会倒置依赖；前端跨组件共享常量需新增出口；文案/断言需同步），且 `constants/common.ts` 处**零消费者**（假真源）⇒ 本片**统一按域消歧**、**把 3 组合一候选 + 假真源逐条登记**（不隐瞒「本可合一」）。**落地**：`FILE_READ_MAX_FILE_SIZE` · `FILE_EDIT_MAX_FILE_SIZE` · `FILE_WRITE_MAX_FILE_SIZE` · `ATTACHMENT_MAX_FILE_SIZE` · `CHAT_INPUT_ATTACHMENT_MAX_FILE_SIZE`；**5 处阈值字面量一字未改 ⇒ 零行为变化**；`constants/common.ts` 处**有意未动**（删除须过 CD01–CD06）。**效果（可证伪）**：`lint:consts` **256 → 255**（−1 键），门禁自报 `同名常量:MAX_FILE_SIZE` **6→0** ⇒ 基线已**下调至 255 键**。**守卫**（第 **16** 例）：5 文件均不含 `const MAX_FILE_SIZE =` 且各含确切新名与取值；另**正向钉住** `constants/common.ts` **仍保留**该名（防「顺手删假真源」）。**验证**：`typecheck`（app 三 tsconfig + client）**均 0**；app `tests/tools`+`tests/constants`+`File{Read,Edit,Write}Tool` **875 pass / 0 fail**；**client 全量 vitest 73 文件全绿**；4 硬编码门禁全 **exit 0**。**如实边界**：① **B5-1 五子项至此全部收口**；② 3 组同值对的**合一未做**、**假真源未删**（均属另案，见 `reopenWhen`）；③ 未跑全量 `bun test`（app 侧仅相关域）；④ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-1-MAX-FILE-SIZE`。
- ✅ **硬编码治理 · 「同名常量」B5-1 子项④：`DEFAULT_TIMEOUT_MS` ×8 按域消歧 —— `lint:consts` 257 → 256 键（−1）** - **取证（CS06）**：8 处同名 `DEFAULT_TIMEOUT_MS` 分属不同子系统的**独立超时**，取值各异 —— `ai/embedding/providers/LocalEmbeddingProvider.ts` `180_000` · `ai/providers/SpeedTestService.ts` `8000` · `evals/adversarialProposer.ts` `60_000` · `sandbox/utils/TimeoutController.ts` `300000`（**唯一跨文件真源**）· `session/lock/PrioritySessionLock.ts` `30_000` · `services/mcp/transports/StreamableHttpTransport.ts` `30_000` · `tools/CodeRunner/{CrossPlatformRunner,CodeRunnerTool}.ts` `60_000` ×2。**判定**：属「**命名太泛**」⇒ **按域改名消歧**、**不强行合一**。**落地**：`EMBEDDING_DEFAULT_TIMEOUT_MS` · `SPEED_TEST_DEFAULT_TIMEOUT_MS` · `ADVERSARIAL_DEFAULT_TIMEOUT_MS` · `SANDBOX_DEFAULT_TIMEOUT_MS` · `SESSION_LOCK_DEFAULT_TIMEOUT_MS` · `MCP_TRANSPORT_DEFAULT_TIMEOUT_MS` · `CROSS_PLATFORM_RUNNER_DEFAULT_TIMEOUT_MS` · `CODE_RUNNER_TOOL_DEFAULT_TIMEOUT_MS`；**唯一跨文件消费侧** `sandbox/SandboxManager.ts`（导入 + 用法）**同步改名**。**8 个超时数值一字未改 ⇒ 零行为变化**；`sandbox` 属 CD07 关键域 ⇒ **仅改名、未删实现**。**效果（可证伪）**：`lint:consts` **257 → 256**（−1 键），门禁自报 `同名常量:DEFAULT_TIMEOUT_MS` **8→0** ⇒ 基线已**下调至 256 键**。**守卫**（第 **15** 例）：8 文件均不含 `const DEFAULT_TIMEOUT_MS =` 且各含确切新名与取值；另单独钉住 `SandboxManager` 已无旧名、含新名。**验证**：`typecheck`（app 三 tsconfig + client）**均 0**；相关域 **650 pass / 0 fail**；4 硬编码门禁全 **exit 0**。**如实边界**：① 本片是 **B5-1 的 4/5 子项**（余 `MAX_FILE_SIZE` ×6）；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）；④ `CodeRunner` 两处同值 `60_000` 本片**按域消歧保留两处**（合一须先走查 `LinuxSandboxRunner` 转发链）；⑤ `SimpleMutex` 的**类静态**同名常量不在门禁键内 ⇒ 未动。证据 `HARDCODE-SAME-NAME-CONSTS-B5-1-DEFAULT-TIMEOUT-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-1 子项③：`CACHE_TTL_MS` ×7 按域消歧 —— `lint:consts` 258 → 257 键（−1）** - **取证（CS06）**：7 处同名 `CACHE_TTL_MS` 各属**独立缓存**（`ai/models/ActiveModelService.ts` 启用模型定价记录 · `ai/translation/LanguageDetector.ts` 语种检测结果 · `chat/services/PathGuardService.ts` 路径存在性 · `config/settings/CheckpointLogConfig.ts` config.json 读取 · `services/prompt/PromptVersionManager.ts` prompt overrides · `tokenBudget/ModelContextCache.ts` 上下文窗口 · `client/src/services/imageService.ts` 前端图片请求）。**判定**：**无一处是同一事实的副本**（缓存对象与失效语义各不相同；数值相同属巧合 —— 4 处 `30_000`、2 处 `5 * 60 * 1000`）⇒ 属「**命名太泛**」⇒ **按域改名消歧**、**不强行合一**。**落地**（7 文件各 2 处裸 token；全仓核验 `DEFAULT_CACHE_TTL_MS`/`TOOL_SUPPORT_CACHE_TTL_MS`/`SEARCH_CACHE_TTL_MS` **不含**裸 token ⇒ `replace_all` 不误伤）：`ACTIVE_MODEL_CACHE_TTL_MS` · `LANGUAGE_DETECTION_CACHE_TTL_MS` · `PATH_GUARD_CACHE_TTL_MS` · `CHECKPOINT_LOG_CACHE_TTL_MS` · `PROMPT_VERSION_CACHE_TTL_MS` · `MODEL_CONTEXT_CACHE_TTL_MS` · `IMAGE_SERVICE_CACHE_TTL_MS`。**7 个 TTL 数值一字未改 ⇒ 零行为变化**。**效果（可证伪）**：`lint:consts` **258 → 257**（−1 键），门禁自报 `同名常量:CACHE_TTL_MS` **7→0** ⇒ 基线已**下调至 257 键**。**守卫**（第 **14** 例）：7 文件均不含 `const CACHE_TTL_MS =` 且各含**确切新名 + 取值钉住**。**验证**：`typecheck`（app 三 tsconfig）**0** · `typecheck`（client）**0**；相关域 **974 pass / 2 fail** —— 两失败经 `git stash` **HEAD 对照实测同现**（`Q-H2 ③` · `HD-P1-1 ③`；HEAD 973 pass / 2 fail）⇒ **既有、非本片引入**；4 硬编码门禁全 **exit 0**。**如实边界**：① 本片是 **B5-1 的 3/5 子项**（余 `DEFAULT_TIMEOUT_MS` ×8 · `MAX_FILE_SIZE` ×6）；② 未跑全量 `bun test`；③ `client` 侧未跑 `vitest`（无既有前端测试命中）；④ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-1-CACHE-TTL-MS`。
- ✅ **硬编码治理 · 「同名常量」B5-1 子项②：`DEFAULT_BASE_URL` ×5 按域消歧 —— `lint:consts` 259 → 258 键（−1）** - **取证（CS06）**：5 处 base URL —— OpenAI 两处（`ai/providers/OpenAIProvider.ts` · `ai/embedding/providers/OpenAIEmbeddingProvider.ts`）**同值** `'https://api.openai.com/v1'`；`LlamaCppProvider` `'http://127.0.0.1:11435/v1'`；`GoogleProvider` `'https://generativelanguage.googleapis.com/v1beta'`；`OllamaProvider` = **`DEFAULT_OLLAMA_ENDPOINT` 的本地别名**。**判定**：全属「命名太泛」（各 provider 自有 base URL，本就该不同）⇒ **按域消歧**、**不强行合一**。**落地**（12 处全为裸 token ⇒ `replace_all` 安全；**零依赖变更、零成环风险**）：`OPENAI_PROVIDER_BASE_URL` · `OPENAI_EMBEDDING_BASE_URL`（**有意保留为两个独立配置点**） · `LLAMACPP_PROVIDER_BASE_URL` · `GOOGLE_PROVIDER_BASE_URL`；Ollama 处**删本地别名**（同 `HD-P1-2 A8` 手法）⇒ 直接用真源 `DEFAULT_OLLAMA_ENDPOINT`。**URL 字面量一字未改 ⇒ 零行为变化**。**效果（可证伪）**：`lint:consts` **259 → 258**（−1 键），门禁自报 `同名常量:DEFAULT_BASE_URL` **5→0** ⇒ 基线已**下调至 258 键**。**守卫**（第 **13** 例）：4 provider 均不含 `const DEFAULT_BASE_URL =` 且各含确切新名；`OllamaProvider` 整体不含该名且含真源名。**验证**：`typecheck`（app 3 tsconfig）**0**；`eslint`（5 文件）**0 errors / 1 warning**（warning 未逐条溯源）；`tests/ai`+`src/ai` **250 pass / 0 fail**；4 硬编码门禁全 **exit 0**；提交前钩子（含架构门禁）通过。**如实边界**：① 本片是 **B5-1 的 2/5 子项**（余 `CACHE_TTL_MS` ×7 · `DEFAULT_TIMEOUT_MS` ×8 · `MAX_FILE_SIZE` ×6）；② 未跑全量 `bun test`；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-1-BASE-URL`。
- ✅ **硬编码治理 · 「同名常量」B5-1 子项①：`TABLE_NAME` ×5 按域改名消歧 —— `lint:consts` 260 → 259 键（−1）** - **取证（CS06）**：`TABLE_NAME` ×5 且**取值全不同**（`'tasks'` · `'project_items'` · `'taor_checkpoints'` · `'translate_history'` · `'router_session_routes'`）⇒ 属「**命名太泛**」（非重复事实源，**不得**合一，对齐 `HD-P1-2 A8` 先例）⇒ 处置 = **按域改名消歧**。**落地**：5 个 store 各一次 `replace_all` 改名为 `TASKS_TABLE_NAME` / `PROJECT_ITEMS_TABLE_NAME` / `TAOR_CHECKPOINTS_TABLE_NAME` / `TRANSLATE_HISTORY_TABLE_NAME` / `SESSION_ROUTER_TABLE_NAME`；grep 证全仓 `TABLE_NAME` **仅作裸 token**（无更长标识符包含它）⇒ `replace_all` 不误伤；**表名字符串一字未改** ⇒ 对 SQLite 表名与存量数据**零影响**。**效果（可证伪）**：`lint:consts` **260 → 259**（−1 键），门禁自报 `同名常量:TABLE_NAME` **5→0** ⇒ 基线已**下调至 259 键**。**守卫**（第 **12** 例）：五文件均不含 `const TABLE_NAME =` 且各含**确切新名 + 原表名字符串**⇒ **12 pass / 0 fail**。**验证**：`tests/ai`+`src/ai` **250 pass / 0 fail**；`typecheck`（app 3 tsconfig）**0**；`eslint`（5 文件）首轮 **8 errors**（prettier 行宽，新名更长）**已 `--fix`** ⇒ **0**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① 本片是 **B5-1 的 1/5 子项**；② 未跑全量 `bun test`（仅相关域；`workspace`/`query` 无既有测试命中）；③ 未做真机走查（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B5-1-TABLE-NAME`。
- ✅ **硬编码治理 · 「同名常量」B3-4：`CRED_STORED_MARKER` 真源上提到 infra（`constants/common.ts`），消除 `chronos` 的跨层复刻 —— `lint:consts` 261 → 260 键（−1）** - **取证（CS06）**：`ai/credentials/CredentialStore.ts:50`（**export**，app 层）与 `chronos/maintenance/ChronosBackgroundHousekeeping.ts:48`（私有，infra 层）同值 `'__stored__'`；**后者注释自述**「本地复刻**避免跨层引用**」（D-146）⇒ 属**为绕开分层而人为复刻**的重复事实源。**分层核实**（`modules-to-layers.json`）：`ai`=**app** · `chronos`=**infra** · `constants`=**infra** ⇒ 真源**上提到 infra** 后 `chronos`(infra→infra) 与 `ai`(app→infra) **均合法** ⇒ 复刻理由消失。**消费面**：app 层 4 个消费者（`ProviderManager`×5 · `ProviderSyncService` · `ProviderAPI` · barrel `ai/credentials/index.ts`）⇒ 为**零改动**保留 `CredentialStore.ts` **导出面**（改**纯转出** `export { … } from '@modules/constants'`；`typecheck` 证实该常量在其内部无消费 ⇒ 纯转出成立）。**落地**：`constants/common.ts` 新增真源（含 docstring）；`CredentialStore.ts` → 纯转出；`chronos` 侧删复刻改直引（infra→infra）并改写 D-146 注释。**效果（可证伪）**：`lint:consts` **261 → 260**（−1 键），门禁自报 `同名常量:CRED_STORED_MARKER` **2→0** ⇒ 基线已**下调至 260 键**。**守卫**（第 **11** 例）：真源存在；`chronos` 与 `CredentialStore` 均不含 `const CRED_STORED_MARKER =`；`CredentialStore` 含确切转出形态 ⇒ **11 pass / 0 fail**。**验证**：`tests/ai`+`src/ai`+`src/chronos` **250 pass / 0 fail（830 expect）**；`typecheck`（app 3 tsconfig）**0**；`eslint`（3 改动文件）**0 问题**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① `src/chronos` **无既有测试**（250 例与仅 `tests/ai`+`src/ai` 时相同 ⇒ chronos 贡献 0）⇒ 等价性证据 = 同值字符串 + 纯引用替换 + `typecheck`；② 未做真机走查（`e2eVerified=false`）；③ 真源落 `constants/common.ts` 语义偏泛（若将来有凭据专属 infra 模块宜迁往）。证据 `HARDCODE-SAME-NAME-CONSTS-B3-4-CRED-MARKER`。
- ✅ **硬编码治理 · 「同名常量」B3-3：`MODEL_ALIASES` 顺序漂移归一到真源 `ai/models/ModelAliases.ts` —— `lint:consts` 262 → 261 键（−1）** - **取证（CS06）**：`ai/models/ModelAliases.ts:104`（`['best','fast','pro','flash']`）与 `ai/AIModelManager.ts:28`（`['best','pro','flash','fast']`）**同集合、顺序不同** ⇒ **同一事实的漂移副本**（非「命名太泛」）。**真源判定依据**：barrel `ai/index.ts:64` 的 `export { MODEL_ALIASES } from './models/ModelAliases'` ⇒ **对外唯一出口**取自 `models/ModelAliases`，`AIModelManager` 侧那份是**影子副本**；grep 证其 `MODEL_ALIASES`/`ModelAlias` **零外部消费者** ⇒ **直接改导入、不保留重导出**（避免 backwards-compat shim）。**⚠️ 行为变更（有意，已登记）**：`AIModelManager.getModelAliases()` 返回顺序由 `best,pro,flash,fast` 变为真源 `best,fast,pro,flash`（**集合不变**），该顺序经 `AIStateSyncService`（`:54`/`:82`/`:143`）出现在同步载荷 ⇒ **可观测**；本片消除的是「顺序取决于从哪个入口取」的**不确定性** ⇒ 判为**修复**。**效果（可证伪）**：`lint:consts` **262 → 261**（−1 键），门禁自报 `同名常量:MODEL_ALIASES` **2→0** ⇒ 基线已**下调至 261 键**。**守卫**（第 **10** 例）：真源取值钉住 + `AIModelManager` 不含 `export const MODEL_ALIASES =` 且含确切 import ⇒ **10 pass / 0 fail**。**验证**：`tests/ai`+`src/ai` **250 pass / 0 fail（830 expect）**；`typecheck`（app 3 tsconfig）**0**；`eslint`（改动文件）**0 问题**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① 未做真机走查（`e2eVerified=false`）；② `getModelAliases()` 下游消费者**未逐一追到底**（仅确认 `AIStateSyncService` 转发）⇒ 若下游对顺序有硬依赖须回看 `reopenWhen` ②。证据 `HARDCODE-SAME-NAME-CONSTS-B3-3-MODEL-ALIASES`。
- ✅ **硬编码治理 · 「同名常量」B3-2：`MAX_STATUS_CHARS` ×3 与 `LLAMACPP_PROVIDER_TYPE` ×2 两组真重复合一 —— `lint:consts` 264 → 262 键（−2）** - **取证（CS06）**：两组均**同值同义**（非「命名太泛」）——`MAX_STATUS_CHARS` ×3（`context/GitDetector.ts` · `context/GitContextService.ts` · `context/services/SystemContextService.ts`，同模块同值 `2000`，同义「git status 输出截断」）· `LLAMACPP_PROVIDER_TYPE` ×2（`ai/local/llama/LlamaCppServerManager.ts` + `registerLlamaCppProvider.ts`，同目录同值 `'llamacpp' as const`）。**真源位置由「依赖方向安全」决定（避免成环）**：① `LLAMACPP_PROVIDER_TYPE` ⇒ 只能落 **manager 侧**（grep 证实 `registerLlamaCppProvider` **本就已** `import { llamaCppServerManager, … } from './LlamaCppServerManager.js'`；反向则**倒置依赖**极可能成环）⇒ 在**既有 import 上追加名字**（未新增 import 语句）；② `MAX_STATUS_CHARS` ⇒ 取 `GitDetector`（三者**公共底座**）为真源，另两处改同模块相对导入（三文件**互不引用**、已 grep 证无环）。**落地**：两真源常量改 `export` + docstring 声明「唯一真源」；三处消费侧删本地 `const`（llama 侧同时**合并其上残留的旧一行注释**）。**效果（可证伪）**：`lint:consts` **264 → 262**（−2 键），门禁自报 `同名常量:MAX_STATUS_CHARS` **3→0** · `同名常量:LLAMACPP_PROVIDER_TYPE` **2→0** ⇒ 基线已**下调至 262 键**。**守卫**（第 **9** 例）：两真源存在 + 声明唯一真源；三消费侧无本地 `const` 且含各自确切 import 形态 ⇒ **9 pass / 0 fail**。**验证**：`tests/context`+`tests/ai` **360 pass / 0 fail（1106 expect）**；`typecheck`（app 3 tsconfig）**0**；`eslint`（5 改动文件）**0 errors / 1 warning**（既有 `validateConfig` complexity，非本片引入）；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① `MAX_STATUS_CHARS` 合并**新增 import 边**（轻量、无环、已证）⇒ 判为可接受；② provider 类型**全集**仍散在 `ProviderManager` union / `ProviderFactory` case / `VALID_PROVIDER_TYPES` ⇒ 未来「provider 类型统一」时应改以 union 为真源（属 provider 域治理）；③ **未做真机走查**（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B3-2-PROVIDER-GIT-CONSTS`。
- ✅ **硬编码治理 · 「同名常量」B3-1：`CHANNEL` ×3 按适配器改名消歧 · `DEFAULT_OLLAMA_URL` ×2 去本地别名 —— `lint:consts` 266 → 264 键（−2）** - **取证（CS06，6 组一次取全值）**：`CHANNEL` ×3（`agent/orchestration/` **同目录**三适配器，值**各不相同** `'remote'`/`'local-scheduler'`/`'local-swarm'`）· `DEFAULT_OLLAMA_URL` ×2（均为 `= DEFAULT_OLLAMA_ENDPOINT` 的**本地别名**）· `MAX_STATUS_CHARS` ×3（同目录同值 2000）· `LLAMACPP_PROVIDER_TYPE` ×2（同目录同值）· `MODEL_ALIASES` ×2（**顺序不同**）· `DEFAULT_IDLE_TIMEOUT_MS` ×2（同值异事实）。**分类处置（非一刀切）**：① `CHANNEL` = **同名异值** ⇒ 「**命名太泛**」⇒ **按适配器改名消歧**（`SWARM_CHANNEL`/`SCHEDULER_CHANNEL`/`REMOTE_CHANNEL`），**字符串值一字未改** ⇒ 零行为变化（各 3 处）；② `DEFAULT_OLLAMA_URL` = **同一事实的两个本地别名** ⇒ **删别名、直用真源名**（`core/endpoints.ts#DEFAULT_OLLAMA_ENDPOINT` 两文件**本就已导入** ⇒ **零新增依赖**；共 4 处替换）；③ `MAX_STATUS_CHARS`/`LLAMACPP_PROVIDER_TYPE`（真重复）**列为本批候选但本片未做**（须先验 import 关系防成环 / 先查是否已有 provider 类型真源）；④ `MODEL_ALIASES`（顺序语义未判定）与 `DEFAULT_IDLE_TIMEOUT_MS`（同值异事实）**有意不合一**（对齐 `HD-P1-2 A8` 先例）；⑤ `CRED_STORED_MARKER` 因**跨层**（`chronos`=infra 不得引 `ai`=app）未做 ⇒ 真源须落 infra/core。**效果（可证伪）**：`lint:consts` **266 → 264**（−2 键），门禁自报 `同名常量:CHANNEL` **3→0** · `同名常量:DEFAULT_OLLAMA_URL` **2→0** ⇒ 基线已**下调至 264 键**。**守卫**（扩至 `sameNameConstsB2.test.ts` 第 **8** 例）：三适配器无 `const CHANNEL =` + 各含新名与 `[新名]`；两 ollama 文件无 `const DEFAULT_OLLAMA_URL` 定义 + 含真源名 ⇒ **8 pass / 0 fail（68 expect）**。**验证**：`tests/agent`+`tests/ai`+`tests/constants` **295 pass / 0 fail（998 expect）**；`typecheck`（app 3 tsconfig）**0**；`eslint`（5 改动文件）**0 问题**（首轮 2 prettier 缩进错已 `--fix`）；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① 本片只消 **2 键**；② **未做真机走查**（`e2eVerified=false`）；③ `CHANNEL` 改名为纯标识符变更，**可观测值未变**。证据 `HARDCODE-SAME-NAME-CONSTS-B3-1-CHANNEL-ALIAS`。
- ✅ **硬编码治理 · 「同名常量」B2b-2：oauth AES-256-GCM 参数 5 个合一 + PBKDF2 盐改名消歧 · `WAV_HEADER_SIZE` 合一 —— `lint:consts` 273 → 266 键（−7）** - **取证（CS06）**：基线实测 7 键 —— `ALGORITHM`(2) · `IV_LENGTH`(2) · `AUTH_TAG_LENGTH`(2) · `KEY_LENGTH`(2) · `ITERATIONS`(**3**) · `PBKDF2_SALT`(2) · `WAV_HEADER_SIZE`(3)。**关键判断 1（推翻「双轨」假设）**：`oauth/OAuthProviderStore.ts`（provider/`clientSecret` 存储，经 `oauth/index.ts` → `oauth-handlers.ts` 使用，有 `src/oauth/__tests__/OAuthProviderStore.test.ts`）与 `oauth/services/OAuthStorage.ts`（token 存储，被 `TokenManager`/`OAuthStartup`/`MCPAuth` 使用）是**两个不同用途、且都活**的存储 ⇒ **不是双轨**，只是**各自复制了同一套加密参数**。**关键判断 2（安全优先：不合并实现）**：两处实现实质不同 —— PBKDF2 **盐不同**（`pyapp-oauth-salt-v2` vs `pyapp-oauth-provider-salt-v1`）、派生方式不同（回调式 `pbkdf2` vs `pbkdf2Sync`）、密文编码不同 ⇒ 合并会**破坏存量密文解密（不可逆）** ⇒ 本片**只收敛参数常量**，实现**逐字不动**（结论写入真源 ⚠️ docstring 防后人误合）。**落地**：① 参数真源 = `oauth/utils/OAuthCrypto.ts`（原为 PKCE 工具，语义域同属 OAuth 加密且**不新增文件** ⇒ 规避 R06-009-1 小文件告警），新增 5 个**带前缀**常量；两消费侧删本地定义 + **别名导入**保留局部名（`OAUTH_CIPHER_ALGORITHM as ALGORITHM` …）⇒ 实现与 **16 处用法零改动**；② **盐改名消歧**（`PROVIDER_PBKDF2_SALT` / `TOKEN_PBKDF2_SALT`，**字面值一字未改** ⇒ 存量密文照常解密）；③ `WAV_HEADER_SIZE` 真源 = `services/voice/services/audioUtils.ts`（**零依赖叶子文件** ⇒ 无环），3 处消费侧改引真源。**效果（可证伪）**：`lint:consts` **273 → 266**（−7 键），门禁自报 7 键**各自 → 0** ⇒ 基线已**下调至 266 键**。**守卫**（扩至 `sameNameConstsB2.test.ts` 第 **6/7** 例）：oauth 真源 **5 个取值逐个钉住** + 两 store 无 6 种 `const` 定义 + 均含别名导入 + **盐字面值仍在**（防「顺手把盐也统一」）；`WAV_HEADER_SIZE` 真源 + 3 消费侧形态 ⇒ **7 pass / 0 fail（55 expect）**。**验证**：**安全行为回归** —— `bun test src/oauth` **3 pass / 0 fail（12 expect）**（加解密**往返**测试 ⇒ 密文可解、行为不变）；`tests/http`+`src/services/voice` **202 pass / 0 fail（785 expect）**；`typecheck`（app 3 tsconfig）**0**；`eslint`（7 改动文件）**0 问题**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① `src/services/voice` **无既有测试**（202 例全部来自 `tests/http`）⇒ `WAV_HEADER_SIZE` 的等价性证据为「字面值同为 `44` + 纯引用替换」+ `typecheck`，**非**行为测试；② **未做真机走查**（`e2eVerified=false`）；③ 两处加密实现仍重复 ⇒ 实现合一须先出**双盐试解 + 原样重写**的迁移专项（见 `reopenWhen`）；④ **别名导入**是有意取舍（安全代码最小 diff vs 名称同形）。证据 `HARDCODE-SAME-NAME-CONSTS-B2B2-OAUTH-VOICE-PARAMS`。
- ✅ **硬编码治理 · 「同名常量」B2b：`TASKS_PATH` 收敛到 `types/a2a.ts` 的 `A2A_TASKS_PATH` —— `lint:consts` 274 → 273 键（−1）** - **取证（CS06）**：门禁报 `同名常量:TASKS_PATH`（2 文件）——`infrastructure/http/handlers/routes/a2a-routes.ts` 与 `infrastructure/http/a2a/discoverySidecar.ts` **各写一份**，且后者注释**自述**「与 `a2a-routes.ts` 的 `TASKS_PATH` 同口径」⇒ **确为同值同义的重复事实源**（非「命名太泛」）。**真源抉择（CS01，含否决理由）**：① **否决** `core/endpoints.ts` —— 它自述职责为「端点 / 本地 host 的**唯一事实源**」（`127.0.0.1` / Ollama / 微信 bot / 本地 OAuth 等**出站或绑定默认值**），塞入**本仓服务端路由路径**会造成语义混淆（其 docstring 还专门划了与 `core/ports.ts` 的分工）；② **否决** `core/paths.ts`（那是**文件系统路径**）；③ **否决新建 core 模块** —— 后端路由路径**无既有集中真源**（实测：`OPENAI_TTS_PATH`/`OPENAI_STT_PATH` 是**上游 provider 路径**、`/v1/videos/static/`·`/v1/images/static/` 是**静态前缀**，均非同族）⇒ 为 1 个常量新建模块属**新造真源**、违反 CS01；④ **采用 `types/a2a.ts`** —— 该文件**已有** `A2A_RPC_PATH` 并自述「**单一事实源**：HTTP 路由（`a2a-routes.ts`）与 Agent Card 的 `supportedInterfaces[0].url`（`agentCard.ts`）**共用** ⇒ 不会漂移」⇒ **A2A 路径的规范归宿已由仓库自己确立**，`A2A_TASKS_PATH` 与其**同族同层**（core `types` 层 ⇒ 任意层可引）。**依赖方向（无新增方向、无成环）**：`discoverySidecar.ts` **原本已** `import { isA2AAuthorized } from '../handlers/routes/a2a-routes'`；`a2a-routes.ts` **原本已** `import { A2A_RPC_PATH } from '@modules/types/a2a'`（service → core ✓）⇒ 本片仅**追加名字**、**未新增 import 语句**；反向无引用 ⇒ 无环。**落地**：真源新增（含 docstring）；两消费侧删本地 `const`（各留指针注释）+ 改引真源 + 共 **5 处**用法改名（`isA2APath` 两行 · 派发两行 · sidecar 一行）。**效果（可证伪）**：`lint:consts` **274 → 273**（−1 键），门禁自报「可下调基线的键：`同名常量:TASKS_PATH`：基线 2 → 当前 0」⇒ 基线已**下调至 273 键**。**守卫**（扩至 `sameNameConstsB2.test.ts` 第 **5** 例）：真源存在 + 取值钉住 + 声明「单一事实源」；两消费侧均**不含** `const TASKS_PATH =`、均含 `A2A_TASKS_PATH`，且**分别断言确切 import 形态** ⇒ **5 pass / 0 fail（25 expect）**。**验证**：**行为回归** —— `bun test tests/http` **202 pass / 0 fail（785 expect）**（含 `a2aRoutes.test.ts` 的路由/鉴权/405/404 断言 ⇒ 改引真源后**行为不变**）；`typecheck`（app 3 tsconfig）**0**；`eslint`（3 改动文件）**0 问题**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① `app/tests/http/a2aRoutes.test.ts` 内仍有**独立副本**（请求路径）—— **有意保留**：真源若漂移则路由不匹配、测试即红 ⇒ 属**独立契约断言**（门禁扫描面本就不含 `app/tests`）；② `HEALTH_PATH` / `WELL_KNOWN_AGENT_CARD` 当前**单处定义** ⇒ 本片不动（避免扩大范围）；③ **未做真机走查**（`e2eVerified=false`）。证据 `HARDCODE-SAME-NAME-CONSTS-B2B-A2A-TASKS-PATH`。
- ✅ **硬编码治理 · 「同名常量」B2：协议/格式常量合一 —— `lint:consts` 277 → 274 键（−3）** - **取证**：三组「同名常量在 ≥2 文件各写一份」——`RESET`（`cli/print.ts` + `commands/tasks/tasks.ts`，均 module-private）· `CHANNEL_TAG`（`chat/ChannelMessageParser.ts` + `constants/xml.ts`）· `BYTES_PER_TOKEN`（`services/toolResultStorage/types.ts` + `constants/toolLimits.ts`）。**分层判定（R00-001，决定性依据）**：依 `scripts/modules-to-layers.json`，`constants`/`utils`=**infra**、`chat`/`commands`/`tools`=**app**、`cli`/`ink`=**ui**、`services`/`infrastructure`/`voice`=**service**、`acp`/`core`/`types`=**core** ⇒ 三组消费侧均可**合法引用 infra 真源**。**处置（保留单一真源 + 消费侧改「引用/转出」⇒ 导出面不变、零消费者改动、零行为变化）**：① `CHANNEL_TAG` → 消费侧改 `import { CHANNEL_TAG } from '@modules/constants'` + `export { CHANNEL_TAG }`（保留导出面，本地正则仍用）；② `BYTES_PER_TOKEN` → 消费侧改 `export { BYTES_PER_TOKEN } from '@modules/constants'`（本地无消费）；③ `RESET` → 在 **`constants/figures.ts` 新增唯一真源 `ANSI_RESET`**（命名加前缀消歧），两处改引真源并改名（1 处 `result +=` + 5 处模板串）；`print.ts` 的 ANSI 族其余成员（`BOLD`/`ITALIC`/`UNDERLINE`）**单处使用**故未搬运（真源注释已说明）。**如实 defer（附理由，不强行合一）**：① `MAGIC_GUID`（RFC 6455，3 处：`acp/websocket.ts`(core) + `voice/upgrade.ts` + `voice/WakeWebSocketServer.ts`）—— 真源须在 **core** 层才能被 core 与 service 共用，而唯一候选 `@modules/acp/websocket` **非**规范子入口（R03-002 风险）、`constants`=infra **不可**被 core 引用；② `ELLIPSIS`（`constants/figures.ts` + `ink/ink/wrap-text.ts`）—— `ink/` 系**本地化第三方库**，有意自持渲染符号（R07-003 语境），不让 vendored 库反向依赖宿主常量。**效果（可证伪）**：`lint:consts` **277 → 274**（−3 键），门禁自报「可下调基线的键：`同名常量:CHANNEL_TAG`/`RESET`/`BYTES_PER_TOKEN` 各 2→0」⇒ 基线已**下调至 274 键**。**守卫** `app/tests/constants/sameNameConstsB2.test.ts`（**4 例**：真源存在 + 取值钉住 · 原副本不再定义且**确用新名**（防「只改 import 未改用法」）· `CHANNEL_TAG`/`BYTES_PER_TOKEN` 消费侧仅保留导出面）⇒ **4 pass / 0 fail（17 expect）**。**验证**：`typecheck`（app 3 tsconfig）**0**；`eslint`（5 改动文件）**0 问题**；4 硬编码门禁全 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**。**如实边界**：① 本片只消 **3 键**；`TASKS_PATH`（应入 `core/endpoints.ts`）/ oauth ×4（两文件疑似**双份加密实现**，宜先裁定双轨）/ `WAV_HEADER_SIZE`（3 处同目录）留 **B2b**；② **未做真机走查**（`e2eVerified=false`）、未新增运行时行为测试（本片性质为字面量归位）。证据 `HARDCODE-SAME-NAME-CONSTS-B2-PROTOCOL-CONSTS`。
- ✅ **硬编码治理 · 「同名常量」第一批：删除零消费者的死副本目录 `app/src/utils/constants/` —— `lint:consts` 291 → 277 键（−14）** - **取证（先量化，CS06）**：`lint:consts` 共 **291 键 = 同名常量 189 + 同值host 102**；为分诊「同名常量」，用**临时分析脚本**（`%TEMP%` 内、**不入仓**；口径对齐 `lint-consts.ts`）按名聚合并比对**取值** ⇒ **同名组 184 · 同值 75 · 异值 109**（脚本 184 与门禁 189 之差来自多行值/行尾分号的正则差异，**如实说明**）。**关键判断（防误合一）**：① **异值同名≠重复事实源**，而是**命名太泛** —— 实证 `REQUEST_TIMEOUT_MS` **5 文件 5 个值**（bluebubbles 20000 · senseVoiceSTT 60_000 · localSTT 30_000 · mattermost 15000 · BalanceChecker 10000）、`DEFAULT_TTL_MS` **9 文件 ≥4 值** ⇒ 按 `HD-P1-2 A8` 先例**不得强行合一**（会改行为）；② **同值≠应合一**（如 `SCHEMA_VERSION = 1` 两处分属 rollback/AppLifecycle，巧合同值）⇒ **故只取最干净的一类：零消费者死副本**。**落地**：删除 `app/src/utils/constants/`（`index.ts`+`apiLimits.ts`+`oauth.ts`）—— 其 **11** 个 API 限值常量与**真源** `app/src/constants/apiLimits.ts`（80 行带注释）**逐字同值**、**6** 个 OAuth 常量与 `app/src/system/auth/oauthConfig.ts` **重名**；**CD01–CD07 六步核查**逐条留证（全仓 grep `utils/constants` **0 命中**，含 `import(`/`require(` 变体、`app/tests`、`client/`、`scripts/`、构建入口与注册表；barrel 本身零消费者、`utils/index.ts` 未 re-export；`typecheck` 0 错 = **无编译期消费者**；独立提交 + `git revert` 回滚；`utils/constants` **非** CD07 关键域）。**效果（可证伪）**：违规 **291 → 277**（**−14 键**）⇒ 基线已 `HARDCODE_GATE_BASELINE_WRITE=1` **下调至 277 键**。**顺带修复（本片发现的回归，如实）**：跑 `tests/gates` 发现 **1 fail** —— `gateSelfProof.test.ts`「【合法样例】通过（退出 0）」；**根因**：`HARDCODE-R05-003-CONSOLE-SINGLE-SOURCE` 把 R05-003 改为 **fail-closed**（缺 `scripts/console-baseline.json` ⇒ 报 error），而该测试的**夹具工程**未同步提供该前置 ⇒ 因**缺文件**变红（**非源码缺陷**，与 2026-10-13 `GATE-SELFPROOF-R09006-FIXTURE` 同型）；**修复**：新增夹具助手 `writeConsoleBaseline()`，为 `legalDir`/`illegalDir` 补该真源。**教训（如实）**：该回归**未被 R05-003 片检出**（当时只跑该片 2 个守卫、**未跑 `tests/gates` 全量**）。**验证**：`tests/gates` **83 pass / 0 fail（240 expect）**；`typecheck`（app 3 tsconfig）**0**；4 硬编码门禁链式 **exit 0**；`lint:arch` **错误 0 / 警告 5（无回归）**；`lint:scripts` **0 error / 28 warning**。**如实边界**：① 本片仅消 **14 键**，**剩余 189 键中多数属「命名太泛」（异值 109）或「两处都活」** ⇒ 须后续分批：**异值类**建议按域**重命名消歧**（跨文件重命名，须单独出片）；**同值且两处都活**类须先定真源再改引用（注意 R00-001 分层）；② **未做真机走查**（`e2eVerified=false`）；③ 分析脚本**未入仓**，其口径差异已如实记录、不作为门禁依据。证据 `HARDCODE-SAME-NAME-CONSTS-B1-DEAD-DUP`。
- ✅ **硬编码治理 · `R05-003`（Console 调用基线）双源收敛：两套实现 + 两个阈值 → 单一实现 + 单一真源** - **取证（先证双源真实存在，CS06）**：① 门禁 `scripts/lint-architecture.ts#checkConsoleBaseline` —— 计数 `log|warn|error|debug`（**4 名**）**按出现次数**、阈值 `scripts/console-baseline.json`（`count 2045` + `threshold 0.10` ⇒ 上限 **2250**），且用 `resolve(process.cwd(), 'scripts', …)` **定位基线** ⇒ 从 `app/` 跑时落到不存在的 `app/scripts/…`，`existsSync` 判否后**静默回退硬编码 2045**（`AR-2` 同型）；② CI `.github/workflows/ci.yml` **内联 `grep`** —— 6 名（多 `info`/`trace`）**按行**、阈值**写死 2034**。⇒ **两套实现 + 两个阈值 + 两种计数语义**（该规则条目当时即标注「⚠️ 已知双源（如实，待收敛）」）。**落地（单实现 + 单真源）**：① 新增 `scripts/lib/consoleCalls.ts`（**唯一实现**：6 名并集 · **按行** · 扫描面 = `app/src` 下 `.ts`/`.tsx`、跳 `node_modules`/`.git`/`dist`/`coverage`、排除 `*.test.*`/`*.spec.*`/`__tests__/`/`*.d.ts`（= 原两套排除的**并集**，只更严）· 基线读取**缺失/非法即抛错**（fail-closed，**不回退**硬编码默认值））；② 新增 `scripts/check-console-baseline.ts`（CI 入口；`CONSOLE_BASELINE_OVERRIDE` **仅供负向自证**，门禁不开放该旁路）；③ `scripts/console-baseline.json`（**唯一真源**）→ `count 2034` / `threshold 0` ⇒ 上限 **2034**（**与原 CI 严格度逐字一致，零放宽**；门禁侧由 2250 **收紧**到 2034，实测当前 **1766** 行 ⇒ 余量 268）；④ 门禁 `checkConsoleBaseline` 改写为调 lib（用 `this.projectDir`，**顺带修掉 `process.cwd()` 漂移**；删 `let baseline = 2045` 与 4 名旧正则）；⑤ CI 的**内联 grep 步骤**替换为 `working-directory: .` + `bun run scripts/check-console-baseline.ts`；⑥ `.trae/rules/architecture-compliance.md` 的 R05-003 条目改写为「唯一实现 / 唯一真源 / 两个调用点 + ✅ 已收敛」。**等价实证**：门禁与 CI 脚本**都输出 `当前 1766 行`**（数字逐位相等）；口径变更如实记录：门禁旧口径 **1764 次**（4 名 · 按次）→ **1766 行**（6 名 · 按行）。**新守卫** `app/tests/gates/consoleBaselineSingleSource.test.ts`（**6 例**）：两调用点引用同一 lib · 门禁**实现体**（去注释）无 `2045`/旧公式/旧正则 · CI 无 `Console calls:`/`-gt 2034`/`wc -l` · 真源可解析 · 真实脚本 `exit 0` · **负向自证**（临时基线 `count=1` ⇒ `exit 1` 报「超上限」）。**验证**：守卫 **6 pass / 0 fail（19 expect）**（与 `hardcodeGateBlocking` 合跑 **14 pass**）；`lint:arch` **错误 0 / 警告 5（无回归）**；4 硬编码门禁全 `exit 0`；`lint:scripts` **0 error / 28 warning**；`typecheck` **0**。**如实边界**：① **行为变更（收紧方向）** —— 门禁上限 2250 → 2034（与 CI 既有严格度对齐，当日不新增失败）；② 计数**口径**变更 ⇒ 历史数字不可直接比较（已记录 1764 → 1766）；③ CI `test` 作业仍保留该步骤、与 `static-check` 的门禁**重复执行**（同一实现/同一结论）⇒ 若判为浪费可另行裁定删除（**本片有意不删**：CD05/CD06 要求删除独立提交）；④ `threshold` 由 0.10 改 **0** ⇒ 失去容差窗口语义（上限即 `count`），系「逐字对齐 CI 原严格度」的**有意取舍**；⑤ **未在真实 GitHub Actions 跑过**（`e2eVerified=false`）。证据 `HARDCODE-R05-003-CONSOLE-SINGLE-SOURCE`。
- ✅ **硬编码治理 `HD-P2-5`：后端（`app/src`）locale 写死收口 —— 15 处 `toLocale*('zh-CN')` 改引用唯一真源 `DEFAULT_LOCALE`（9 文件，零行为变化）；3 处有意 `en-US` 登记并加注释；`lint:locale` 基线 15 → 6 键** - **取证（CS06）**：`lint:locale` 报 20 条 `toLocale*` 写死 locale（**18 在 `app/src`** + 2 在 `client/src`）。逐处读上下文后分两类 —— **（A）15 处 `zh-CN`**：周围文案**全为硬编码中文**（`创建`/`更新`/`保存时间`/`记忆文件列表`/`Liri 对话记录`/`Cron: …`）⇒ 该面**未 i18n**，写死 `zh-CN` 与文案**口径一致**；**（B）3 处 `en-US`**：`chronos/cron.ts`（`formatLocalTime`，同文件 `DAY_NAMES` 为英文 ⇒ 该模块产出**英文** cron 描述）· `commands/builtin/budget/Budget.ts`（千分位**稳定数值口径**）· `query/dailyBudgetSnapshot.ts`（USD 金额，**与前端 `DailyBudgetPanel.formatUsd` 逐字同口径** ⇒ 跨部署契约）。**落地（零行为变化，对齐 `HD-P1-2 A8/A9` 的「删同值副本 → 引用真源」手法）**：（A）9 文件把**字面量**改为引用 `DEFAULT_LOCALE`（`constants/common.ts` 唯一真源，经 barrel `@modules/constants`；值同为 `'zh-CN'` ⇒ **行为逐字不变**）：`cli/handlers/sessionHandler.ts`（×6）· `commands/builtin/cost/Cost.ts` · `commands/builtin/memory/Memory.ts` · `commands/cron/Cron.ts` · `commands/usagestats/usagestats.ts` · `tools/DocGenerateTool/DocGenerateTool.ts` · `tools/RecallMemoryTool/RecallMemoryTool.ts` · `tools/SaveConversationTool/SaveConversationTool.ts`（×2）· `ui/components/MessageBubble.tsx`（各 +1 行 import）；**（B）3 处加「⚠️ 有意 `en-US`」注释**（写明理由 + 同口径对象 + 何时应改），**值一律不动**。**⛔ 有意不动**：`client/**` 2 处（同一「数值/金额口径」类）· `DocGenerateTool` 的 3 处 `?? 'zh-CN'` 兜底 · 语音/TTS 语音表 · `WebSearchTool` 的 `language` 参数 · `voice-handlers.ts` · `LanguageManager` 语言包 · HTML `lang="zh-CN"`（均为**数据/枚举/参数**，非 `toLocale*` 忽略语言问题）。**收紧**：`HARDCODE_GATE_BASELINE_WRITE=1` 重播 ⇒ `lint:locale` 分节 **15 → 6 键**（余 4 个 file 键 = 3 处有意 `en-US` + 客户端 `DailyBudgetPanel.tsx`，2 个 `桶:` 键）。**验证**：`lint:locale` 复跑 **PASS（exit 0）**，仅余 5 条（全部为**有意**项）；`app/src` 内 `toLocale*('zh-CN')` **归零**（独立 `Grep` 0 命中）；`git diff` = **9 文件 · +24/-15**（9 行 import + 15 处实参替换，**无** BOM/行号外变更）；`typecheck`（app 3 tsconfig）**0**；`eslint` 12 改动文件 **0 error**（首轮 2 条 prettier 行宽错已 `--fix`——`DEFAULT_LOCALE` 比字面量长 5 字符）；`lint:arch` **违规 0 / 错误 0 / 警告 5（无回归）**；守卫 `hardcodeGateBlocking.test.ts` **8 pass / 0 fail**。**如实边界**：① 本片是**字面量收敛（值不变）**，**不是**「让日期随用户语言切换」—— 后端该面**未 i18n**（标签全中文），只改日期会得到「中文标签 + en 日期」**混排**（比现状更差）；真正 i18n 须连同中文标签一起改造（属行为变更 + 大规模改造，**本片有意不做**）；② `chronos` = **infra** 层，按 R00-001 **不得**引用 app 层的 `LanguageManager` ⇒ 该面若「随语言」须先在 infra 立真源；③ **未做真机走查**（`e2eVerified=false`）；④ 无新增单元测试（证据 = 门禁实跑 + 独立 Grep + git diff 复核）。证据 `HARDCODE-HDP2-5-APP-LOCALE`。
- ✅ **硬编码治理 §8 阶段①首轮发现 · 悬空规则 ID 清零：11 个「只有门禁实现、无规范条目」的 ID 全部规范落盘 + 该门禁基线分节下调至 0 键** - **取证（CS06）**：`lint:failmsg-refs` 首轮报 **44 条**「规则 ID 未在 `.trae/rules/**.md` 找到」，涉 **11 个 ID**（`R00-002` · `R05-003` · `R05-004` · `R05-007` · `R05-008` · `R05-013` · `R07-001` · `R07-002` · `R07-003` · `R07-004` · `AR-2`），**全部集中在 `scripts/lint-architecture.ts`**。回仓枚举确认：`R05` 系列**只存在** R05-005/011/012（003/004/007/008/013 缺）· `R07` 系列**整段缺失** · `R00` 只有 001/003（**002 缺**）· `AR-*`（带连字符）**无任何条目** ⇒ 根因即方案 §2.10①**规范悬空**（编号在 `R05`/`R06` 合并、`R07` 新增时被遗漏）。**落地（规范落盘，对齐 `HD-INFRA-1a` 先例）**：`.trae/rules/architecture-compliance.md` 六处补录 —— §R05 改题「导入规范与代码卫生」+ 补 `R05-003`（Console 基线，含**已知双源**如实记录）· `R05-004`（`src/` 禁 `.js`，error）· `R05-007`（tsconfig/tsconfig.eslint 类型检查盲区，error+warning；含「从未真正执行」教训与 `AR-2` 交叉引用）· `R05-008`（重复依赖）· `R05-013`（类型中心重复定义 + D-222 处置口径）；§R06-008 内补 `**R00-002**`（未登记分层映射的顶层目录必须显式上报）；新增 `## R07 碎片化防回潮与工作区卫生（SHOULD）`（`R07-001` 微小文件 · `R07-002` 自定义文件头重复 · `R07-003` 薄桶 · `R07-004` 工作区参考副本，**全部 warning**）；新增 `## AR 门禁自身纪律（MUST）`（`AR-2` 门禁定位仓库文件禁 `process.cwd()` · `AR-3` 检查器崩溃不得当通过），并显式区分**带连字符的 `AR-*`（门禁纪律）**与 §R06 括注的**无连字符旧系列 `AR01`–`AR06`**。**收紧（关键，否则修复不持久）**：`HARDCODE_GATE_BASELINE_WRITE=1` 重播 ⇒ `lint:failmsg-refs` 分节 **11 键 → 0 键**（否则重新引入悬空 ID 会因「计数 ≤ 基线」被**静默容忍**）。**守卫更新** `app/tests/gates/hardcodeGateBlocking.test.ts`（**7 → 8 例**）：修正原「四节非空」断言（**空分节在棘轮语义下 = 最严**、非退化 ⇒ 改为「四节齐备 + 至少一节非空」防整体清空），**新增**「`failmsg-refs` 分节**不得残留 `规则ID:` 键」防「遇到红灯就播种」。**验证**：**先红后绿**（红 = 首轮 44 条实测；绿 = `✅ 无告警` + `可下调基线的键` 精确列出 11 个 `规则ID:` 键）；**红向自证（收紧后）** —— 探针 `scripts/lint-__probe-failmsg.ts`（含 `R99-999`）⇒ `exit 1` 且精确报 `规则ID 未在 .trae/rules/**.md 找到：R99-999` + `新增键 规则ID:R99-999`，**删探针后 `exit 0`**；守卫 **8 pass / 0 fail（35 expect）**；4 门禁（CI 方式·仓库根）链式 **`exit 0`**；`lint:arch` **错误 0 / 警告 5（无回归）**；`lint:scripts` **0 error / 28 warning**；`lint:fix-evidence` **169 条绿**；`typecheck` **0**。**如实边界**：① **未改** `lint-architecture.ts` 一行（11 个 `ruleId` 逐字保留 ⇒ 输出可追溯性不降）；② `AR-3` 属**顺带修复**（跨文件悬空，`lint:failmsg-refs` **未报** —— 字符串出现在 `coding-standards.md` 即算命中，属**门禁已知盲区**，本片未改其口径）；③ `R05-003` 的**双源**（脚本 2045 vs CI grep 2034，计数方式亦不同）当时**只记录、未收敛** ⇒ **已由 `HARDCODE-R05-003-CONSOLE-SINGLE-SOURCE` 收敛**；④ `R05-007` 的 12 个目录是门禁内的**候选清单**（检测「是否被 exclude」）—— **2026-10-14 回仓实测当前 0 盲区**（`app/tsconfig.json#exclude` 只含 `node_modules`/`dist`/`packages`/测试文件）⇒ **无待清理盲区**（本条为防回潮而设）；⑤ **未在真实 GitHub Actions 跑过**。证据 `GATE-S8-HARDCODE-DANGLING-REFS`。
- ✅ **硬编码治理 §8 门禁 · 阶段③「转 error 级 / CI 必绿」：4 门禁接入流水线 + 明细口径升级为 error 级** - **取证（先确认缺口真实存在）**：阶段② 的「阻断」只存在于 `app/package.json` 的 4 个 script 里，**既未进 `ci` 聚合脚本、也未进任何 workflow** ⇒ 不手动跑时**门禁在流水线上从不执行**（「阻断」是纸面承诺）。**落地（三处）**：① `scripts/lib/hardcodeScan.ts` 的 `report()` 明细口径由「⚠️ 上报 N 条（仅上报）」升级为 **`❌ 违规 N 条（基线内为豁免存量，不阻断；新增/扩大 ⇒ 阻断）`**（error 级；头注释补阶段③口径）；② `app/package.json` 的 `ci` 聚合脚本**加入 4 门禁**（紧随 `lint:no-module-mock`）；③ `.github/workflows/ci.yml` 的 `static-check` 作业新增 **`Hardcode gates (§8 阶段③ · ratchet baseline, error level)`** 步骤（`working-directory: .` ⇒ 依次跑 4 脚本，任一 `exit 1` 即作业失败 ⇒ **CI 必绿**）。**新守卫** `app/tests/gates/hardcodeGateBlocking.test.ts`（**7 例**）：① **接线**——4 门禁在 `ci` 聚合脚本内 **且** 在 workflow 内（防「文档写了、流水线没跑」）；② **口径**——库含 `❌ 违规` 且**不再**含 `⚠️ 上报`；③ **基线**——可 `JSON.parse`、四节齐备非空（防棘轮退化为「什么都不比」）；④ **负向对照（跑真实脚本 + `HARDCODE_GATE_BASELINE` 覆盖）**——真实基线 ⇒ `exit 0`（含 `PASS（基线只减不增）`/`❌ 违规`/`基线内为豁免存量`）· 基线**削减一键** ⇒ **`exit 1`** 且精确报该键名 · 基线**缺失** ⇒ fail-closed `exit 1`。**验证**：守卫 **7 pass / 0 fail（33 expect · 4.98s）**；**先红后绿已实证**（`report()` 文案改回 `⚠️ 上报` ⇒ **2 fail** 精确命中；恢复后 7 pass）；4 门禁实跑均 `exit 0`；`lint:scripts` **0 error / 28 warning**；`lint:fix-evidence` **169 条绿**。**如实边界**：① 基线内 **413 处存量仍为豁免** —— 本片保证「**新增/扩大**即阻断 + 门禁**真的在 CI 跑**」，**不是**「零违规」；② **未**把 4 门禁前置到 pre-commit（每次提交 +4 次全仓扫描 ⇒ 行为变更，须另裁定）；③ `ci.yml` 的 `paths-ignore` 含 `.trae/**` ⇒ 纯基线文件提交不触发（方向为放宽时会被后续代码提交拦住，已知）；④ **未在真实 GitHub Actions 上跑过一次**（`e2eVerified=false`，本机不可证）。证据 `GATE-S8-HARDCODE-BLOCKING`。
- ✅ **硬编码治理 §8 门禁 · 阶段②「白名单收敛（只减不增）」：4 门禁升级为棘轮阻断** - 对齐仓内先例 `lint-function-size-ratchet`（基线 JSON + env 覆盖 + 基线缺失 `exit 1`）。**落地**：① 新增基线 `.trae/architecture/hardcode-gate-baseline.json`（**四节 / 合计 413 键**：consts 291 · endpoints 96 · locale 15 · failmsg-refs 11）；② 4 门禁产出**稳定的「键 → 计数」**（**键不含行号** ⇒ 避免无关编辑造成假新增）：`lint:consts` = `同名常量:<NAME>`/`同值host:<LITERAL>`（计数＝文件数）· `lint:endpoints` = 相对路径 · `lint:locale` = 相对路径 + `桶:<语言|时区>` · `lint:failmsg-refs` = `规则ID:<ID>`/`路径:<…>`；③ 判定：**新键 或 计数扩大 ⇒ 打印「❌ 新增/扩大违规」并 `exit 1`（阻断）**；全 ≤ 基线 ⇒ `PASS（基线只减不增）`（仅提示可下调键）；④ env：`HARDCODE_GATE_BASELINE=<path>`（负向自证）· `HARDCODE_GATE_BASELINE_WRITE=1`（一次性播种/下调）；基线缺失 ⇒ fail-closed。**验证**：**4 门禁正常跑均 exit 0**；**负向自证已实证**（临时 `__probe_{a,b}.ts` ⇒ `lint:consts` exit 1 精确报 `新增键 同名常量:PROBE_DUP`；`lint:endpoints` exit 1 精确报两个新文件键；**删探针后全 exit 0**）；`lint:scripts` 0 error / 28 warning；`lint:fix-evidence` **167 条绿**。**如实边界**：阶段②**只拦新增**（**阶段③ CI 必绿/error 级需裁定**）；基线**只播种未下调**（**不阻断存量**，符合「先行 1–2 个迭代」）；键不含行号（稳定性优先，属有意取舍）；**无单元测试**。证据 `GATE-S8-HARDCODE-RATCHET`。
- ✅ **硬编码治理 §8 门禁 · 阶段①「仅上报」：新增 4 把门禁 + 共享扫描库** - 复用 `scripts/lint-models.ts` 框架（白名单 + 正则 + 注释跳过），**只 warning、不阻断**（对齐 `R00-003` 口径）。**交付**：`scripts/lib/hardcodeScan.ts` 共享库 + 4 把门禁 —— **`lint:consts`**（同名常量 ≥2 文件定义 · 同值 URL/host ≥2 文件出现）· **`lint:endpoints`**（`localhost`/`127.0.0.1`/`0.0.0.0`/固定端口字面量，白名单 = 真源文件与测试）· **`lint:locale`**（默认语言/时区分桶取值冲突 + `toLocale*` 写死 locale）· **`lint:failmsg-refs`**（门禁**报错文本/注释**里引用的规范条目与规则 ID **必须真实存在**）；`app/package.json` +4 scripts。**首轮真实发现**：① `lint:failmsg-refs` 抓到**悬空规则 ID**（`R07-004`/`R07-002` 在**报错文本**内 · `R07-001` · `R05-007` · `AR-2`）⇒ 正是 §2.10①「规范悬空」；② `lint:consts` 多处**同值 host 跨文件**（`http://127.0.0.1` ×6 文件等）；③ `lint:endpoints`（`providerPresets.ts` 24 处等）；④ `lint:locale` 报 `toLocale*` 写死 locale **11 处**（`app/src` 9 + `client/src` 2）⇒ **即刻暴露 A9 客户端片未覆盖的 `app/src` 侧同类点**（已如实登记为后续片）。**验证**：4 门禁**均 exit 0**；`bun run lint:scripts` **0 error / 28 warning**（新增 5 文件零告警）；`lint:fix-evidence` **166 条绿**。**顺带**：`--fix` 了 `scripts/lint-fix-evidence.ts:140` 的**既有** prettier 格式错误（纯格式）。**如实边界**：阶段①只上报不阻断（阶段②棘轮 / ③阻断 需裁定）；首轮发现**本片不修**；§8 表内「前置到 pre-commit」需 `Q-H6` 裁定，本片未做。证据 `GATE-S8-HARDCODE-REPORT`。
- ✅ **硬编码治理 HD-P1-2 A9（客户端片）：语言/时区统一引用真源（新增客户端真源 + 38 处写死点接回 + 守卫）** - **背景**：默认语言/时区原先**自相矛盾**（方案 §2.5）；`Q-H2` 已裁定统一 **`zh-CN`/`Asia/Shanghai`**，后端已落地（`app/src/constants/common.ts`，提交 `a9cd87705`）。**A9 剩余 = 客户端统一引用**：客户端原先**无可导入真源** —— `currentLocale()` 是 `utils/format.ts` 的**模块私有**函数 ⇒ 各组件只能写死。**落地**：① 新建 `client/src/constants/locale.ts`（`DEFAULT_LOCALE = "zh-CN"` / `DEFAULT_TIMEZONE = "Asia/Shanghai"`，与后端**同值**，并写明「界面格式化用 `currentLocale()`、产品默认语言用 `DEFAULT_LOCALE`」的**用途分野**）；② `currentLocale()` **改为 export**（客户端 locale 唯一真源）；③ 迁移 **38 处 / ~37 文件**：`toLocale*("zh-CN", …)` → `currentLocale()`（**两轮**，含 `ChatMessage`/`MetricsChart`/`SkillList`/`Trajectory*`/`DashboardPage`/`memoryService` 等）；`LogViewer`×2、`CronExecutionHistory` 的**同义重复实现**改引用真源（等价）；`|| "Asia/Shanghai"` → `DEFAULT_TIMEZONE`（`Footer`/`DashboardPage`/`AppearancePanel`/`UsageCenterPage`）；`AppearancePanel` 语言兜底 → `DEFAULT_LOCALE`；`VoiceInputButton` STT 默认 → `DEFAULT_LOCALE`。**⛔ 数据表有意保留**：`TIMEZONE_OPTIONS` / `TIMEZONES` / `TIMEZONE_CURRENCY_MAP`。**新守卫** `tests/localeTimezoneSingleSource.test.ts`（**4 例**：禁 `toLocale*("zh-CN")` · 裸 `"Asia/Shanghai"` 仅白名单 · 真源存在且被导出 · 抽样消费点引用真源）。**验证**：守卫 **4 pass**；client 全量 **575/0（73 文件）**；`typecheck` 0；`eslint` 改动文件 0 error。**如实边界**：本片**含行为变化**（en 界面日期/数字格式改为 `en-US`，与 `Q-H2` 同向）；数据表未令牌化；未真机目视。证据 `HARDCODE-HDP1-2-A9-LOCALE-TZ`。
- ✅ **硬编码治理 HD-P1-2 A8：退避/重试默认值合一（Bridge 同值副本已删 + 3 消费点引用真源）+ 变体与差异登记钉住** - **取证**：本仓两种退避形态 —— ① **HTTP 重试**（标准真源 `utils/withRetry.ts` 的 `DEFAULT_RETRY_CONFIG`）；② **Bridge API 退避**（唯一真源 `bridge/types/BridgeApiTypes.ts` 的 `DEFAULT_BACKOFF_CONFIG`）。**落地（零行为变化）**：① **删同值副本** —— `bridge/api/BridgeApi.ts` 自带的 `BackoffConfig` + `DEFAULT_BACKOFF_CONFIG`（逐字同值 1000/30000/2/5）⇒ 改为引用唯一真源；② **消费点改引用** —— `ai/services/aiService.ts`（×2）· `agent/harness/index.ts` · `chat/services/ImageDownloader.ts` 的 `maxRetries` 默认值（均为 3）改引用 `DEFAULT_RETRY_CONFIG.maxRetries`。**登记并钉住**：三个**同族变体**（`query/withRetry` 多 `jitterFactor` · `ai/providers/BaseAIProvider` 用 `baseDelayMs` · `streaming/IncrementalRetry`）因**形状不同**未合并（须先统一字段名）；四处**有意值差异**未统一（Bridge 5 vs 3 · `BridgeMain`/`PollManager` general 500/30000 vs 1000/60000 · `SmartToolIntegrator` 2 · `ImageDownloader` 2000ms）—— 统一会改行为，故由守卫钉住防漂移。**不纳入**：约 20 处 `maxRetries: 3` 分属不同语义子系统（cron/短信/邮件/OAuth/执行策略），强行合一属语义错配。**验证**：新守卫 `tests/utils/backoffDefaults.test.ts` **5 pass / 0 fail**；**app 全量 6379 pass / 42 skip / 0 fail（728 文件）**；`typecheck` 0；`eslint` 改动文件 0 error。**如实边界**：同族变体未合并（须统一字段名）；值差异未统一（须裁定）；未真机走查。证据 `HARDCODE-HDP1-2-A8-BACKOFF-DEFAULTS`。
- ✅ **硬编码治理 HD-P2-4 Batch 2 · Group C（末批）：其余 29 个 service 收口（145 处）；`services/**` 裸 `/v1/` 归零（基线 136 → 0）** - **方案验收口径达成**：`client/src/services/**` 内不再有任何裸 `/v1/` 路径字面量，全部经 `services/endpoints.ts` 的 `ENDPOINTS.*` 引用，并由棘轮（基线 **0**）锁定。**落地**：复用并扩键 `knowledge`（datasources/graph/faq 系）· `session`（messagesEncoded/checkpoints/steer/events 等）· `models`（byId/toggle/orphans/current/switch/tasks/phaseMapping）· `providers`/`settings`/`buddy`/`project`；新建 `goals`/`chat`/`config`/`images`/`infrastructure`/`mcp`/`notifications`/`permissions`/`plugins`/`router`/`sandbox`/`semantic`/`system`/`tasks`/`tools`/`trace`/`translate`/`vfs`/`videos`/`video`。**取值保真**：非 `http.*` 调用点（`fetch`/`EventSource`/`apiHttp.stream`/`xhr.open`/`getBackendBaseUrl()` 前缀拼接）**同样收口**；`encodeURIComponent` 包装原样；**编码/未编码拆键**（`session.messagesEncoded` 与 `session.messages` 并存）；`images.staticPrefix` 单列（供 `startsWith/slice`）；query 一律「纯路径常量 + 调用点拼」。**验证**：棘轮 1 pass（基线 **0 / 0 文件**）；client 全量 **571/0（72 文件）**；`typecheck` 0；`eslint` 30 文件 0 error；自检 29 文件内 `/v1/` **仅注释行**。**如实边界**：未真机联调（路径写错不被编译器拦住）；`components/**`·`stores/**`·`hooks/**` 等约 140 处仍为字面量（**不在方案验收口径内**）。证据 `HARDCODE-HDP2-4-ENDPOINTS-B2C`。
- ✅ **硬编码治理 HD-P2-4 Batch 2 · Group B：files/channels/providers/models/office 系/plans 系/voice 系/memory/monitor 系/llama 等域收口（166 处；基线 302 → 136）** - 在 `ENDPOINTS` 内**追加** `files`(10) · `channels`(13) · `wechat`(1) · `providers`(7) · `models`(8，**并入** `capabilityService` 的 `/v1/models/capabilities*` 与 `providerService` 的 `/v1/models`·`/bulk-import`) · `doc`/`officecli`/`mail`/`calendar`（**按「前缀即域」拆**，未聚合为单 `office`）· `plans`/`pdca`/`kanban`/`research`/`patterns` · `voice`(13)/`settings`(1)/`tts`(3) · `memory`(12) · `monitor`(8)/`health`(1)/`analytics`(1) · `llama`(13)；**复用**已有 `workspace`/`knowledge` 域。迁移 **166 处 / 11 文件**。**取值保真**：`new URL("/v1/…", …)` 只换首参 · `{ params }` 配置对象只换路径实参 · query 一律「纯路径常量 + 调用点拼」· `encodeURIComponent` 包装原样。**验证**：棘轮 1 pass（基线 **136 / 29 文件**）；client 全量 **571/0（72 文件）**；`typecheck` 0；`eslint` 12 文件 0 error；自检 11 文件内 `/v1/` **仅注释行**。**如实边界**：路径写错不被编译器拦住；剩余约 136 处 / 29 文件待 Group C；`office` 拆分口径见台账 `reopenWhen`。证据 `HARDCODE-HDP2-4-ENDPOINTS-B2B`。
- ✅ **硬编码治理 HD-P2-4 Batch 2 · Group A：knowledge / workspace / skill / session / usage 五域收口（166 处；基线 468 → 302）** - 在 `services/endpoints.ts` 的 `ENDPOINTS` 内**追加** 5 个域（`knowledge` 25 键 · `workspace` ~30 键 · `skill` ~20 键 · `session` 15 键 · `usage` 12 键），并**新列 3 个顶层域**（`project` `/v1/projects/*` · `workflow` `/v1/workflows/*` · `pricing` `/v1/pricing*` · `cost` `/v1/cost/daily-budget*`）。迁移 **166 处 / 5 文件**。**取值保真**：`encodeURIComponent` 在构造器内保持同一包装（编码时机不变）；含 query 的路径一律「纯路径常量 + 调用点拼 query」；未编码 `byId` 与编码 `byIdEncoded` **拆两键**（合并会改运行期字符串）。**验证**：棘轮 1 pass（基线 **302 / 40 文件**）；client 全量 **571/0（72 文件）**；`typecheck` 0；`eslint` 改动文件 0 error；自检 5 文件内裸 `/v1/` **0 命中**。**如实边界**：路径写错不被编译器拦住；剩余约 302 处 / 40 文件待 Group B/C。证据 `HARDCODE-HDP2-4-ENDPOINTS-B2A`。
- ✅ **硬编码治理 HD-P2-4 Batch 1：`/v1/*` 契约路径按域收口到 `services/endpoints.ts`（四域 / 36 处）+ 只减不增棘轮** - **取证**：`client/src` 内 `/v1/` 字面量共 **610 处 / 88 文件**（方案原估 296 处偏小），其中 `services/` 约 504 处 / 49 文件。**决策**：用户裁定用**按域常量 + 构造器**。**落地**：① 新建真源 `client/src/services/endpoints.ts`（`ENDPOINTS` 按域：auth / apiKeys / agentTasks / autoReply / cron），**值逐字不变**（含模板插值）；② 迁移 **4 service / 36 处**（`authService` 8 · `agentService` 14 · `autoReplyService` 4 · `backgroundTaskService` 10），**回仓补齐 4 个未列键**（`cron.run`/`buddy.dreams`/`background.status`/`state.all`）；③ 新守卫 `tests/endpointsRatchet.test.ts` + 基线（**468 / 45 文件**，只减不增；排除真源/测试/注释行）。**验证**：棘轮 1 pass；client 全量 **571/0（72 文件）**；`typecheck` 0；`eslint` 改动文件 0 error；独立 `Grep` 复核 4 个已迁文件**不在**裸 `/v1/` 命中列表；子代理给出**逐条 36 行路径值对照表**（全部一致）。**如实边界**：路径写错**不被 typecheck 拦住**（只在运行时 404）；只迁 4 域（剩余约 468 处 / 45 文件待 Batch 2+）；棘轮**只覆盖 `services/**``（components/stores/hooks 等约 140 处有意不在本片）。证据 `HARDCODE-HDP2-4-ENDPOINTS-B1`。
- ✅ **硬编码治理 HD-P2-3：前端自定义事件名（6 / 36 处）+ 跨文件存储键（`liri-auth-token` / 3 处）收敛为单一真源 + 源码守卫** - **取证**：自定义事件（区别于 `keydown`/`resize` 等 DOM 原生事件）共 **6 个 / 36 处** —— `open-quick-note` · `open-global-search` · `toggle-shortcut-help` · `liri:append-knowledge` · `pyapp:image_generated` · `canvas-render`（`CanvasEditor` 单文件 10 处）；存储键面 7 个，**仅 `liri-auth-token` 跨文件**（3 处），余者单文件内使用。**落地**：① 新建真源 `constants/events.ts`（`APP_EVENTS`）与 `constants/storage.ts`（`STORAGE_KEYS.authToken`）—— **值逐字未改**；② 36 处事件引用 + 3 处键引用改引用真源（`authService` 的私有 `AUTH_TOKEN_KEY` **删除**，不留双轨）；③ 新守卫 `tests/constantsSingleSource.test.ts`（**2 例**；按行首排除注释行与测试文件）。**验证**：守卫 **2 pass**；client 全量 **570/0（71 文件）**；`typecheck` 0；`eslint` 改动文件 0 error；**红向已实证**（`PanTool.ts` 改回字面量 ⇒ 精确报 `:33`）；独立 `Grep` 复核 7 字面量**仅剩两真源**。**如实边界**：只搬家不改值（命名风格原样）；其余 6 个存储键**有意不上收**（单文件内使用）；未真机走查。证据 `HARDCODE-HDP2-3-EVENTS-STORAGE`。
- ✅ **硬编码治理 HD-P2-1 Batch 4（收口）：补 2 个组件级描边令牌 + 4 处 `isDark` 分支收口；剩余 43 行判定为非主题色（基线 46 → 43）** - **代码改动（零视觉变化）**：`index.css` 补 `--color-border-dark: #374151`（回仓实测该值在 **4 处重复**：`GraphCanvas` · `TranslatePage`×2 · `StatsPanel` 的 `isDark` 分支）· `--color-border-light: #e5e7eb`（3 处重复；与 `--color-grid` 同值但语义不同，故各自成令）；4 处分支改 `var(--color-border-*)`。**剩余 43 行判定（回仓逐文件取色值，事实）**：图表 categorical 调色板（`#8B5CF6`/`#06B6D4`/`#EC4899`/`#6366F1`/`#93c5fd` 等）· Tokyo Night 代码块配色（`#a9b1d6`/`#7aa2f7`/`#1a1a1a`）· **生成文档内联样式**（`OfficePreview` 拼接的 HTML 串 · `exportMessage` 导出 `<style>` 串）· 开发期日志色（`storeLogger` 的 console 着色码）· 取色器/画布数据值 · **与 `index.css` 深色令牌取值不同的组件级暗色分支** ⇒ **均非本产品主题色**（强行令牌化会改视觉或语义错配）⇒ 保持字面量、由棘轮锁定。**结论**：`HD-P2-1` 的**语义状态/中性色已全部令牌化**（基线 338/46 文件 → **43 行 / 23 文件**，且剩余全部已分类登记）。**验证**：棘轮 1 pass（43/23）；client 全量 **568/0（70 文件）**；`typecheck` 0；`eslint` 改动文件 0 error（`TranslatePage` 2 条 `loadHistory` 经 `git show HEAD` 取证为**改前既有**）。**如实边界**：未真机目视；未与设计确认「两套暗色是否应统一」（属视觉变更）。证据 `HARDCODE-HDP2-1-THEME-TOKENS-B4`。
- ✅ **硬编码治理 HD-P2-1 Batch 3：第二批数据/独立主题登记 EXCLUDE（基线 70 → 46）** - 对 Batch 2 后剩余 **70 行 / 30 文件**继续**回仓逐文件分类**（事实判定）：`ChatArea/{ToolExecutionGroup,StatusBlock,ThinkingBlock}` 与已判定的 `ToolCallGroup` **同族** ⇒ **Tokyo Night 代码主题**；`common/ModelRankTable` 的 `#8B5CF6`/`#06B6D4`/`#EC4899`/`#6366F1` ⇒ **图表多系列 categorical 调色板**；`views/LiriPage` 的紫系 ⇒ **落地页插画/品牌渐变**。三者按方案 §5 **登记不治理**（加入棘轮 `EXCLUDE_FILES`，附理由）。**验证**：棘轮 1 pass（基线 **70 → 46 / 25 文件**）；client 全量 **568/0**；`typecheck` 0。**如实边界**：**未改任何产品样式**（纯登记）；剩余 46 行（暗色分支 · 代码块深色 · 图表系列色 · 待判定）⇒ Batch 4+；`EXCLUDE` 整文件粒度有已知代价。证据 `HARDCODE-HDP2-1-THEME-TOKENS-B3`。
- ✅ **硬编码治理 HD-P2-1 Batch 2：状态调色板补齐令牌（15 个）+ DAG 迁移；代码主题/品牌色登记 EXCLUDE（基线 113 → 70）** - Batch 1 后对剩余 **113 行 / 35 文件**做**分类治理**（回仓取全量色值逐类判定）。**分类结论（事实）**：① **语义状态调色板** —— `DAGMiniMap`/`DAGFullScreen` 的 `STATUS_COLORS`（pending/in_progress/cancelled/blocked/skipped 的 bg·border·text）⇒ **补齐令牌**；② **数据/独立主题（§5 不治理）** —— `ToolCallGroup`/`DocWorkflowProgress`/`PendingDecisionSidebar` 经核验为 **Tokyo Night 代码主题调色板**、`LoginPage` 为 **Google/Microsoft 品牌 logo 色**。**落地**：① `index.css` 补 **15 个令牌**（`--status-{pending,running,done,cancelled,blocked,skipped}-*` + `--color-grid`），取值与原字面量**逐字相等** ⇒ 零视觉变化；② DAG 两文件 `STATUS_COLORS` 全量改 `var(--status-*)`；③ 棘轮 `EXCLUDE_FILES` 登记 4 个数据/独立主题文件（附理由）；④ 基线 **113 → 70（30 文件）**。**验证**：棘轮 1 pass（基线 70/30）；client 全量 **568/0（70 文件）**；`typecheck` 0；`eslint` 改动文件 0 error。**如实边界**：未真机目视；剩余 70 行未判定完（Batch 3+）；`EXCLUDE` 整文件粒度有已知代价。证据 `HARDCODE-HDP2-1-THEME-TOKENS-B2`。
- ✅ **硬编码治理 HD-P2-1 Batch 1：语义色令牌化（补 5 令牌 + 迁移 13 文件）+ 「原始颜色字面量」棘轮守卫** - 取证：`client/src` 6 位 hex 共 **338 处 / 46 文件**，其中大量属**数据表/艺术资源**（供应商品牌色 `providerPresets` 42 · 吉祥物 `Buddy/**` 42 · 画布色板）⇒ 按方案 §5 登记不治理，真正要令牌化的是**语义状态/中性色**。**做法**：① `index.css` **补 5 个令牌**（`--color-success-strong` `#22c55e` · `--color-warning-strong` `#eab308` · `--color-error-strong` `#dc2626` · `--color-error-bg` `#fee2e2` · `--color-neutral-strong` `#94a3b8`）—— 取值与**原字面量逐字相等** ⇒ **零视觉变化**；② 把语义色字面量改为 `var(--color-*)`（**13 文件**，覆盖 React 内联 `style` / SVG `fill`·`stroke` / Tailwind 任意值 / CSS 渐变）。**⛔ 有意保留**：`ContextWatermark`（`${dotColor}20` alpha 拼接 ⇒ `var()` 会拼出非法串）· `XTermPanel`（xterm 需真实色值）· `canvas-editor/**`（色板数据值）。**新守卫**：`themeTokenRatchet.test.ts` + 基线（**total=113 / 35 文件**，只减不增；`EXCLUDE_*` 登记不治理项）。**验证**：client 全量 **568/0（70 文件）**；`typecheck` 0；`eslint` 改动文件 0 error（`DashboardPage:130` 的 warning 经 `git show HEAD` 取证为**改前既有**）；**回仓复核**发现 `GraphCanvas` 实为 **SVG**（非 Canvas2D）⇒ 一并迁移。**如实边界**：**未做真机目视**（安全依据=取值逐字相等；SVG `var()` 兼容性未真机核验）；剩余 113 行由棘轮锁定逐批下调。证据 `HARDCODE-HDP2-1-THEME-TOKENS`。
- ✅ **硬编码治理 HD-P0-3 余项 B3/B4：模型能力标签集 + 日预算错误码（前端收口一处 + 跨部署单元契约测试）** - 完成 `HD-P0-3` 的**契约常量**收口（B1/B2 已于前片落地）。跨部署单元（`app/` ↔ `client/`）无法共享模块 ⇒ 按方案 §4.2 注：**①前端收口一处 + ②契约测试比对两侧取值**。**B4**：新增前端真源 `client/src/error/errorCodes.ts` 的 `DAILY_BUDGET_EXCEEDED`；两处消费点改引用 —— `DailyLimitNotice.isDailyLimitErrorCode()`（**分流判据**，原字面量比较）与 `chatService` 的类型联合（`| typeof DAILY_BUDGET_EXCEEDED`）。**B3**：新增前端真源 `client/src/constants/capabilities.ts` 的 `CAPABILITY`（12 键）；三处消费点改引用 —— `CapabilitySelector`(10) · `ModelMetaEditor`(7，**由 ② 用例回仓抓出的第 3 处定义点**) · `ModelPage`(4)。契约用例（`crossDeploymentContract.test.ts` **+4 例**）：B4 ①前端取值 ⟷ 后端抛点 `preSendContextProtection.ts` + ②前端仅一处；B3 ①前端键集 **⊆ 后端规范集合**（`capabilities.default.yaml` 实测 28 键，判据 **⊆ 非 =** — 前端是 UI 退化清单）+ ②前端仅一处（键集**从模块派生**、自维护）。**验证**：契约 **9 pass / 0 fail**（B1 3+B2 2+B4 2+B3 2）；client 全量 **567/0**；`typecheck` 0；`eslint` 改动文件 0 error（3 条**既有** warning 未动）；**红向已实证**（塞 `bogus_capability` ⇒ 仅 B3① 变红且精确报该键）。**如实边界**：未把后端多处字面量收口为后端常量（只做取值比对）；B3 判据是 ⊆；前端退化清单元数据仍各自内联。证据 `HARDCODE-HDP0-3-B3B4-CONTRACT`。
- ✅ **硬编码治理 §7.5 HD-INFRA-1B：CS08 stray-quote **修复器**（`scripts/fix-stray-quotes.ts` + `lint:fix-evidence --fix`）** - 把「本轮已连续 ≥2 次在事后手修台账 JSON 破损」的临时工具固化为**仓库脚本**：与门禁既有 `locateStrayQuote` **同口径**判定 stray（字符串内、其后非空白字符不属 `,}]:`），按**每条字符串为单位重置奇偶**把内容里的裸 ASCII `"` 改为中文引号「」（CS08 首选形态）；**两条保险** —— **成对校验**（某条字符串内引号不成对 ⇒ **拒绝改写**）+ **写回前 `JSON.parse` 预检**（修复后仍不可解析 ⇒ **不落盘**）。`lint:fix-evidence` 增 `--fix`：解析失败时就地修复 → 预检 → 复检继续。**验证**：新增 `app/tests/gates/fixStrayQuotes.test.ts` **4 例**（干净 JSON 退出 0 不改动 / **成对** stray ⇒ 改「」且**先坏后好**（修复前 `JSON.parse` 抛错）/ **不成对** ⇒ 拒绝改写且文件原样 / `--dry-run` 不落盘）+ `fixEvidenceGate.test.ts` 增 1 例（`--fix` 后门禁复检通过）⇒ 合计 **17 pass / 0 fail**；真台账 `lint:fix-evidence` 绿（153 条）。**如实边界**：只做 **JSON**；修复器保证「解析得开」**不保证**配对语义 100% 正确 ⇒ 仍应 `git diff` 眼校。证据 `HARDCODE-INFRA-1B-QUOTE-FIXER`。
- ✅ **硬编码治理 HD-P2-2 延伸：**英文**错误消息入 i18n（17 键 / 9 文件；含「哨兵串」等有意不迁）** - 与同族错误消息片同判据（`toastError` → `friendlyErrorSummary` 会附**原异常信息**上屏；默认语言 zh ⇒ 英文串属未本地化）。迁：`imageService`（svg/生成/分析/编辑/画布失败 + `invalidJsonResponse` / `uploadFailed({{status}})` / `networkError` / `uploadTimeout`）· `chatService`（`Unknown error` ⇒ 复用 `errors.unknown`）· `fileService`（⇒ `files.readFileFailedGeneric`）· `sessionService`（删除/截断消息失败）· `knowledgeService`（trash/purge/restore，`purgeFailed` 复用既有）· `videoService`（`generationFailed`）· `voiceService`（`uploadAudioFailed`）· `SoundService`（⇒ `common.audioContextNotSupported`）· `MediaPage`（⇒ `video.deleteFailed`，`useCallback` 依赖补 `t`）。**⛔ 有意不迁**：`sseService.ts` 的 `new Error(`Failed to fetch`)` 是**哨兵串**（供 `utils/friendlyError.ts` 的 `/Failed to fetch/i` 映射为「无法连接到服务器…」）⇒ 改中文会让提示退化为「操作异常」；另内部/技术串（`Not implemented` / `Not in Tauri environment` / `No response body` / `HTTP <status>` 等）登记不改。**验证**：client 全量 **567/0**；`typecheck` 0 错；`eslint` 改动文件 0 error（`MediaPage` 2 条**既有** warning 未动）；**逐键命名空间审计**（防 `i18n.t` 键缺失**静默返回键名**）。**如实边界**：**无专用单元测试**（英文侧守卫会引入噪音）；仅覆盖服务/组件层英文错误串。证据 `HARDCODE-HDP2-2-EN-ERROR-I18N`。
- ✅ **修复预存 warning：`CanvasEditor` autosave effect 的 `react-hooks/exhaustive-deps`（缺 `onDirty`）** - 该 warning **改前即有**（非 HD-P2-2 i18n 收尾引入）。**为什么不直接加进依赖**：该 effect 设计为**只挂载一次**（内含 `setInterval(doSave, 30s)` / `window.beforeunload` / `commandRef.current.onChange(...)`；cleanup 只清 interval/beforeunload 并执行一次 `doSave()`）⇒ 把 `onDirty` 放进依赖会让父级**每次重渲染**都重跑 effect，**重置 30s 定时器**并在 cleanup 里**多存一次快照**（行为回归）。**做法（正修，非 disable）**：新增 `onDirtyRef`（`useRef` + 同步 effect），effect 内改调 `onDirtyRef.current?.(true)` ⇒ 依赖数组**不变**。**补充取证**：`core/CommandManager.ts` 的 `onChange(cb)` 是**替换**语义（`this.onChangeCb = cb`）⇒ 重跑只会重复定时器/存盘、不堆回调。**验证**：`eslint` 该文件 **0 error / 0 warning**；`typecheck` 0 错；client 全量 **567/0**。**如实边界**：等价重构，不改运行时行为；无单元测试断言（由 ESLint 门禁覆盖）。证据 `GATE-CANVASEDITOR-DEPS`。
- ✅ **硬编码治理 HD-P2-2 收尾：用户可见错误消息入 i18n（≈64 处 / 22 文件 · 53 键）+ 「错误消息不得裸写中文」源码守卫** - 判据（本片新定义）：`toastError(err)`（`stores/toastStore.ts:64`）把 `friendlyErrorSummary(err)` 与 `getRawErrorMessage(err)` **一并**推给 toast ⇒ 原异常文本会以「原异常信息」形式**显示给用户** ⇒ `services/**`、`stores/**`、组件里 `new Error(中文)` / `reject(new Error(中文))` / `setError(中文)` 的中文**都会上屏**、必须 i18n。**范围更正（回仓实测）**：棘轮 docstring 原估「≈35 处」被推翻 —— `client/src`（排除测试）`new Error(中文)` 共 **84 行 / 24 文件**，其中会经该上屏链路的 **≈64 处 / 22 文件**本片全部迁移。**落地 53 键**（zh 渲染**逐字不变**，含插值 `获取构件失败: {{status}}` / `请求超时 ({{timeout}}ms)`）：纯函数/服务用 `i18n.t(...)`、组件用既有 `t(...)`；`未知错误` 复用 `errors.unknown`（5 处 unwrap + CanvasEditor）、`翻译失败` 复用 `translate.translateError`；命名空间就近复用（`chat.*`/`settings.*`/`video.*`/`voice.*`/`model.*`/`logs.*`/`projects.*`/`council.*`/`image.*`/`backend.*`/`files.*`/`agent.*`），llama 组落 `settings.llamaService.*`（12 键，重复文案「响应数据为空」共用一个键）。**新守卫**：`client/src/tests/errorMessageI18n.test.ts`（22 文件逐行断言错误消息构造点不得裸写中文，按行首排除注释）；**红向已实证**（`videoService.ts:215` 改回裸中文 ⇒ 精确报该行）。**验证**：守卫 1 pass；**client 全量 567 pass / 0 fail（69 文件）**；`typecheck` 0 错；`eslint` 改动文件 0 error；棘轮 total **17 → 14**。**如实边界**：**未真机切 `en`** 走查 ⇒ `e2eVerified=false`；既有**英文**错误串与 `llamaService` 的 `res.data.error`（非字面量）不在本片；`CanvasEditor.tsx:715` 的既有 warning 如实保留。证据 `HARDCODE-HDP2-2-ERROR-I18N`。
- ✅ **硬编码治理 HD-P2-2 续作：前端内联中文文案全量入 i18n（≈40 文件 · 426 → 17 处）+ CS02 根治 + 内联文案「棘轮」守卫** - 方案原估「16 处 / 7 文件」被回仓实测推翻（主清单 **≈120 处 / ≈40 文件**，另 ≈35「throw 后可上屏」边界项、约 10 组数据表）⇒ 采用仓内既有的**棘轮**手法（对照 `function-size` / A6 host 棘轮）分**四批**迁移：B1a（utils 6 文件 + 顶级 `errors.*`/`tool.value.*`/`chat.export.*`/`plans.*`/`logs.*`）· B1b（`toolHumanSummary.ts` 129→0；`tool.name.*`/`tool.summary.*`/`tool.argKey.*`）· B2（`services`/`stores`/`hooks` 11 文件）· B3（≈22 文件 + 56 键：`dag.*`/`office.*`/`knowledge.*`/`voice.*`/`chat.*`/`media.*`/`common.*`）⇒ 棘轮 **total 426 → 17**。**CS02 根治**：`chat-message-stream.ts` 原用 `finalBlocks[0].content.includes("未生成内容")` **匹配用户可见文案**判定「是否仅含兜底块」——文案一旦 i18n，**英文界面下该匹配必然失效** ⇒ 走错分支（不再跳过覆盖、有数据回退风险）；改为**同函数内标记** `noContentFallbackOnly`（兜底块即在该作用域创建）⇒ 与语言无关。**新守卫**：`client/src/tests/i18nLiteralRatchet.test.ts` + 基线 JSON（逐文件命中数只减不增 + 总量只减不增 + 清单文件必须存在），口径三条排除（注释行 / 已走 `t()` 的行 / 开发者消息 `console`·`logger`·`throw`）。**守卫自省（如实）**：修掉一处**假阳性**（`isCommentLine` 漏判 JSX 注释 `{/* … */}` ⇒ `ChatInput` 组件注释被误计）与一处**假阴性**（真正的用户可见文本 `ChatInput:1505` 因同行无引号而**漏计** ⇒ 已迁 `chat.pendingQuestionHint`，用 key-only 写法避开 prettier 折行）。**外科手术式复核（如实）**：撤回 B3 为达成「0 warning」给 **6 处存量 `exhaustive-deps` 告警**加的 `eslint-disable`（经 `git show HEAD:<file> | eslint --stdin` 取证：告警**改前即有**）；`DAGView` 的 disable 属本轮引起（`t` 未进依赖）⇒ **正修**（`[planId]` → `[planId, t]`）；`XTermPanel` 的 `t` 未进依赖系有意（注释明示「挂载一次写死启动文案、切换语言不重建」）。**验证**：棘轮测试 **1 pass / 0 fail**；**client 全量 566 pass / 0 fail（68 文件）**（含 i18n key parity）；`typecheck` 0 错；`eslint` 改动文件 0 问题。**如实边界**：**未在真机 UI 切换 `en`** 走查 ⇒ `e2eVerified=false`；**剩余 17 处**属**口径明确不迁**（`logger`/`Error` 参数 · `format.ts` 的 `万`/`千` 单位 · 已 i18n 的默认值多行）；≈35「边界项」与数据表**本片不治理**。证据 `HARDCODE-HDP2-2-BULK-I18N`。
- ✅ **执行域「PREPARED 快照」durable 落盘能力（T1-13 / `✅-4` 前置，S1）** - 新增 durable 会话事件 `execution/prepared`（三处登记：`shared/events/eventNames.ts` / `session/types/eventPayloads.ts` / `session/types/knownEventTypes.ts`，漏一即编译失败；前端自有 `LiriEventMap` 镜像同步补键）+ `execution/preparedSnapshot.ts`（`emitPreparedSnapshot` / 纯函数 `pickPreparedSnapshot`）。**语义与四原语遥测广播分离**：后者是 fire-and-forget 带外广播（受 `STATE_PROJECTION_BROADCAST` 默认关门控），本事件是**落盘事实**（**不受**该开关门控）；**复用**既有 `execution/eventSink.ts` 追加通道（不新建事件通道/总线）。**落点 P-B（用户 2026-10-13 裁定）**：`streamMessageToolSelectionFlow.selectAndObserveToolDefinitions`（工具集 trim 后、**首次模型请求之前**，与 `RequestSnapshotService` 的写前持久化同相位）⇒ 记「本次执行 PREPARED 时点的**最终可见工具名**（去重 + 稳定排序，只存名字）」，供重放**读落盘快照**而非直读当前 Profile。`generation` 由执行记录补齐（缺失 ⇒ **不臆造**、如实 warn 后不落盘）。新增 `tests/execution/preparedSnapshot.test.ts` **5 例**（先红后绿：临时置空发射点 ⇒ 3 fail / 2 pass → 还原 5 pass / 0 fail）；回归 `tests/execution` 87/0、`tests/chat/orchestrator`+`tests/tools/toolCategories.test.ts` 112/0。**如实边界**：本批**只落能力本体**，**未实现 TG-4**（会话 profile 按需注入）；`pickPreparedSnapshot` **暂无生产消费者**（消费方 = TG-4 重放路径）；**未改** `ExecutionManager.recover()`（DB 路径 ≠ 会话事件重放）；`e2eVerified=false`。零行为变更口径：仅新增 1 类 log-only 事件，工具可见面与模型请求内容不变。证据 `PREPARED-SNAPSHOT-PERSIST`。
- ✅ **TG-4 / T1-13 本体：会话 profile 按需注入（能力标签 → 追加可见类别）** - 声明面 `session.metadata.toolProfile`（**能力标签**，如 `media` / `coding`，依据 = `google ai 建议.md:78,152` 原文点名）；映射单一事实源 `tools/toolProfile.ts`（`TOOL_PROFILE_CATEGORIES` = `media ⇒ image/video/media`、`coding ⇒ code`；`resolveToolProfileCategories` **去重**，未登记标签**忽略 + 一次性告警**、**不臆造**类别）；注入点为 `selectToolsForTurn` 把 profile 类别并入既有 `extraCategories`（与 D7/L2 的 `image` 追加同口径）⇒ **复用 `filterToolsByTask`，未新建 Top-K 路由**（CS01）。**默认零行为变更**：未声明 / 空 ⇒ 零追加（**不引入无消费者开关**，CS03）。**可复现**：注入后的最终可见集仍由 `execution/prepared` 落盘；**重放唯一入口 = `pickPreparedSnapshot`**（严禁直读当前 `toolProfile`）。新增 `tests/tools/toolProfile.test.ts` **5 例** + `tests/chat/orchestrator/toolProfileInjection.test.ts` **5 例**（**可枚举差异**：`undefined`/`media`/`coding` 两两不等；**重放读快照不读当前 profile**）；**先红后绿**（临时置空映射 ⇒ 7 fail / 3 pass → 还原 10 pass / 0 fail）；回归 **209/0**。**如实边界**：**实时重放路径未接线**（本批交付落盘 + 读回契约 + 重放独立性测试；把快照**强制套用**到 resume/replay 主链属行为变更，列为 spec §11 待裁定 R-A/R-B）；能力标签**仅 `media` / `coding`**；**可见性 ≠ 授权**；`e2eVerified=false`。证据 `TOOLGOV-TG4-PROFILE`。
- ✅ **T1-13 / `✅-4` R-A：重放强制套用落盘快照（默认关）** - 新增功能开关 `PREPARED_SNAPSHOT_REPLAY`（**默认关 ⇒ 零行为变更**）；宿主 `ChatManager._resolveReplayForcedTools` 在**会重算工具面**的续跑分支（`_resumeSuspendedStream` 的「重发一轮」）之前，读该会话最近一条 `execution/prepared` 快照并以 `visibleTools` **覆盖**实时结果 ⇒ 重放工具面 = **落盘快照**（不受运行期 profile / 注册表变更影响）。**范围收窄取证**：另一分支（检查点重放 `resumeStream`）逐条重放剩余工具调用、**不重选**工具 ⇒ **无漂移面、无需强制**。透传链 `StreamMessageOptions.forcedVisibleTools → ToolSelectionFlowOptions → selectToolsForTurn`（`options` 整体透传 ⇒ **未触碰** `runStreamMessage`，规避 `lint:fn-size` 棘轮）；`forcedVisibleTools` 非空 ⇒ 短路任务/profile 裁剪、取名字命中者（**已消失工具不复活**），且新落盘快照记录**强制后**集（重放幂等）。`resolveReplayVisibleTools` 获得首个生产消费者（消除 S1 遗留「无消费者」）。新增 `tests/chat/orchestrator/preparedReplayForce.test.ts` **5 例**（先红后绿：禁用短路 ⇒ 3 fail / 2 pass → 还原 5 pass / 0 fail）；回归 **244/0**。**如实边界**：仅覆盖会重算工具面的分支（R-B「每轮覆盖」**未采纳**）；`e2eVerified=false`；开关默认关。证据 `PREPARED-REPLAY-FORCE`。
- ✅ **T2-8 / `✅-17`：编排触发绑定四原语（形态 A：只读投影上报 + 新增 `orchestration` 域）** - **原文与既有裁定冲突**（四原语严格只读、不承载「断言/锁定」裁决；「中心状态机」本仓不存在；编排族不整族继承/不 reparent）⇒ 经裁定改为**只读上报**：`StateProjectionDomain` 增 `'orchestration'`（关联字段按域取：`execution` ⇒ `sessionId`；`orchestration` ⇒ 会话型携 `sessionId`、任务型携 `orchestrationId`；**execution 域键集不变** ⇒ 既有「键集恒定」断言零改动仍绿）；新增 `state/engine/orchestrationProjection.ts` 的 `publishOrchestrationProjection`（与 `execution/executionProjection.ts` 对称；门控/广播仍在 broker ⇒ 未新建总线/状态机）。接线：`ChatManager.triggerCouncilDebate` 与 `chat/launchers/PdcaLauncher` ⇒ `PREPARED`；`runtime/api/domainSnapshotOps.runCouncilDebate` ⇒ `RUNNING` → `try/finally` ⇒ `SETTLED`（抛错亦如实上报）。原文「断言」降级为**只读一致性观测**（观测不到活跃执行 ⇒ **一次性 warn 如实标注**，**绝不阻断**）。新增 `tests/state/orchestrationProjection.test.ts` **5 例**（先红后绿：置空出口 ⇒ 3 fail / 2 pass → 还原 5 pass / 0 fail）；回归 `tests/state`+`tests/execution`+`tests/chat/orchestrator` **318/0**。**如实边界**：形态 B/C 未采纳；T2-8 原文「断言/锁定」语义**有意弃用**；`goal` 信号与 `StageOrchestrator` 逐阶段**未接线**；该域投影**暂无真实消费者**；`e2eVerified=false`；开关默认关 ⇒ 零行为变更。证据 `T2-8-ORCH-PROJECTION`。
- ✅ **债四 S5（部分）：USD 口径底座（不设任何默认上限值）** - `§12 Q-U3`（USD 默认上限）**未裁定**，spec 硬约束「未定前不得实现任何 USD 默认值」（不得以 `$50/日` 先例或任何数值回填）⇒ 走「**无默认值底座**」：新增配置键常量 `DAILY_BUDGET_USD_CONFIG_KEY = 'costControl.dailyBudgetUSD'`（与 token 键并列），`resolveDailyBudgetConfig()` 增**可选** `limitUsd`（持久化配置 ＞ env `LIRI_DAILY_BUDGET_USD` ＞ **无兜底常量**）；状态文件扩 `usedUsd`/`debtUsd`（缺失/非法 ⇒ 0，**绝不由 token 反推金额**）；新增 `recordUsdUsage(usd, sessionId?)`（非正/非有限 ⇒ 幂等 no-op；**不消费** `waive-once`）+ 只读 `getUsdState()`；跨日 `_rolloverIfNeeded()` 同法扣回（两本账对称独立）；`restore`/`_persistedState` 往返；`reset()` 清 `usedUsd` 不清 `debtUsd`。**USD 不参与任何判定** ⇒ `limitUsd === undefined` 即无 USD 闸门，行为与现状一致。新增 `tests/query/dailyBudgetUsdBase.test.ts` **5 例**（先红后绿：禁用累加 ⇒ 2 fail / 3 pass → 5 pass / 0 fail）；回归 `tests/query`+`tests/budget` **344/0**。**如实边界**：**S3（闸门切金额）受 Q-U3 挡住未做**；**换算接线未做**（调用点拿不到 `model` ⇒ 需另起切片补参数，**不臆造金额**）；端点/前端未做；`recordUsdUsage` 仅测试消费；`e2eVerified=false`。证据 `DEBT4-S5-USD-BASE`。
- ✅ **T1-9 / 通道治理 §2.4：入站 PREPARED 接缝（只读上报，默认关）** - 位置 = `routeChannelMessage` 的 `sessionKey` 之后、**进入 LLM 链路之前**（严格在**去重 / 帧验证 / 限流全部通过**之后，`preSendContextProtection` 之前的链路前段）。**形态与 `T2-8` 同裁定**：四原语**严格只读、不承载裁决** ⇒ 原文「经**中心控制器**显式转移 `PREPARED`」落为**只读上报**（该条验收口径本就是「状态转移**可观测**」）。域取 **`execution` + `sessionId`**（与随后 `ExecutionManager.acquire()` 同域同会话；**不新增第三个域**，CS03）。实现仅 3 行、复用既有 broker（**不新建总线**）；受 `STATE_PROJECTION_BROADCAST`（**默认关**）门控 ⇒ **零发布、零行为变更**。新增 `tests/channels/inboundPreparedSeam.test.ts` **3 例源码守卫**（出口复用 / 三要件同现 / **位置序**：`PREPARED` 出现在「进入 LLM 链路」日志之前）。**如实边界**：该接缝**暂无真实消费者**（出站订阅面暂缓）、`e2eVerified=false`、开关默认关。证据 `CHANGOV-T19-INBOUND-PREPARED`。
- ✅ **T1-6 / 通道治理 §1.3：入站附件进入 R16 日预算预留口径（新增专用入参）** - **缺口**：渠道入站原**未传任何附件信息** ⇒ 经通道发来的带附件消息**绕过日预算预留**（硬闸门缺口）。**关键取证（为何不复用 `images`）**：`images` 同时是**多模态载体**（`StreamPipeline.ts:155-184` 读 `img.path` 送模型）⇒ 塞通道附件会污染模型输入；且两个 `MessageAttachment` **同名不同物、严禁断言互换**（通道协议层 vs 会话领域层）。⇒ 按裁定新增**专用预留入参** `attachmentSizes?: readonly { size?: number }[]`（`StreamMessageOptions` + 渠道端口契约），预算侧 `estimateAttachmentsTokens(options?.images) + estimateAttachmentsTokens(options?.attachmentSizes)`；`messageRouter` **显式适配** `message.attachments`（**只取 `size`**，不带 url/data ⇒ 不构成模型可见输入）。**零行为变更**：未提供该入参 ⇒ 0 ⇒ 与现状逐字等价。新增 `tests/channels/inboundAttachmentBudget.test.ts` **4 例**（源码守卫 3 + 求和语义 1）；`typecheck` 0 错。**如实边界**：非图像附件的口径扩展（MIME 分类/上限）未做；仅覆盖渠道入站（前端 HTTP 路径原本即携 `images`）；`e2eVerified=false`。证据 `CHANGOV-T16-INBOUND-ATTACH-BUDGET`。
- ✅ **T1-2② / TG-2+TG-6（A 片）：`ISnapshotCapable` 契约 + 探测（声明式、零行为）** - 原文（工具治理方案阶段 1.2）要求「长耗时侧车工具**不得同步阻塞**——提交后可向内核投影 `SUSPENDED`，完成后续跑」；其**阻塞条件已解除**（债二挂起—续跑落地）。本片只落**契约 + 探测**、**不接挂起点、不改编排类树**：`utils/toolContract/Tool.ts` 新增 `SnapshotHandle`（**不透明**，中心层只搬运不解释）+ `ISnapshotCapable { snapshotCapable: true; freezeForSuspend(); resumeFromSnapshot() }`（**可选实现**，**不并入 `Tool` 基接口** —— 强制实现即造无意义空实现，CS03；标记取**字面量 `true`** ⇒ typecheck 期可判别「实现了但未声明」）+ **纯函数** `isSnapshotCapable()`（鸭子类型 + 字面量收窄，**三要件同时**成立才 `true`；非对象/`null`/半成品 ⇒ `false` 且不抛）。**零行为**：无实现者 ⇒ 现值路径逐字不变。新增 `tests/tools/snapshotCapable.test.ts` **5 例**（先红后绿：字面量收窄改宽松 ⇒ 1 fail / 4 pass → 5 pass / 0 fail）；回归 `tests/tools` **828/0**。**如实边界**：**A 片不含**端到端（「提交→挂起→完成→续跑」= **C 片**，依赖 **B 片**侧车作业化）；契约**当前无实现者（有意）**；未接挂起点；`e2eVerified=false`。设计与分片见 `.trae/specs/sidecar-async-suspend.md`。证据 `TOOLGOV-TG2-A-SNAPSHOT-CAP`。
- ✅ **T1-2② / TG-2+TG-6（B₁ 片）：侧车「作业化」协议层（零新帧型）** - 关键选型：**复用 `utils/sidecarIpc.ts` 既有三类帧** —— **提交** = `request`（`method='job.submit'`）→ `response({jobId})`；**完成** = 侧车 → 宿主 **`notify`**（`event='job.completed'`）⇒ **不新增帧类型/传输、不建第三套 IPC**（D10 GR02，CS01）。新增协议常量 `SIDECAR_JOB_SUBMIT_METHOD` / `SIDECAR_JOB_COMPLETED_EVENT` + 类型 `SidecarJobSubmitParams`（`payload` **不透明**，原样透传）/ `SidecarJobCompletedPayload`（`ok` **必填** —— 成败**均须**通知，避免宿主永久挂起）+ 纯函数 `buildJobSubmit()`（缺省不塞 `payload: undefined`）/ `buildJobCompleted()` / `parseJobCompleted()`（**不臆造**：非 `notify`、事件名不符、`data` 非对象或数组、缺/空 `jobId`、**`ok` 非布尔** ⇒ `null`，交超时兜底而非猜成功）。新增 `tests/utils/sidecarJobProtocol.test.ts` **5 例**（含**经既有分帧往返仍可解析 ⇒ 证「零新帧型」成立** + 11 种非法输入 ⇒ null 不抛）；**先红后绿**（移除 `ok` 布尔校验 ⇒ 1 fail / 4 pass → 5 pass / 0 fail）；回归 `tests/utils` **265/0**。**如实边界**：**仅协议层**（主管接线 = B₂：`notify`→完成处理器、`submitJob()` API、`kind='tool-job'` 挂起点）；协议层**当前无调用方 ⇒ 零行为**；端到端（C 片）= 原文验收**未做**；`e2eVerified=false`。设计与裁定见 `.trae/specs/sidecar-async-suspend.md` §4/§5。证据 `TOOLGOV-TG2-B1-JOB-PROTO`。
- ✅ **T1-2② / TG-2+TG-6（B₂ 片）：侧车作业宿主侧接线（完成派发 + `submitJob()` + 兜底）** - 把 B₁ 协议接到宿主：新增 `tools/sidecar/sidecarJobs.ts` 的 `SidecarJobRegistry`（**登记与派发**，协议仍取自唯一基座）—— `register()` **每条作业都有超时兜底**（到期 reject，**绝不永久悬挂**）；`completeFromFrame()` 用 `parseJobCompleted()` 解析，**非作业帧返回 `false`**（交回原分派，不改既有语义）、**未知 `jobId` 返回 `true` 但只留痕不新增不抛**（**不臆造**）、`ok=false` 亦为一次结算（**成败同报**）；同 `jobId` 重复登记 ⇒ **先结算旧的**（不静默覆盖）。主管 **`handleFrame()` 顶部新增作业派发（必须在 `id` 校验之前**，因作业完成通知是**无 `id` 的 `notify` 帧**）；新增 **`submitJob(action, payload?, opts?)`** ⇒ 返回 `{ jobId, completion }`，提交失败**本地结算后抛出**；`deps.jobTimeoutMs`（默认 10 分钟）；`rejectAllPending()` 同口结算在飞作业 ⇒ **崩溃/停止时两本账同因同果**。新增 `tests/tools/sidecarJobRegistry.test.ts` **6 例**（含**唯一未知 jobId 不臆造**、**非作业帧不消费**、**超时兜底**）；**先红后绿**（`payload.ok` 写死恒真 ⇒ 1 fail / 5 pass → 6 pass / 0 fail）；回归 `tests/tools/sidecar*` **70/0**。**如实边界**：**`kind='tool-job'` 挂起点未接**（随 C 片）；**worker 侧作业模式未实现 ⇒ 宿主 API 当前无调用方 ⇒ 生产零行为变更**；端到端（C 片 = 原文验收）未做；`e2eVerified=false`。证据 `TOOLGOV-TG2-B2-JOB-HOST`。
- ✅ **T1-2② / TG-2+TG-6（C₁ 片）：跨进程「提交即返 → 完成兑现」端到端（子进程 oracle）** - C 片验收的**宿主侧作业链路**取得**真实跨进程证据**：新增 `tests/tools/fixtures/jobSupervisorChild.ts`（**子进程 oracle**，与既有 `executionCrashChild.ts` **同法**）—— 父测试 `spawnSync` 拉起，在其中用**真实主管** `ToolSidecarSupervisor` + **真实侧车** `fakeJobSidecar.js` 跑一遍，把**事实**（启动/提交耗时、提交时在飞数、兑现耗时、结果/错误、结算后在飞数）以**单行 JSON**（前缀 `ORACLE_RESULT `）投给父进程 ⇒ **判定一律在父进程**（子进程**只报事实**、不自证）。父侧断言：提交耗时可忽略且提交后在飞 = 1（**提交即返**）· **兑现 < 1s**（oracle 侧超时兜底设 4s ⇒ 与「超时兜底」**在证据层可分**）· 结果 `{echo:'slow',n:1}` · 结算后在飞 = 0；失败分支 `error` 含 `fixture failure`。**先红后绿**（期望改 `n:2` ⇒ 1 fail / 4 pass → 还原 5 pass / 0 fail）；回归 **11 pass / 0 fail / 0 skip**（原两条 `it.skip` 转为真跑）。**为何绕行（如实）**：「`bun test` × 主管」组合下异步完成通知在**本进程内**未被兑现，2×2 矩阵（{纯脚本, `bun test`} × {裸 spawn, 经主管} = ✅✅ / ✅❌）已隔离为**非产品接线**、机制未解释、**不宣称平台缺陷** ⇒ 该运行器异常**单独登记** `TOOLGOV-TG2-C1-BLOCKED`（`fixed=false`：**绕行 ≠ 修复**）。**如实边界**：断言发生在**子进程**，父进程核对的是**投影结果**（不如进程内断言直接）；C₂（挂起→续跑）与真实 worker 作业模式当时**未做**。证据 `TOOLGOV-TG2-C1-E2E-ORACLE`。
- ✅ **T1-2② / TG-2+TG-6（C₂ 片）：侧车作业挂起「提交 → 挂起 → 完成 → 续跑」（原文验收达成）** - 原文「长耗时侧车工具**不得同步阻塞**——提交后须能向内核投影 `SUSPENDED`，完成后通知解冻续跑」落地（§4 裁定：Q2 新增 `kind='tool-job'`；Q3 冻结 = **不推进轮次 + 保留连接**）。**六处分层实现**：① 新开关 `TOOL_JOB_SUSPEND`（**默认关**；有效前提 `TOOL_SIDECAR_MEDIA` 亦开）；② `SuspendKind` 增 `'tool-job'`（与 budget/guard **正交**）、`SuspendChain` 增 `'tool-job'` 并新增 **`ResumableSuspendChain` + `isResumableChain()`** ⇒ 续跑通道在**编译期**拒收作业挂起（既有 3 处调用点**零改动**即通过）；③ `query/toolJobSuspend.ts`（新）：登记/释放（**仅放 `kind='tool-job'`**，投影 `SUSPENDED`/`RUNNING`，幂等）；④ `core/spi/ToolJobSuspendService.ts`（新）：窄契约 + **未注册 ⇒ no-op 代理**（不挂起/不释放/不抛）+ 推送注册；⑤ 装配在 `entrypoints/spiWiring.ts`（**为何必须走 SPI**：`tools ⇄ query` 同层但既有 `query → tools` ⇒ 直接 import 会成**模块级循环**）；⑥ 工具面：`mediaSidecar` 的 **worker 作业模式**（`job.submit` ⇒ 受理即返 + 异步 `notify{job.completed}`；**未覆盖动作/缺 `jobId` ⇒ 提交阶段 fail-closed**；共用取消表，`notify{cancel}` 以 `ok=false` 结算）、`createL2WorkerJobPort()`（**`submitJob()` 首个生产调用方**；`finally` 释放 ⇒ **失败也解冻**）、`ImageAnalysisTool.l2Analyze()` 单一收口（**双开关**才走作业模式；**下传 `sessionId`**，缺失 ⇒ **fail-closed 抛错**而非静默退回同步路径；否则既有路径**逐字等价**）。新增测试 **20 例**（挂起模块 7 + worker 作业模式 6 + L2 作业端口 7）+ **e2e**：同一子进程 oracle 增 **`suspend-e2e`** 场景（真实主管 + **真实挂起协调器** + **真实 SPI 注册** + 实收 `state:projected`）⇒ 断言 `kinds=['tool-job']`、**完成前后均处挂起**、释放后解冻、`SUSPENDED → RUNNING` **时序**、结果回填；**先红后绿**（去掉释放的 kind 判据 ⇒ 1 fail / 6 pass → 7 pass / 0 fail）。回归 `tests/{tools,query,chat,http}` **1925/0**；`typecheck` 0 错、`lint:arch` **0 error**（循环依赖 0）。**如实边界**：双开关默认关 ⇒ **默认零行为变更**；「冻结」= 登记 + 投影 + 不推进轮次（**未**释放侧车连接）；e2e 用**夹具 worker**（真实 `mediaSidecar` 子进程 e2e **未做**，其作业模式由注入端口单测覆盖）；首批实现者**仅**媒体侧车 L2 分析（A 片 `ISnapshotCapable` 仍**无实现者**，本片**未使用**该契约）。证据 `TOOLGOV-TG2-C2-JOB-SUSPEND`。
- ✅ **债四 S8「换算接线」：真实记账点补 `model` ⇒ 金额入账（USD 台账），闸门判定不变** - 让 S5 的 `recordUsdUsage` 获得**生产消费者**（消掉 S1+S2 适配器「仅单测消费」与 S5「记账入口无调用方」两处 UW）。**单一换算口径**：新增 `recordTurnCostUsd(parts, model, sessionId)`（`query/DailyBudgetManager.ts`）= core SPI 取价（`model_registry`）→ core 零依赖 `calculateTotalCost`（复用 S1/S2 的 `estimateTurnCostUsd`）⇒ **与成本报表计费链同源**（spec §6-1「同源」）。**不臆造金额**：模型名缺失 / 占位 `'unknown'` ⇒ **不入账**（debug 留痕、**不取兜底价**，§3-D2 明文）；**已命名但未登记** ⇒ 仍入账（兜底价，降级可用）但 warn **如实标注** `unknownModel`（Q-U5）。**接线**：chat 主链 `ChatManager.recordChatResponseUsage(..., model?)`（四参**复用既有 `buildRequestTimingData`** ⇒ 缓存字段不另造提取）+ `streamingLlm._reportUsage` **解析一次** `turnModel` 并**同一值**供金额台账与 `trackUsage`（数出同源）+ 端口四处透传（`StreamPipeline` / `ToolLoopRunner` / `streamMessageToolLoopContext` / `ChatOrchestratorHost`）+ 非 chat 四处（`TranslationService:163,357,504` · `SubAgentEngine:815` · `AgentTool:1418` · LRO 默认执行器）。新增 `tests/query/dailyBudgetUsdWiring.test.ts` **6 例**（金额入账 = core 公式 / **Token 口径与档位零变化** / 缺模型不入账 / **缓存纳入**（Q-U4）/ 两本账 / 0 tokens no-op）+ `tests/ai/usageModelAttribution.test.ts` **3 例源码守卫**（第 4 参传同一 `turnModel` / 记账点确调 / 签名保留 `model?`）；**先红后绿**（停掉入账 ⇒ 4 fail / 2 pass → 还原 6 pass / 0 fail）；回归 `tests/{query,budget,chat,ai,cost,tasks,tools}` **2439 pass / 1 skip（预存）/ 0 fail**；`typecheck` 0 错、`lint:arch` **0 error**、`lint:models` 硬编码 0。**如实边界**：① **闸门判定不变**（`usedUsd` 未参与任何拦截/档位 ⇒ 「是否拦截」与改动前逐字一致；USD 闸门 = **S3**，受 `§12 Q-U3` 未裁定挡住）；② **行为新增（如实）**：状态文件 `daily-budget-state.json` 的 `usedUsd` 由「恒 0」变为**真实累计**（`debtUsd` 仍无自增点，S4 未做）；③ **自定义 `ExecutorFn` 路径只记 token、不记金额**（编排器看不到执行器实际模型）；④ 非 chat 路径**不含缓存两项**（`extractCacheTokens` 属 `ai` 层，query→ai 会成模块级环 ⇒ 按缺失处理）；⑤ `e2eVerified=false`。证据 `DEBT4-USD-WIRING`。
- ✅ **债四 `§12 Q-U3` 裁定改写：USD 上限不设代码默认值，改由用户在 UI 自主配置（未配置 ⇒ 不启用金额闸门）** - 依用户口径「**USD 应由用户自主决策**，需要前端管理与维护页面」（`dev_docs/20261013/硬编码统一治理方案-20261013.md` §6 / §11 `Q-H1`）。**硬约束保留且更强**：代码内**不得出现**任何 USD 上限数值（不回填配置默认 / 不播种 / 不作 feature flag 默认 / 不作常量兜底）—— 从「等一个数值」变为「**永远不设数值**」。**启用条件**：`FEATURE_USD_BUDGET_GATE`（默认关）**且**用户已保存 `limitUsd`；两者缺一 ⇒ 回落 Token 口径（spec D6②）并在对照日志如实标注。**为何是"解锁"**：原阻塞的实质是「S3 需要一个默认上限」，改由用户配置后该前提消失 ⇒ **S3/USD-4 可开工**（切片 USD-1…USD-4 见治理方案 §6.3；实施按 §6.4「**双轨从严**」—— 金额 + Token 任一先踩线即拒；不新增判定点/账本；拦截动作仍为 `AppError('DAILY_BUDGET_EXCEEDED')`，**不**以 `SUSPENDED` 充当拦截信号）。**同步修订**：`.trae/specs/unified-budget-and-accounting.md` → v1.4（头部状态「十项已裁定」+ §12 `Q-U3` 行 + §12.1 追加裁定小节）。**本条为登记类**（零代码改动）。证据 `DEBT4-QU3-RULING`。
- ✅ **硬编码治理 Step 0（Q-H2）：默认语言/时区口径归一 `zh-CN` / `Asia/Shanghai`（消除"假真源"）** - **问题（取证）**：`constants/common.ts` 原为 `DEFAULT_LOCALE='en-US'` / `DEFAULT_TIMEZONE='UTC'`，与仓内**实际默认**（`docs/i18n/LanguageManager.ts`、语音 `ttsConfigOverlay.ts`/`VoiceProvider.ts`/`WakeWordEngine.ts`、`hooks/useVoice.ts`、`plugins/bundled/SettingsPlugin.ts` 均为 `zh-CN`；前端 i18n `fallbackLng:"zh"`）**口径相反**，且这两个常量**零消费者**（grep 仅命中定义处）⇒ 典型「**假真源**」。**做法**：① 真源改值为 `zh-CN`/`Asia/Shanghai`（附口径注释）；② **7 个决策点改为引用 `DEFAULT_LOCALE`**（`VoiceProvider` 原为 `'en-US'`、与口径相反，一并纠正）；语言**清单**类字面量（如可选语言列表）不动（合法枚举）；③ **分层纪律**：`constants`=infra ⇒ `core` **不得**引用（R00-001），故 `core/memory-host-sdk` 的 `DEFAULT_MEMORY_DREAMING_TIMEZONE`（显式 `undefined`，有意无默认）**不动**；④ `utils/cron.ts` 保留「**跟随系统时区**」（比硬编码城市时区更精确，非同源问题）。新增 `tests/config/defaultLocaleTimezone.test.ts` **4 例**（真源取值 / 7 个决策点引用真源 + 确实 import / **跨部署单元同值契约**（前端时区兜底 = `DEFAULT_TIMEZONE`）/ cron 保留跟随系统）；**先红后绿**（真源改回旧值 ⇒ 2 fail / 2 pass → 还原 4 pass / 0 fail）；回归 `tests/{config,voice,docs,plugins,hooks}` **336 pass / 0 fail**；`typecheck` 0 错、`lint:arch` **0 error**。**如实边界**：`commands/**` 的 `toLocaleString('zh-CN')` **展示格式化**未动（格式化 locale ≠ 产品默认语言 ⇒ 归 HD-P2）；前端时区兜底仍为前端本地常量（物理不可共享）⇒ 测试锁同值；`e2eVerified=false`。证据 `HARDCODE-QH2-LOCALE-TZ`。
- ✅ **硬编码治理 §7.5 HD-INFRA-1：机器可读 JSON/YAML 内的 ASCII 双引号陷阱 —— 规范落盘（`CS08`）+ 门禁自检 + 校验前置** - **问题（取证，非手误）**：`.trae/architecture/fix-evidence-registry.json` 的 `notes` / `reopenWhen` 内若出现**未转义的 ASCII 双引号**（中文语境夹引号的自然写法）⇒ 字符串提前闭合 ⇒ 整份 JSON 解析失败 ⇒ `lint:fix-evidence` 崩、CI `doc-gate` 红；**复发 ≥4 轮**（门禁自述「我已在登记表上**三次**因此使 JSON 破损」+ 2026-10-13 写两条目时**一次性引入 4 处**），且**每轮都在事后修**。**根因两层**：① **规范悬空** —— 门禁报错写「惯例见 `.trae/rules/`」，但该目录 15 个规则文件**零处**写过这条（与 Q-H2「假真源」同构）；② **校验点位滞后** —— `lint:fix-evidence` **只跑 CI**，pre-commit 不含它。**四子片**：`1a` 规范落盘 —— `.trae/rules/coding-standards.md` 新增 **`CS08`**（值对 ≠ 能解析 / 先看同类面 + §6 索引行 + §7 关系行），并让 `scripts/lint-fix-evidence.ts` 报错文本**显式引用 `CS08`**（悬空引用 → 可核对条目）；`1b` 门禁自检 —— `tests/gates/fixEvidenceGate.test.ts` 新增 4 组守卫（规范真实存在且被引用 / 真台账可 `JSON.parse` / **同类面可枚举**：递归扫含中文源头 JSON/YAML 并逐份断言可解析，`tsconfig*.json` 按 JSONC 放行、构建产物与 `dev_docs` 排除 / pre-commit 生成器含该步骤）；`1c` 校验前置 —— `app/scripts/setup-git-hooks.ts` 生成的 pre-commit 在**仓库根段**新增 `lint-fix-evidence`，失败即 `exit 1`，并已重新生成 `.git/hooks/pre-commit`；`1d` 同类面扫描交付 —— `dev_docs/20261013/格式陷阱同类面扫描-20261013.md`。**验证**：`bun test tests/gates/fixEvidenceGate.test.ts` **12 pass / 0 fail**；**先红后绿已实证**（临时塞含中文 + 未转义引号的探针 JSON ⇒ 守卫 ③ **1 fail / 11 pass** 且**打印精确文件** → 删除后回绿）；`bun run lint:fix-evidence` 绿（条目 140 · 全证据链 7 · 单元级 111）；同类面实测**全仓 127 JSON + 45 YAML / 源面 34 + 19**，**唯一 `JSON.parse` 失败 = `tsconfig.root-scripts.json`（JSONC，不适用）⇒ 真破损 0**。**如实边界**：`1c` 的**真实提交路径已跑通**（提交本批时 pre-commit 实际执行该新步骤并通过：钩子输出「条目 140 · 全证据链 7 · 单元级 111 ➜ ✅」）；「坏输入 ⇒ 提交被拦」的**拦截分支**由守卫 ③ 负向自证（探针 ⇒ 变红）+ 钩子 `exit 1` 共同证明，**未**用「污染工作区 + 真实 commit」组合复验；本条**只收口格式/约定型陷阱**，「值类硬编码」（HD-P0-2 端点/host 等）不在本条；`e2eVerified=false`。证据 `HARDCODE-INFRA-1-QUOTE-SPEC`。
- ✅ **硬编码治理 HD-P0-1：兜底价单一真源（收编 2 处数值副本）** - 取证（治理方案 §4.1 **A2**）：兜底价 `{输入 3 / 输出 15 / 缓存读 0.3 / 缓存写 3.75}` 曾在**三处各写一份**：`core/pricing.ts`（**真源** `DEFAULT_MODEL_PRICING`）、`tokenBudget/PriceManager.ts`（`DEFAULT_PRICING_RESULT`）、`ai/prompts/PromptCacheManager.ts`（`DEFAULT_CONFIG`）⇒ 未知/零定价模型在「闸门折算 / 成本报表回落 / prompt-cache 估价」可得**不同单价**（R02 双源漂移）。**做法（同值映射，零语义变更）**：后两处改为**引用真源**并按字段名**显式映射**（`inputPer1M ⇐ inputPricePerMillion` 等）；`cost/ModelPricing.ts` 已于债四 S1 引用真源，本片**不动**（测试同时钉住防回退）。新增 `tests/cost/fallbackPricingSingleSource.test.ts` **4 例**（**行为**：`PriceManager.getPriceSync(未登记模型)` 四项 == 真源 / 三处均引用真源 / **源码守卫**：默认块内不再有旧字面量 / 真源数值与字段形状未改写）；**先红后绿**（真源改 3.5 **且**复现旧硬编码副本 ⇒ **3 fail / 1 pass** → 双双还原 **4 pass / 0 fail**）；回归 `tests/{cost,tokenBudget,ai,query,budget}` **677 pass / 1 skip（预存）/ 0 fail**；`typecheck` 0 错、`lint:arch` **0 error**。**如实边界**：真源数值本身仍是**硬编码常量**（Q-U5 已裁定接受的兜底口径，与「模型属性应读 DB」不同域）；同处 `contextWindow: 200000` 与 `PriceManager` 注册表路径的 `cacheWrite/cacheRead = 0` **既有不一致未动**（已列 `reopenWhen` ⇒ 归 HD-P2/复核）；`e2eVerified=false`。证据 `HARDCODE-HDP0-1-FALLBACK-PRICE`。
- ✅ **硬编码治理 HD-P0-2：端点 / 本机 host **单一真源**（A1 Ollama · A3 微信 · A4 OAuth · A6 绑定 host）** - **问题（取证）**：「同一事实源的端点/host 字面量散落多处」⇒ 改一处漏一处（改 Ollama 端口要搜 5 处、漏改即连不上本地模型）。**做法（同值搬运、零语义变更）**：新增 `core/endpoints.ts`（`LOCAL_HTTP_HOST` / `DEFAULT_OLLAMA_ENDPOINT` / `DEFAULT_OLLAMA_OPENAI_ENDPOINT`（由前者 `${base}/v1` **派生**）/ `DEFAULT_WECHAT_BOT_ENDPOINT` / `DEFAULT_OAUTH_LOCAL_BASE_URL`），`core/index.ts` barrel 追加导出，24 个消费文件改引用。**分层纪律（§7.3.1 启动期安全）**：该文件**零 import、不读 config**（`core` 只允许依赖 `core`，R00-001）⇒ 配置值注入仍在 app/service 层；T0/T1 早期不传配置即回落静态常量，**未引入就绪判据 API**。**回仓更正方案原计数**：A1 实为 **7 处代码点**（原文 5；新发现 `ai/ModelManagementBootstrap.ts:159`）、A3 实为 **5 处**（原文 4）、A4 实为 **2 处**（原文 3）、A6 实为 **33 处字面量**（原文「≥18 文件」）其中 **18 处属「绑定/回落」语义（14 文件）** ⇒ 本轮收敛 **17 处（13 文件）**。**防错误合并**：`:8080` 有 **3 个不同事实源**（OAuth 回调 / llama.cpp 预设 / LocalAI 预设）⇒ 只收编 OAuth 侧（2→1），预设数据表**不动**；A6 的 15 处「本机判定谓词 / 白名单 / 文档」属**不同事实源** ⇒ 不动。**有意排除 1 处**：`entrypoints/http-server.ts:18` —— 该文件不变量为「与 repl.ts 完全解耦、**零项目模块静态依赖**（既有 `@modules/infrastructure` 是 `import type`、编译期擦除）；仅经动态 `import()` 加载」，为取常量而加**运行时静态 import** 会破坏该不变量 ⇒ 保留字面量。**验证**：新增 `tests/core/endpointsSingleSource.test.ts` **5 例**（取值逐字相等 + `/v1` 派生 / 三个端点字面量在 `app/src` 下只出现在 `core/endpoints.ts` / `:8080` 两事实源不互并 / `core/endpoints.ts` 零 import 不读 config / A6 棘轮 13 文件「只减不增」且均引用真源）⇒ **5 pass / 0 fail**；`typecheck` 3 工程 0 错；`lint:arch` **0 error**（警告 5 条存量未增）；受影响面回归 `tests/{ai,channels,core,config}` **890 pass / 0 fail**。**如实边界**：**真机冒烟未做**（本地模型连通 / 渠道回调 / OAuth 回调）⇒ `e2eVerified=false`（已入 `修复证据登记.md` §2）；本轮**不改变任何默认值**（守卫 ① 即该断言的代码化）；未新增任何 feature flag/配置项（CS03）。证据 `HARDCODE-HDP0-2-ENDPOINTS`。
- ✅ **债四 USD-1 / USD-2：日预算端点补 USD 字段（只读暴露 + 用户写入/清空，无任何默认值）** - 依 `§12 Q-U3` 裁定「**USD 上限由用户自主决策**」落地前两片（治理方案 §6.3）。**USD-1（只读）**：`GET /v1/cost/daily-budget` 快照增 `usedUsd` / `debtUsd` / `limitUsd`；未配置 ⇒ **显式 `null`**（**不臆造 0** —— `0` 会被误读为「上限=0 ⇒ 全额拒发」；亦免去前端区分「字段缺席 / `null`」）。**USD-2（写入）**：`PUT` 增可选 `dailyLimitUSD` —— **正有限数** ⇒ 设置（**金额允许小数**，故另立 `isValidDailyLimitUsd`，与 Token 的「正整数」口径区分）· **`null` ⇒ 清空 = 解除** · **缺省 ⇒ 保持现值**；落**独立键** `costControl.dailyBudgetUSD`（与 Token 键并列、**互不替代**），**不回填任何默认值**。**归一化（CS01）**：校验口径导出复用（HTTP 边界与内部 `setLimitUsd` 同一口径）。**「清空」选型（如实）**：`ConfigManager` 无删除键 API ⇒ 写 `null`，解析侧既有口径天然视同未配置（无需改解析）。**边界纪律**：`''` / 字符串 / `NaN` / `0` / 负数 ⇒ **400 fail-loud**（该口径已固化为 **USD-3 前端硬契约**：输入框留空必须发 `null`）。新增 `DailyBudgetManager.setLimitUsd()` + `query` barrel 两处出口。**验证**：`tests/http/daily-budget-handlers.test.ts` **11 → 19 例**（`USD-1` 3 + `USD-2` 5）⇒ **19 pass / 0 fail**；回归 `tests/{http,query,budget,cost}` **617 pass / 1 skip（预存）/ 0 fail**；`typecheck` 0 错；`lint:arch` **0 error**。**如实边界**：**端到端未做**（前端 USD-3 未做 ⇒ 未做真实 UI/HTTP 往返）`e2eVerified=false`；**USD 仍不参与任何拦截**（闸门 = USD-4）⇒ 行为与改动前**逐字一致**。证据 `DEBT4-USD-ENDPOINT-IO`。
- ✅ **债四 USD-3：前端「日限额」面板 —— 金额上限编辑 + 金额用量展示 + 换算说明** - 把 USD-1/USD-2 的后端能力接到**用户可见面**（治理方案 §6.3），使 `§12 Q-U3`「**USD 上限由用户自主决策**」真正可用。**面板**（`DailyBudgetPanel`）：增「金额上限 (USD)」输入（**留空 = 不启用**）+ 只读展示（今日已用金额 / 金额欠账 / 金额上限）+ 换算说明（按「各模型实际单价 × 用量」折算，与成本报表**同源**）；**Token 三个控件语义不变**（辅助口径保留）。**严格对齐后端白盒契约**：留空 ⇒ 发 **`null`**（清空 = 解除）· 填写 ⇒ **正数（允许小数）**· 其它 ⇒ **前端发送前就地报错、不发请求**（后端对非法值本就 400）。**展示侧不臆造**：未配置上限 ⇒ 显式「**未启用**」且输入框留空（**绝不显示 `$0.00`** —— `0` 是"上限 0 ⇒ 全额拒发"的误读）；而 `usedUsd`/`debtUsd` 为 0 时**照实显示** `$0.00`。**输入框以字符串持有**（`Number('') === 0` 会被判非法上限 ⇒ 留空必须显式转 `null`）。**金额格式**：最少 2 位 / 最多 4 位小数（`$0.0031` 不被抹成 `$0.00`）。**类型层**：`DailyBudgetStatus` 补 `usedUsd`/`debtUsd`/`limitUsd`，`DailyBudgetUpdate` 补 `dailyLimitUSD?: number | null`；**i18n 双侧各补 8 键**。**验证**：`DailyBudgetPanel.test.tsx` **8 → 13 例**（新增 5：三项展示 / 未配置 ⇒ 未启用且上限格非 `$0.00` / 留空发 `null` / `12.5` 发小数 / 负数不发请求并报错）⇒ **13 pass / 0 fail**；**client 全量 561 pass / 0 fail（66 文件）**；i18n key parity **2 pass**；`typecheck` 0 错；`eslint` 改动 5 文件 **0 error / 0 warning**。**如实边界**：**真机 UI 往返未做**（未走「填写 ⇒ 保存 ⇒ 生效 ⇒ SSE 回刷」全链路，验证停在组件级）⇒ `e2eVerified=false`；**USD 仍不参与任何拦截**（闸门 = USD-4）；未新增任何 USD 默认值/建议值。证据 `DEBT4-USD3-PANEL`。
- ✅ **债四 USD-4（S3）：日预算闸门金额轨「双轨从严」** - 金额口径从「只记账」升级为**在唯一收口内参与拦截**（治理方案 §6.3/§6.4；`§12 Q-U3` 裁定的收口）。**四条硬约束逐条落地**：① **单一判定点** —— 仍在 `checkDailyBudget`（唯一收口）内判定，**不新增第二个闸门**（D7）；② **不新增账本** —— 金额轨只**读** S5/S8 既有 `usedUsd`/`limitUsd`，无新锁/新事务，「预扣→结算」窗口由 Token 轨既有同步预扣闭合；③ **从严 = 任一先踩线即拒** —— `金额已越界 OR Token 已越界` ⇒ 走**同一** `AppError('DAILY_BUDGET_EXCEEDED')` 路径；④ **拦截 ≠ 挂起** —— 未触碰挂起/放行语义，放行仍走既有 `BudgetSuspendCoordinator` + 放行三件套，**不**把 `SUSPENDED` 当拦截信号。**启用条件（无默认值）**：新增开关 `FEATURE_USD_BUDGET_GATE`（**默认关**）**且**用户已配置 `limitUsd`；否则金额轨**完全不参与判定** ⇒ 判定与快照与「没有金额轨」时**逐字一致**。**复用既有「单位无关」设计**：`BudgetSnapshot.unit` 由 `'tokens'` 扩为 `'tokens' | 'usd'`（该注释早已标注为「USD 专项切换点」）+ 新增纯函数 `formatBudgetExhausted()`；4 处「预算已用完」用户文案归口到该纯函数 ⇒ **Token 轨文案逐字保留**、金额轨自动显示「今日金额预算已用完（已用 $X / 上限 $Y）」。**新增双读对照日志** `dailyBudgetGate:dual-track`（两轨并排 + `deniedBy`）供灰度期核对。**验证**：新增 `tests/query/dailyBudgetUsdGate.test.ts` **8 例** ⇒ **8 pass / 0 fail**；**先红后绿已实证**（金额轨启用条件临时置 `false` ⇒ **恰好 1 例变红**）；回归 `tests/{query,chat,tasks,budget}` **1290 pass / 0 fail（188 文件）**；`typecheck` 0 错；`lint:arch` **0 error**；`eslint` 改动文件 0 问题。**如实边界**：**真机端到端未做**（`e2eVerified=false`）；**金额轨无本轮预估**（按已结算 `usedUsd`，结算前窗口由 Token 轨同步预扣部分闭合）；**开关默认关** ⇒ 默认用户零行为变更。证据 `DEBT4-USD4-GATE`。
- ✅ **硬编码治理 HD-P0-3：前后端契约常量（B1 默认后端端口 · B2 日限额 SSE 事件名）** - **问题（取证）**：这两类事实源横跨**后端（`app/`）· 前端（`client/`）· Tauri 外壳**三个**部署单元**，物理上无法共享同一模块 ⇒ 原状是「人工同步」（前端注释自述"需与后端保持一致"）。**做法（采纳方案 §7.2 的①「契约测试」）**：新增 `app/tests/contracts/crossDeploymentContract.test.ts` **5 例** —— B1 3 例（后端真源取值 / **7 个定义点**同值 / 3 处命名·赋值点**恰好**相等）+ B2 2 例（前端组件常量 === 后端导出常量 / 前端**仅一处**定义）。**B1 回仓实测 = 7 个定义点**（原方案只列前后端各 1 处，已更正）：后端 `core/ports.ts` 真源 · 前端 `services/backendUrl.ts` · `vite.config.ts` proxy 兜底 · `playwright.config.ts` webServer 兜底 · **Tauri Rust** `app_config.rs` 常量 · `chat.rs`/`backend_ctrl.rs` 内联字面量；另纳入 `app/.env.example` 示例值。**方案②**（由 `GET /v1/app/info` 暴露端点/事件名给前端消费）**未采纳**：B1 的消费者含**构建期**（vite/playwright），运行时取值覆盖不到。**顺带更正**：`backendUrl.ts` 注释原写「与后端 `main.ts` 保持一致」**指错真源**（`main.ts` 只是读取方）⇒ 改为指向 `core/ports.ts`。**验证**：**5 pass / 0 fail**；**红向已实证**（把前端常量临时改为 `18991` ⇒ ②③ **变红**并精确报出「取到 18991 ≠ 真源 18990」，其余用例保持绿 ⇒ 精确命中改动侧）；`typecheck` 0 错；`eslint` 0 问题。**如实边界**：本片为**源码守卫**性质（无运行时端到端）⇒ `e2eVerified=false`；`_check_api.cjs`（根目录一次性调试脚本）**有意未纳入**；Tauri 两处内联字面量**未做 Rust 重构**（仅纳入同值断言防漂移）；B3（模型能力标签集）/B4（错误码）**不在本片**。证据 `HARDCODE-HDP0-3-CROSS-CONTRACT`。
- ✅ **硬编码治理 HD-P1-3（A5）：工作区级 `.liri` 名单一真源 + 删除零消费者假真源 `CONFIG_DIR_NAME`** - **取证（CD01–CD04）推翻了方案原定性**：原把 `<workspace>/.liri` 与 `~/.pyapp` 当作**同一事实源的双名**，并据此把本片升为**高风险「断电安全迁移事务」**。实测二者**不同层** —— `.liri` 是**工作区级**（用户**项目内**、随项目走：`config.json`/`rules.md`/`knowledge.json`/`tools.json`/`memory.json` + `workflows`·`agents`·`projects`·`teams`·`memory` 子目录），`~/.pyapp` 是**用户级根**（第三层）⇒ **不可合并/改名**；而与之同层的历史 `~/.liri` **已无活动代码引用**（全仓仅开发探针脚本提及；`core/paths.ts` 注释记载 2026-08-18 一次性迁移**已完成**）⇒ **迁移事务没有对象**（为不存在的搬迁造框架属为假问题开工）。**落地（按取证后范围）**：① 工作区级 `.liri` 名**收敛为单一真源** `core/paths.ts` 的 `WORKSPACE_CONFIG_DIR_NAME`（含**层级区分**文档），消费方 **5 处**全部改引用（`LiriConfigManager` 两处各自写死 + `RuleEngine` + `team-handlers`，并删除其**模块私有未导出**的 `LIRI_DIR`）；② 删除 `constants/common.ts` 的**零消费者**假真源 `CONFIG_DIR_NAME`（按 CD05/CD06）；③ `~/.liri` 残留（探针脚本）**登记不改**；④ `com.liri.client`（Tauri **bundle id**）与 `.liri.lock`（单实例锁**文件名**）写入方案 §5 `N8`/`N9` **不治理**（不同事实源；后者改名会造成**跨版本互锁窗口**）。**验证**：新增 `tests/workspace/workspaceConfigDirSingleSource.test.ts` **4 例**（含"生产代码内字面量仅存于真源"与"用户级根未受影响"）⇒ **4 pass / 0 fail**；**红向已实证**（改回字面量 ⇒ ② **精确报 `team-handlers.ts:29`**、④ 同时报"仍从 `@modules/core` 之外引入"）；回归 `tests/{workspace,http,core,constants}` **437 pass / 0 fail（54 文件）**；`typecheck` 0 错；`lint:arch` **0 error**；`eslint` 0 问题。**如实边界**：**源码守卫 + 同值收敛**性质 ⇒ `e2eVerified=false`；**未改名任何目录/文件** ⇒ 对既有用户项目**零影响**；方案 §4.1/§5/§7.2/§7.3.2 已同步更正。证据 `HARDCODE-HDP1-3-LIRI-SINGLE-SOURCE`。
- ✅ **硬编码治理 HD-P1-1（A7）：产品 User-Agent 单一真源（15 站点 → 1 处；版本号随 `APP_VERSION`）** - **问题（取证）**：全仓 `User-Agent` 头散落 **15 个站点**，版本号互不一致（`Liri/1.0.0` · `Liri/1.0` · `Liri/2.0` · `Liri-Updater/1.0.0` · `Liri-MCPMarketplace/1.0`×3），甚至残留**旧品牌名** `PY_APP-Knowledge/1.0`；而 `constants/common.ts` 里的 `USER_AGENT = 'Liri/1.0.0'` **零消费者**（又一个**假真源**，同 `Q-H2` 的 `DEFAULT_LOCALE`、`HD-P1-3` 的 `CONFIG_DIR_NAME`）。**做法（同值收敛 + 版本号单一来源）**：真源改为 `USER_AGENT = \`${APP_NAME}/${APP_VERSION}\``（`APP_VERSION` 原已是真源，读 `app/package.json`）+ 新增 `buildUserAgent(purpose)` ⇒ `Liri/<版本> (<用途>)`；**14 个消费点**全部改引用（含把 `tools/WebFetchTool/utils.ts` 的既有本地 `buildUserAgent()` 保留原名与签名、内部改用**别名导入**，避免同名冲突）；旧品牌名一并纠正。**有意"不治理"**（新增方案 §5 `N10`/`N11`）：抓 HTML 的 **Chrome 伪装 UA**、edge-tts 的 **Chromium 版本**（协议前置条件，并入即打不通第三方）；**新发现** MCP 服务器**协议标识**（`name: 'Liri/memory'`/`'Liri/mcp'` + `version: '1.0.0'`）属**不同事实源**（协议面行为变更需单独裁定）⇒ 反向钉住不动。**验证**：新增 `tests/constants/userAgentSingleSource.test.ts` **6 例**（真源 / 派生器 / `User-Agent` 头值不得是产品 UA 字面量 / 协议伪装 UA 按站点原样 / 14 消费点用法检查（排除 import 行）/ MCP 标识未被误并）⇒ **6 pass / 0 fail**；**红向已实证**（改回 `'Liri/1.0.0'` ⇒ ③ 精确报 `services/api/client.ts:41`）；**全量 app 6364 pass / 42 skip / 1 fail（预存，见下条）**；**client 565/565**；`typecheck` 0 错；`lint:arch` **0 error**；`eslint` 15 文件 0 问题。**如实边界**：**UA 取值有意改变**（统一为 `Liri/<真实版本> (<用途>)`）⇒ 属**线上可观测面变化**（第三方若按旧串做白名单需同步，已登记）；源码守卫性质 ⇒ `e2eVerified=false`。证据 `HARDCODE-HDP1-1-UA-SINGLE-SOURCE`。
- ✅ **硬编码治理 HD-P2-2（优先项）：`formatRelativeTime` 文案入 i18n + 时间/日期格式随语言** - **问题**：`client/src/utils/format.ts` 的 `formatRelativeTime()` 把**文案**（`"昨天"` / `` `${n}天前` ``）与**区域格式**（`toLocaleTimeString("zh-CN")` / `toLocaleDateString("zh-CN")`）一并写死 ⇒ **英文界面下既显示中文、又用中文日期格式**（该函数渲染在会话列表/消息时间等用户可见位）。**做法**：新增 i18n 键 `common.timeYesterday` / `common.timeDaysAgo`（zh `昨天` / `{{days}}天前`；en `Yesterday` / `{{days}} days ago`，用 `{{days}}` 插值**避开 i18next 复数形态差异**）+ 局部纯函数 `currentLocale()`（`zh*`→`zh-CN`、`en*`→`en-US`）；工具函数不能用 hook ⇒ 直接引 i18n 实例。**验证**：新增 `client/src/utils/__tests__/format.test.ts` **4 例**（zh 三种形态 / **en 三次采样均不含中文** / 日期区域格式随语言 / **源码守卫**：函数体内不得有中文与 `zh-CN`）⇒ **4 pass / 0 fail**；**client 全量 565/565（67 文件）**（含 i18n key parity ⇒ zh/en 双侧齐备）。**口径更正（重要）**：方案写「前端内联文案 **16 处 / 7 文件**」，本片只读扫描 `client/src` 实测主清单 **≈120 处 / ≈40 文件**（另 ≈35 处"边界项"、约 10 组"数据表"）⇒ **剩余体量是原估的 ~7 倍**，已在方案 §7.2 更正计数，**是否全量推进待裁定**（本片只落方案明示的优先项）。**如实边界**：未在真机 UI 切 `en` 观察 ⇒ `e2eVerified=false`；其余 ≈120 处未动。证据 `HARDCODE-HDP2-2-FORMAT-I18N`。
- ✅ **修复预存红：`lint:arch` 门禁自证夹具补齐 `R09-006` 前置（全量套件恢复绿）** - **现象**：`bun test` 全量唯一失败为 `gateSelfProof.test.ts:147`「【合法样例】同层自依赖 ⇒ 通过（退出 0）」（期望 0 实得 1）。**根因（取证）**：`R09-006`（**状态机定义必须登记**，由 `2b32941a6`【状态机规范管理 阶段 1-4】引入，2026-10-13）要求**项目内**存在定义目录 `app/src/state/engine/stateMachineCatalog.ts` 并经 `file://` **动态 import**；而门禁自证用的**极简夹具**只有 `app/src/core/probe.ts` 一行、**未随之更新** ⇒ 该夹具跑门禁必命中 `❌ R09-006`（ERROR ⇒ 退出 1）。**修法（最小且方向正确）**：在夹具 `beforeAll` 里补出该定义目录（**零依赖纯数据** `STATE_MACHINES = []` + `BOUNDARY_STATE_MACHINES = []`；夹具内无状态机候选 ⇒ 空登记即满足完整性）——**夹具必须满足门禁前置**，否则它验的不是"合法性"而是"缺文件"；**未改任何产品代码、未放宽门禁语义**（`scripts/lint-architecture.ts` 一字未动）。**验证**：该用例 **14 pass / 0 fail**（原本恒红那条现为 pass）；**全量 `bun test` = 6365 pass / 42 skip / 0 fail（726 文件）**；`lint:fix-evidence` **149 条绿**。证据 `GATE-SELFPROOF-R09006-FIXTURE`。

#### v0.4.99 (2026-10-13)
MCP 安全：MCP 工具结果凭据脱敏一致性修复（G-1）+ Stdio 子进程显式 env 审计收紧（G-2）

- ✅ **MCP 工具结果凭据脱敏一致性修复（G-1）** - `mcp__*` 工具的**模型可见路径** `McpToolWrapper.execute` 原**直接回传未脱敏文本**（带脱敏的 `MCPServerManager.callTool` 仅被 CLI（`cli/mcpCommand.ts`）调用 ⇒ 两路径脱敏不一致），远端 MCP server 回传的 API key / token 可原样进入模型上下文；现于返回前统一套 `filterMCPToolResult`（文本输出）+ 新增 `redactMcpPayload`（结构化 `data` 的 JSON 往返脱敏），并把 `MCPServerManager` 的内联 JSON 脱敏**收敛到同一 helper**（CS01，单一实现，勿再各写一份）。同批核查确认 **`sessionId` 不外传**：wrapper 只发 `{name, arguments}` + `{signal}`，`MCPTool` 的 `context.sessionId` 仅用于本地会话级 dispose scope
- ✅ **Stdio 子进程显式 env 审计收紧（G-2）** - `StdioTransport` 原构造 `{ ...buildSafeEnv(Object.keys(options.env)), ...options.env }` 把**显式配置键**喂给 `buildSafeEnv()` ⇒ 命中 `BLOCKED_ENV_PATTERNS` 时发出 `mcp:env_blocked` 告警，却又被尾部展开 `...options.env` **原样透传**（语义自相矛盾：声称已拦、实际放行）；现**分离**两条来源：宿主只取白名单基线 `buildSafeEnv()`，显式配置经新增 `auditExplicitEnv()` **审计后合并**（按设计放行 MCP server 自身凭据、**不按名硬拦**以免破坏正常接入；命中敏感名 ⇒ `mcp:explicit_env_sensitive`；值与同名宿主变量一致 ⇒ `mcp:explicit_env_value_from_host` 高信号告警；**告警只含键名、绝不含值**）
- ✅ **回归与证据登记** - 新增 `app/tests/mcp/mcpResultRedaction.test.ts`（**7 例**：文本脱敏 / 结构化 `data` 脱敏 / 无密钥零变更 / `redactMcpPayload` 单元 / `stripCredentials` 基线 / `auditExplicitEnv` 放行 / Stdio env 分离）；`bun test tests/mcp/` **21 pass / 0 fail**（15 skip 为需真实 server 的 e2e）；`lint:arch` 违规 **0**（4 基线警告，未增）；`fix-evidence-registry.json` + `修复证据登记.md` 新增 `MCP-SEC-G1` / `MCP-SEC-G2`（`lint:fix-evidence` 条目 **85 → 87** 自洽；`fixEvidenceGate` **7 pass / 0 fail**）
- ℹ️ **边界（如实）** - 上述两条 `e2eVerified=false`（未接真实外部 MCP server 做端到端脱敏验证，已入 `修复证据登记.md` §2）；`postReleaseReviewed` 仍为 `false`（待正式发版 + tag 后按 `.trae/rules/versioning.md` 判据置位）；**未翻转** `OUTPUT_GUARD`（仍默认关）；未改 MCP 协议 / 传输契约

#### v0.4.98 (2026-10-13)
工具治理：阶段 1（契约与安全收口）+ 阶段 2.1（重型工具盘点）

- ✅ **TG-1 `capabilityDigest` 归属边界登记** - 裁断「**保持独立、严禁并入工具契约**」：`capabilityDigest` 是「特定会话 + 精确命令语义」的**执行授权指纹**（**权限域** `permission/`），与描述工具**静态固有属性**的 `ToolCapabilityDescriptor`（**能力域** `utils/toolContract/`）语义正交 ⇒ 在 `Tool.ts` 与 `ApprovedCommandRegistry.ts` 各加**双向边界守护注释**，防「看着像就合并」（CS01 / R02-002）。**如实**：原方案拟登记 R02-002 排除表，实测该规则只扫描**导出符号**、不扫描 interface 字段 ⇒ **无需**该登记
- ✅ **TG-5 工具 Schema 熵阈值告警（第 20 轮后 >30%，只告警不阻断）** - `ToolMetrics` 新增**纯函数** `evaluateSchemaEntropyGate()`（阈值常量 `SCHEMA_ENTROPY_TURN_THRESHOLD=20` / `SCHEMA_ENTROPY_PERCENT_THRESHOLD=30`；缺 `turn`/上下文窗口 ⇒ `null`，不臆造，CS06）+ `recordToolSchemaEntropy` 在 `warn` 时发 `logger.warn('tools:schema.entropy_high', ...)`；`ToolSchemaEntropyMetric` 增可选 `turn`，调用点 `selectAndObserveToolDefinitions` 传 `turn: host.toolRoundCount + 1`（**复用既有 `host` 机位、不改** `streamMessageFlow` ⇒ 不触 `lint:fn-size` 棘轮）。**不改指标名**（`tools.schema.*`）、**零阻断**（Fail-Open for Observation）
- 🔶 **TG-2/TG-6 现状（如实）** - ① **取消下传已满足**（S2-2/G15 早已落地，`tests/tools/toolCancellation.test.ts` 覆盖）；② **侧车异步挂起阻塞**于 `.trae/specs/long-task-suspend-resume.md`（未实现）⇒ 待其落地后再接可选 `ISnapshotCapable` 契约（不建无消费者空抽象，CS03）
- ✅ **回归与证据登记** - `tests/tools/toolMetrics.test.ts` **+6 例**（阈值常量 / 达标告警 / 轮次不足 / 30% 边界 / 缺参 `null` / 触发不抛且 gauge 照写）；`fix-evidence-registry.json` + `修复证据登记.md` 新增 `TOOLGOV-TG1` / `TOOLGOV-TG5`（`lint:fix-evidence` 条目 **87 → 89** 自洽）
- ✅ **阶段 2.1 重型工具盘点（零代码改动）** - 落盘 `dev_docs/20261012/重型工具侧车化-盘点清单-20261012.md`（22 项工具 × 依赖 / 进程边界 / 常驻 / 崩溃面 / 默认注册，逐条 `file:line` 取证）。**实测推翻原靶点假设**：① `image_generate`/`video_generate` 主体是**远端 Provider HTTP**（无 in-process 崩溃面）；② `lsp` **本就 `spawn` 外部 language server**（`tools/lsp/LSPServer.ts:68`）⇒ 侧车化收益是**常驻化**（消 `npx` 冷启动 + 补请求超时），非"防崩溃"；③ **唯一真 in-process FFI = `liri-native`**（`bun:ffi` dlopen、模块级常驻），但被 **11 处高频基础路径**（文件读写/安全/压缩/计数）懒 `require` ⇒ **不建议**侧车化（RPC 往返劣化热路径），宜降级兜底；④ 真"内存大 + native"靶点 = **`sharp`(libvips) + Python `vision_worker`**（已常驻、载 OCR/YOLO/SAM/MiDaS）。**靶点重排（P1 常驻 LSP / P2 媒体原生面）待裁定**（阻塞 2.2）
- ✅ **阶段 2 靶点裁定（采纳重排）** - 用户裁定：**采纳靶点重排**（**P1 = 常驻 LSP 侧车**；**P2 = 媒体原生面**（`sharp` + Python `vision_worker`））；**`liri-native` 纳入侧车评估**（须量化证据，不以 CS03 空谈否）；**LSP 双轨先收敛再侧车**。⚠️ **新发现硬依赖**：工具侧车需**通用 IPC 基座** = D10 的 **P1（未落地）**（D10 P0 已于 2026-10-10 完成）⇒ 2.2 **不得先写第二套桥**（D10 GR02「禁止第三套 IPC」）。证据 `TOOLGOV-SIDECAR-TARGETS`（`lint:fix-evidence` 条目 **89 → 90** 自洽）
- ✅ **阶段 2 前置小修：工具 LSP 客户端请求超时兜底** - `tools/lsp/LSPClient.sendRequest` 原**无超时** ⇒ 服务器既不响应也不退出时 Promise **永不 settle**（`pendingRequests` 泄漏）⇒ 工具调用挂起；现新增 `LSP_REQUEST_TIMEOUT_MS=30_000`（口径对齐 `@modules/lsp`），`sendRequest` 超时即 `delete` pending 并 reject、响应到达 `clearTimeout`，`shutdown()` 关闭握手改 **best-effort**（超时不阻断 `stop()`/回收），构造函数新增可选 `requestTimeoutMs`（默认 30s，仅测试注入短值）。测试 `tests/tools/lspRequestTimeout.test.ts` **3 例**（桩打 `LSPServer.start/send`，离线确定）。证据 `TOOLGOV-LSP-TIMEOUT`
- ✅ **阶段 2 顺带修复：`lsp` 工具在 bun 下起不来** - 实测 `bun -e "…spawn…typeof p.stdin.setEncoding"` ⇒ **`object undefined`**（bun 的 child_process 流**仅 stdout/stderr** 提供 `setEncoding`；另测 `stdout.setEncoding('utf8')` 生效、`data` 为 string）；而 `tools/lsp/LSPServer.start()`（`:81-83`）**对 `stdin` 也调 `setEncoding`** ⇒ 抛 `setEncoding is not a function` ⇒ `status=ERROR` ⇒ 工具不可用（默认关 `LSP=false`、**无测试** ⇒ 长期潜伏）。**已修**：移除对 `stdin` 的 `setEncoding`（stdin 仅用于写入 `send()`），保留 stdout/stderr。测试 `tests/tools/lspServerBunStdio.test.ts` **2 例**（真实子进程夹具 `tests/tools/fixtures/fakeLspServer.js` 按 LSP 帧回包）：`start()` 不抛且 `RUNNING`；`send()` + `handleOutput` 帧解析**端到端**。证据 `TOOLGOV-LSP-BUN-STDIO`
- ✅ **阶段 3.1 复核 + 阶段 4.1/4.2 文档收口（低风险）** - ① **3.1**：D7 双轨排他断言复核绿（`tests/tools/toolNameLists.test.ts` **24 pass / 0 fail**；`VFS_ENABLED` 默认 false、`stat_vfs` 无条件注册，口径无漂移）。② **4.1**：修正 `README.md` 三处**当前口径**计数 `73 → 75`（`:12/:158/:379`；事实源 `TOOL_NAMES_COUNT=75`，`gen:toolnames` 复跑**零漂移**）；**历史记录按原样保留**（`ai-vfs-*.md` / `README:446` 的旧数字为**当时史实**）。③ **4.2**：移除 `README.md:156` 引用的**不存在**类名 `CheckpointManager`；`app/docs/` 复扫无旧计数/幻觉符号
- ✅ **测试守卫可靠性修复（既有 flaky，非本次引入）** - `tests/tools/toolRegistrySingleSource.test.ts` 的「工具注册表单一写入口」守卫在**整批并发**下首例 **5776ms > 5000ms** 默认超时假红（单文件静置 1.35s 通过）。**根因**：`findRegistrySites()` 每次调用都**全仓扫 `src/**`（~3900 个 .ts/.tsx）并读取全部文件内容**，而**三个 `it` 各扫一次（3×）**。**修复（根因优先）**：改**惰性进程内缓存**（三断言共用一次扫描）+ **快速预筛**（`content.includes('ToolRegistry(')` 不含即跳过，免全量 `split`）+ 三断言**显式 30s 超时**兜底。**验证**：单文件首扫 **5776ms → 2802ms**、另两例 ~0.1ms；整批 `bun test tests/tools/` **747/1 → 748/0**，批内耗时 **49.7s → 32.5s**。证据 `TEST-GUARD-TOOLREGISTRY-FLAKY`
- ℹ️ **质量（阶段 1 切片）** - `lint:arch` 违规 **0**（4 基线警告未增）· `lint:tool-schema` **0 ERROR** · `lint:fn-size` / `lint:complexity` **未增长** · `bun test tests/tools/toolMetrics.test.ts` **10 pass / 0 fail**

#### v0.4.97 (2026-10-13)
通道治理：阶段 0（文档漂移纠正）+ 阶段 1.1 / 1.2（出站收口）

- ✅ **阶段 0：文档-代码漂移纠正（零代码）** - 订正四处「文档描述不存在之物」：① `app/docs/核心模块/gateway.md` 整篇描述**已移除**的 `core/gateway/`（2026-08-06 下线）⇒ 重写为**真实承载**（`ChannelRegistry`/`ChannelBootstrapper`/`routeChannelMessage`/`DeliveryRouter`/`channelEventBus`/`DevicePairingService` + 入站管线 + HTTP 面 `18990`）；② `app/docs/渠道/web.md` ⇒ 「Web/HTTP 接入（**非通道**）」（无 `web` 通道；`WEB_CHANNEL_ENABLED`/`/api/chat`/`PORT=3000` 均不存在）；③ `app/docs/渠道/channel-routing.md` ⇒ 「出站投递」并**显式列出未实现项**（条件路由 / 负载均衡 / `channelRouter`）；④ `.trae/rules/project_rules.md §1.14` **三处**订正（`core/gateway/` 已移除、注册入口改 `channelBootstrapper`、`ChannelManager`/`GatewaySetup`/`GatewayTool` **无实体**）；另同步 `渠道/index.md` 两处条目。证据 `CHANGOV-DOC-DRIFT`
- ✅ **阶段 1.1：出站长文本分片全覆盖** - `telegram`（`sendTextMessage`/`sendMarkdownMessage`）与 `qq`（`sendTextMessage`）**去 `slice(0, maxMessageLength)` 截断** ⇒ 改用共享分片器 `splitMessage()`（结构感知、保代码围栏成对）**逐片发送**，任一片失败即止（与 Discord 一致）。**Telegram** 先按**原始**内容分片再逐片 `escapeHtml`（不切坏 HTML 实体/围栏）；**QQ** 被动回复字段**每片各消费一次**（`msg_seq` 递增、超窗/超 seq 上限自动降级主动消息）。测试：新增 `tests/channels/channelTruncationGuard.test.ts`（全 `src/channels/**` **反截断源码扫描** + 扫描面自证）；`bun test tests/channels/` **306 pass / 0 fail**。证据 `CHANGOV-SPLIT-COVERAGE`
- ✅ **阶段 1.2：降级链声明驱动** - `channels/deliveryFormatters.ts` 新增**纯函数** `resolveDeliveryFallbacks(from, support)` + 类型 `DeliveryFormatSupport`；`channels/DeliveryRouter.ts` 新增 `_formatSupport(channel)`（由 `plugin.capabilities.interactive` / `plugin.meta.markdownCapable` 派生）并把支持位透传降级递归 ⇒ 通道**明确声明不支持**的格式**直接跳过**（少一次注定失败的往返）。**零行为变更保证**：未声明 ⇒ 一律视为支持 ⇒ 与既有逐级尝试**等价**。测试 `tests/channels/deliveryFallbackChain.test.ts` **6 例**。证据 `CHANGOV-FALLBACK-DECLARED`
- ✅ **阶段 1.3：附件字节 → 日预算预留（防富媒体绕过硬闸门）** - 新增**纯模块** `query/attachmentBudget.ts`（`estimateAttachmentTokens` / `estimateAttachmentsTokens`；口径 `ceil(bytes/4)` **保守下限**，缺 `size`/非法值 ⇒ 0，不臆造 CS06）；`chat/orchestrator/preSendContextProtection.ts` 在 `checkDailyBudget()` / `reserveFor()` **之前**并入 `reservedTokens = msgTokens + attachmentTokens`，告警日志增 `attachmentTokens`。测试 `tests/query/attachmentBudget.test.ts` **5 例**。⚠️ **订正（2026-10-12 收口，如实）**：本条原称"生产者 = 会话 DTO `SendMessageOptions.attachments`，**真实存在**" —— **该断言不成立**（该字段全仓不存在；且读取在运行期恒为 `undefined`）⇒ 已订正为 `options.images` 并修复 3 处 typecheck 回归，见下方 `CHANGOV-TYPECHECK-1323`。**如实**：DTO 统一（本阶段首句）**未做** —— `channels/types/IChannel.ts:86` 与 `session/types/message/enums.ts:132` 各有一个**同名不同物** `MessageAttachment`，合并属**跨层重构**。证据 `CHANGOV-ATTACHMENT-BUDGET`
- ✅ **阶段 1.4：出站重连退避重试** - `channels/DeliveryRouter.ts` 新增 `reconnectWithBackoff()` + `CHANNEL_RECONNECT_RETRY`（2 次 / 150ms 起 / 上限 1s），**复用项目标准重试** `utils/withRetry`（内含指数退避 **+ 0–30% jitter**，CS01 不另写退避）；`_prepareChannel` 改用之 ⇒ 重连**有界退避重试**，**失败只影响本次投递**（不回退主任务状态）。契约测试 D6b 同步更新（文案前缀匹配 + 新增 `connectCalls===3`）。测试 `tests/channels/reconnectBackoff.test.ts` **4 例**。证据 `CHANGOV-OUTBOUND-BACKOFF`
- ✅ **阶段 1.3 · DTO 归属裁定** - 两个**同名不同物** `MessageAttachment`（`channels/types/IChannel.ts:86` **协议层** vs `session/types/message/enums.ts:132` **会话领域模型**）⇒ 裁定 **保持独立、严禁合并与断言互换**（对齐 `enums.ts:130` 既有 `DataAttachment` 判例「协议/存储向 ≠ 领域模型，勿直接互换」）；跨层**必须写显式适配函数**（`fileId→id`/`fileName→name`/`mimeType→contentType` + 补 `type`）。落地 = 两处类型加**双向边界注释**（零行为变更）。证据 `CHANGOV-DTO-OWNERSHIP`
- ✅ **阶段 2.1：出站网关端口化（Port Layer Only）** - core 侧新增 `core/spi/GatewayService.ts`（`IOutboundGatewayPort` + DTO `GatewayContentDto`/`GatewayDeliveryResultDto`/`GatewayBroadcastResultDto`；`resolveOutboundGateway()` **空操作代理** + `registerOutboundGatewaySpi()` 推送注册），`core/spi/index.ts` 转出；service 侧新增 `channels/gateway/OutboundGatewayPortAdapter`（**只做形状搬运**、委托 `getDeliveryRouter()`，构造期无副作用、`delegates` 可注入）；组合根 `entrypoints/spiWiring.ts` 装配。**零新增能力**（降级链/串行锁/退避重连仍归 `DeliveryRouter`）；未注册时以**失败结果**作答（**不伪造成功**）；**UW 预留端口**（生产中暂无消费者）。测试 `tests/channels/outboundGatewayPort.test.ts` **2 例**。证据 `CHANGOV-GATEWAY-PORT`
- ✅ **阶段 2.4：入站 DTO 标准化 + 入站网关端口（UW 预留）** - `channels/routing/messageRouterContract.ts` 新增**标准化入站信封** `InboundEnvelope` + `InboundAttachmentDto` + **纯函数** `toInboundEnvelope()`（`MessageContext` → 标准化信封；`sessionId` 入站未定 ⇒ **省略不臆造**；媒体/语音/事件**统一归 `file`**；附件 `mimeType→type`/`fileName→name`/保留 `url`/`size`；无附件 ⇒ 键省略）。core 侧新增 `core/spi/InboundGatewayService.ts`（`IInboundGatewayPort` + `resolveInboundGateway()` **未注册裁决** + `registerInboundGatewaySpi()`），`core/spi/index.ts` 转出；service 侧新增 `channels/gateway/InboundGatewayPortAdapter`（**纯形状搬运**、**必须注入** `route` 委托）。**真实注册点 = `setupChannels`**（`coreAPI`+回调在彼处组装）⇒ 本期**不注册**；**刻意不做默认委托**（凭空构造无 `coreAPI` 的路由 = 伪造能力）；未注册时以 `accepted:false` 作答（**不伪造接受**）。测试 `tests/channels/inboundGateway.test.ts` **5 例**。证据 `CHANGOV-INBOUND-DTO-PORT`
- ✅ **阶段 1.2/1.3 收口：修复 3 处 typecheck 回归（编译期门禁前置）** - 回仓实测 `bunx tsc --noEmit` 报 **3 处 TS2339**（`DeliveryRouter.ts:478/479` 的 `plugin.capabilities.interactive` / `plugin.meta.markdownCapable`；`preSendContextProtection.ts:194` 的 `options.attachments`），根因两处：① `ChannelInterface.plugin` 在 `ChannelRegistry.ts` **声明只有 `{ outbound }`**、且 `adaptPluginToInterface` **运行时也只装配 `outbound`** ⇒ 阶段 1.2 读的 `capabilities`/`meta` 既无类型也无值（值本就存在于 `IChannelPlugin.capabilities` / `.meta`）⇒ **补声明 + 原样透传装配**（不新增字段、不复制、不派生）；② 阶段 1.3 声称的「会话 DTO `StreamMessageOptions.attachments`」**全仓不存在**（`options.ts:178` 无该字段；`:266` 的 `attachments` 属 `CreateMessageParams`）⇒ 原注释属**未取证断言**、读取运行期恒为 `undefined`（inert）⇒ **口径订正为 `options.images`**（前端 → `ChatRequest.images` `CoreAPI.ts:81` → `CoreAPIImpl.chatStream:626`，是**唯一**贯通且携带 `size` 的入参；图片字节**不进** `apiMessages`，`StreamPipeline.registerImages()` 只追加「图片路径文本」⇒ 其开销确实不计入 `msgTokens`，**非重复计数**）。**验证**：`tsc --noEmit` / `typecheck:scripts` / `typecheck:root-scripts` **三工程全绿**；`bun test tests/state tests/channels tests/query` **678 pass / 0 fail**。ℹ️ **未接线（如实）**：**通道侧**入站附件（`MessageContext.attachments`）仍未经 `routeChannelMessage` 透传到 `chatStream`（`messageRouter.ts:512` 无附件字段）⇒ 该路径仍在日预算闸门之外，且通道侧与会话侧 `MessageAttachment` 同名不同物（禁断言互换）⇒ 须经 DTO 形状搬运（阶段 2.4）后再接线（已写入 `query/attachmentBudget.ts` 头注）。证据 `CHANGOV-TYPECHECK-1323`
- ⬜ **未做（如实）**：阶段 2.3（出站 SSE 订阅面，裁定**暂缓**）、**入站 `PREPARED` 接缝**（状态转移可观测 —— 依赖状态机方案的 PREPARED 落盘能力，随第三方案推进）、阶段 3（进程隔离，**已推迟**）；八条通道路径条目均 `e2eVerified=false`（未接真实平台端到端）

#### v0.4.96 (2026-10-13)
状态机规范管理：阶段 1（定义目录 → 取值取证 → 登记硬门禁）

- ✅ **阶段 1：状态机定义目录（`StateMachineCatalog`）** - **方案订正（重要）**：`state/engine/StateMachineRegistry.ts` 实为**运行时实例**注册表（按 id 存实例 / `gc` / `find`），**不是**定义目录 ⇒ 原表述「把状态机接入 `StateMachineRegistry`」属**类别错误**，订正为「登记到**定义目录**」。新增 `state/engine/stateMachineCatalog.ts`（**零依赖纯数据 + 只读查询**，避免 `core←service` 倒挂）；首版先落 Execution / ToolCall 两条（取值逐项与源码枚举核对），余项以显式占位登记 —— **占位部分已由下一条（1.3 取证）全部取代**。**零语义变更**（不动任何域枚举/转移）。证据 `FSM-CATALOG-P1`
- ✅ **阶段 1.3：状态取值取证完成（12 条全部登记）** - 9 台机器 + `SimplifiedSessionState` **全部取证**迁入 `STATE_MACHINES`（取值 + `sourceFile` + `verification` 口径）。其中 **5 条有运行时锚点**（`EXECUTION_STATUSES` / `TOOL_CALL_STATUSES` / `AppState` / `SessionState` / `TaskStatus`）⇒ 测试**动态载入逐项比对**（防漂移，实测全等）；其余 **7 条**仅有类型联合或内联字面量 ⇒ **源码阅读取证**并**如实标注** `source-read`（不谎称有机器校验）。另新增 `BOUNDARY_STATE_MACHINES` **4 条同名不同物登记**（UI `TaskStatus` 词汇表 / `session/models` 类 / `GoalRunSettlement` / `AcpApprovalClass`，各附不合并理由）。测试 `tests/state/stateMachineCatalog.test.ts` **6 例**。证据 `FSM-CATALOG-P1`
- ✅ **阶段 1.3 配套：消除取证暴露的 3 项隐患** - ① 应用安装状态抽出 `export type AppInstallStatus`（消除 `appState/AppState.ts:253`/`:259` **两处内联字面量重复**）；② `awaiting_approval` 抽出常量 `TRANSIENT_AWAITING_APPROVAL`（原 `ToolExecutionService.ts:638/962` 裸字面量），`requires_approval` 裸比较改 **`ToolExecutionStatus.REQUIRES_APPROVAL` 枚举成员**（**不复制字面量**，守住「数出同源」）；③ `BudgetMode` 去 `DailyBudgetManager` 本地重声明 ⇒ **单一事实源** = `dailyBudgetSnapshot.ts`。新增**源码守卫** `tests/state/stateMachineHygiene.test.ts`（**3 例计数断言**，防回流；初版误用 `not.toContain` 自测失败 ⇒ 改计数后通过）。回归 `tests/state/ tests/query tests/chat` **747 pass / 0 fail**。证据 `FSM-CATALOG-HYGIENE`
- ✅ **阶段 1.4：状态机登记硬门禁（未登记 ⇒ 阻断构建）** - `scripts/lint-architecture.ts` 新增 `checkStateMachineRegistration()`（接入 `runAll`），规则 **R09-006（error）**：`app/src/**`（排除测试）中的 ① `export enum *Status|*State` ② `export const *_STATUSES|*_STATES = [ … ]`（含 `new Set([ … ])`）必须**要么**在定义目录 `state/engine/stateMachineCatalog.ts` 登记（`verifyRef` 精确锚点 **5 条** / `sourceFile` 文件级：`STATE_MACHINES` + `BOUNDARY_STATE_MACHINES`），**要么**在新建的显式豁免清单 `scripts/state-machine-allowlist.json`（**44 条，每条附 `reason`**）登记。**实测**：首次扫描 **候选 54 / 未登记 47** ⇒ 补 `sourceFile` 文件级豁免后 **44** ⇒ 落清单后 **候选 54 / 已登记 54 / 未登记 0**，`lint:arch` **错误 0**（4 基线警告未增）。**负向自证**：临时注入探针文件（`export enum ScratchProbeStatus` + `export const SCRATCH_PROBE_STATUSES`）⇒ 报 **2 条 error、退出码 1**（构建阻断），删除后复绿；**fail-closed 实测**：临时移走豁免清单 ⇒ 报「豁免清单缺失」error（退出码 1）。⚠️ **局限（如实，已写入规则与 docstring）**：仅识别 enum / `as const`(Set) 数组两类**有运行时锚点**形态；`type X = 'a' | 'b'` 类型联合与内联字面量**不在**范围（全仓逾 150 处，逐一豁免即噪音门禁，必无人维护）⇒ 由目录的 `source-read` 条目 + `stateMachineCatalog.test.ts` 人工取证覆盖（**只漏报、不误报**）。测试 `tests/state/stateMachineRegistrationGate.test.ts` **4 例**（非空且带 reason / 文件存在且确实导出该符号=**防陈旧豁免** / 键唯一 / 与目录锚点**不重叠**）；规则条文 `.trae/rules/architecture-compliance.md` 新增 **R09-006**（版本 1.6.0 → 1.6.1）。证据 `FSM-CATALOG-GATE14`
- ✅ **阶段 2：工具调用状态单一事实源（收敛 chunk/SSE 层 G14 分叉）** - **2.1 裁定**：① 工具调用状态的**唯一事实源** = `execution/types.ts` 的 `ToolCallStatus`（4 态，含恢复期 `unknown`）；`execution/index.ts` **补齐出口**（R03-002）—— 此前 `TOOL_CALL_*` 常量/类型**未**经模块出口暴露 ⇒ 消费者只能各自复写字面量（分叉根因）。② `ToolCallSpec.status`（HTTP 门面）与 `FrontendMessageBlock.toolCall.status`（前端消息块）**统一引用** `ToolCallStatus`（放宽含 `unknown` 属**零行为变更**：流式路径无该值生产者，生产者 = 恢复期回填）。③ **`SubAgentProgress.status` 裁定 ≠ 同一物**：属子 Agent 域，且 `utils` 为 **infra** 层、`allowedDependencies.infra = [infra, core]` ⇒ 引用 `execution`(**service**) 即**分层倒挂**（R00-001）⇒ 保持独立并加**边界注释**（对齐 `MessageAttachment` 判例）。**2.2 去裸值**：`execution/types.ts` 新增具名常量 `TOOL_CALL_COMPLETED_STATUS` / `TOOL_CALL_FAILED_STATUS`（对齐既有 `TOOL_CALL_INITIAL_STATUS` / `TOOL_CALL_UNKNOWN_STATUS` 的「避免裸字面量」先例）；`reactEventsToChunks.ts:92/130`、`chat-handlers.ts:873/1295`（两条 SSE 路径兜底）改引用常量；`CoreAPIImpl.ts:1001` **删除** `as { toolCall?: { status?: string } }` 结构断言（把状态类型降级为裸 `string` 的元凶——`chunk` 在该分支已收窄为 `ChatStreamChunk`）。**2.3 已随阶段 1.3 配套完成**（见 `FSM-CATALOG-HYGIENE`）。**验证**：新增源码守卫 `tests/state/toolCallStatusSingleSource.test.ts` **7 例**（出口暴露 / 两面引用同一类型 / chunk 层无裸值 / SSE 兜底常量 / 断言已删 / 子 Agent 不跨层）+ `tests/chat/reactEventsToChunks.test.ts` **+4 例**（常量取值锁 + `tool_start`/`tool_end(success)`/`tool_end(error)` 行为锁）；`lint:arch` **0 错**（R09-006 候选 **54 不变**）· `typecheck` **三工程全绿** · `lint:fn-size` / `lint:complexity` 未增长 · `bun test tests/state tests/chat tests/channels tests/query tests/session` **1496 pass / 0 fail**。⚠️ **零行为变更**（wire 取值 `running`/`completed`/`failed` 未变、无 DB / 无 wire 字段变更）；`e2eVerified=false`（未做真实浏览器长会话核对，如实标注）。证据 `FSM-TOOLSTATUS-P2`
- ✅ **阶段 3：会话状态机 8 态 → 3 态收敛（旧枚举删除 + 不可达兜底清理）** - **执行前取证（推翻方案前提，已报用户裁定）**：旧 8 态 `SessionState` **不是**遗留死码而是**活事实源**（`ChatManager:3184/3338` 的 `.start/.finish` · `ChatOrchestrator:754/1166` · **已接线**的 `SessionStateBridge`（`init.ts:479-490`）按 5 类生命周期事件驱动），而迁移目标 `SimplifiedSessionState` + `toSimplifiedState()` 经全仓取证**零生产消费者且未出口** ⇒ **用户裁定「按原文执行 8→3 合并」**（其信息降级代价已如实登记）。**落地**：`SESSION_TRANSITIONS` 重写为 3 态（`idle→running`；`running→idle/requires_action`；`requires_action→running/idle`，由旧表**逐边归并**）+ 折叠映射 `IDLE/COMPLETED/ARCHIVED/ABORTED→idle`、`RUNNING→running`、`REQUIRES_ACTION/PAUSED/ERROR→requires_action`（与 Phase 1 既定 `toSimplifiedState()` **逐值一致**）；**3 态下无终态**（`idle` 可再 `start()` ⇒ 成环，`isTerminal()` 恒 `false`）。**删除 3 类（均有取证）**：① 旧 8 态枚举本体（零消费者）；② `toSimplifiedState()`（8 态消失后**失输入类型**；且旧 8 态**不持久化**、`emitSessionStateChanged()` 零调用点 ⇒ 无迁移映射需求）；③ `SessionStateMachine.archive()`（3 态下 `ARCHIVED` 折叠为 `idle`、无独立目标，生产**零调用者**）。**CS03 清理**：`SessionStateBridge` 对 `complete()` 的 try/catch + `handleError` 导入**已删除** —— `complete()` 目标为 `idle`，3 态下**三者到 `idle` 均为合法边或幂等**且引擎内部已捕获钩子/监听器异常 ⇒ 该 catch **不可达**（原注释「忽略非 RUNNING 状态下 complete 失败」已失效）。⚠️ **同目标再触发不新增异常面（已证）**：引擎对 `from === to` **早返回 `true`**（`StateMachine.ts:188-194`）⇒ 折叠后「已在 `requires_action` 再 `pause()`/`error()`」为**幂等无操作**（旧 8 态表本就允许 `REQUIRES_ACTION→PAUSED/ERROR`）。**目录同步**：`sessionState` 条目改写为 3 态、运行时锚点由 enum 改为**转移表键**（新增 `anchor: 'objectKeys'` 变体）、`sessionStateSimplified` 并入；`BOUNDARY_STATE_MACHINES#sessionModelClass` 理由更新（**阶段 3 已处置：保持独立** —— 其 8 值词汇表用于**接受既有持久化值**，**只可放宽不可收紧**），并订正 `session/models/SessionState.ts` 中「对齐 8 状态枚举」的**失真注释**。**验证**：`tests/state/session/SessionStateMachine.test.ts` **重写 25 例**（转移表/折叠映射/幂等无操作/非法转移/成环生命周期/`archive()` 防回流）；`lint:arch` **0 错**（R09-006 候选 **54 → 53**，恰等于删除 1 个 `*State` 枚举，逐数吻合）· `typecheck` 三工程全绿 · `lint:fn-size`/`lint:complexity` 未增长 · `bun test tests/state tests/chat tests/session tests/channels tests/query` **1490 pass / 0 fail** · `lint:invariants`/`lint:doc-code`/`version:check` 全绿。ℹ️ **CD05/CD06 遵从**：本批改动**提交时应拆两个提交**（①迁移 ②删除），**回滚路径** = 按证据 `code` 清单整体 revert（无 DB / 无 wire / 无持久化格式变更）。`e2eVerified=false`（未做真实长会话的会话状态观测端到端核对）。证据 `FSM-SESSIONSTATE-P3`
- ✅ **阶段 4：四原语只读投影 + 异步 Outbound Broker（telemetry-gated）** - **方案订正（层禁，已回仓举证）**：原文「由 `StateMachineRegistry` 直接挂钩 lifecycle dispatch 管线」不可行 —— ① `state`(**infra**) **不可**引用 `execution`(**service**) 的 `ExecutionStatus`（R00-001 倒挂）；② `StateMachineRegistry` 本体只是**实例缓存**（`register/find/gc`），**不存在** dispatch 管线 ⇒ 改为**两层分工**（原措辞的「或专用 wrapper」备选口径）：**四原语词汇 + 载荷 + Broker** 落 `state/engine/projectionBroker.ts`（infra，**零域依赖**、只认原语），**域侧纯映射**落 `execution/executionProjection.ts`（service）。**§3 裁定逐条落实**：`PREPARED/RUNNING/SUSPENDED/SETTLED` 为**严格无状态、只读、带外广播投影**；**原生枚举不变**（`EXECUTION_STATUSES` 未改）；**不承载裁决**；**不暴露内部细粒度状态**（§4.3）—— 载荷**键集恒为** `{at, domain, primitive, sessionId}`（测试以键集 + 原生专属字面量缺席**双重锁定**）。**4.1 纯映射（编译期穷尽）**：`EXECUTION_STATUS_PROJECTION: Record<ExecutionStatus, ExecutionPrimitive>` —— `QUEUED→PREPARED`；`RUNNING/WAITING_USER/CANCEL_REQUESTED→RUNNING`（与 `isActiveStatus()` **同界**）；`CANCELLED/COMPLETED/FAILED/STALE→SETTLED`（与 `isTerminalStatus()` **同界**）；`WAITING_USER` **不**投 `SUSPENDED`（后者语义为预算挂起、尚未实现）。**4.2 唯一 choke point**：`ExecutionManager.emitStatus`（`acquire/requestCancel/confirmCancel/complete/fail/markStale` 共 **7 处**状态转移全经它）⇒ 仅一处接线即全覆盖，**无需逐点手工调用**。**4.3 复用既有 `globalEventBus`**（**无独立总线**）：新增事件名 `SystemEvents.STATE_PROJECTED = 'state:projected'`；`publish` 语义为 **fire-and-forget**（不 await、单监听器异常各自捕获 ⇒ 天然"异步带外、失败不回流"，另有抛错订阅者测试验证隔离）。**开关**：`FEATURE_STATE_PROJECTION_BROADCAST`（**默认关** ⇒ 零行为变更）。**测试**：`tests/execution/executionProjection.test.ts` **5 例** · `tests/execution/projectionBroadcast.test.ts` **4 例**；`lint:arch` **0 错**（R09-006 候选 **53 不变**）· `typecheck` 三工程全绿 · `lint:fn-size`/`lint:complexity` 未增长 · `bun test tests/state tests/chat tests/session tests/channels tests/query tests/execution` **1572 pass / 0 fail**。⚠️ **未接线（如实，UW）**：① **无生产消费者**（出站订阅面 = 通道治理 §3 阶段 2.3，已**暂缓**）⇒ 不宣称"已下发到通道"；② **`SUSPENDED` 无生产者**（预算挂起未实现）⇒ 当前**不可达**（阶段 5）；③ 其余域未投影（`toolCall` 无单一 choke point；`session`/`app`/`task` 无真实消费者）。`e2eVerified=false`。证据 `FSM-PROJECTION-P4`
- ⛔ **阶段 5 阻塞（取证，零产品代码改动）** - **前置不存在**：① 预算**挂起**能力缺失 —— `TAORLoop.beforeReasoning`（`query/TAORLoop.ts:1115-1124`）耗尽即 `stopReason='budget_exhausted'; stopped=true; return`（**静默中止**，仅补 `logExhaustionAbort` 应用日志、**不给用户出路**）；② 上游 spec `long-task-suspend-resume.md` 仍为**立项稿·未排期·未头脑风暴**，其 §5 明写「**在此之前不动任何产品代码**」；③ `SUSPENDED` 投影**无生产者**（已在阶段 4 用测试锁"当前不可达"）⇒ **按设计与上游裁定不可执行**，**不虚造挂起态、不伪造进度**（CS05/CS06）。**已具备的前置（未来接入可直接复用，避免重复造）**：relief 台账（`DailyBudgetManager` 的 `effectiveLimit`/`debtTokens`/`ReliefKind` + `POST|DELETE /v1/cost/daily-budget/relief` 与 `GET` 暴露 relief/debt）· 唤醒信号（后端 3 发送点经 `cost:dailyBudgetUpdated` 广播、前端 `useNotificationSSE` 已订阅 —— 即上游 spec §3-Q4 点名候选）。**5.3 现状澄清（避免重复实现）**：「富上下文错误帧 `DAILY_BUDGET_EXCEEDED` + 三种恢复路径**可交互**结算」**已由 `daily-budget-over-limit-ux` 落地**（SSE `__pyapp_error_code` + 非流式 `errorCode`/`errorContext`；前端 `DailyLimitNotice` 三路径卡片 → `usageService.setDailyBudgetRelief`；通道侧**专用文案**）⇒ 本方案**不再实现第二套**。⚠️ **唯一残留缺口（如实）**：**通道侧**为**文案**、**非可交互**（按钮/回调），属通道侧（需出站交互面 + 入站回调，落通道治理 阶段 2.3/2.4），**不属**本方案内核改造。证据 `FSM-SUSPENDED-P5`（`fixed:false` 阻塞条目）
- ⬜ **未做（如实）**：无（阶段 1–4 已完成；阶段 5 阻塞于上游 `long-task-suspend-resume.md`）

#### v0.4.95 (2026-10-13)
债二专项：长程任务「预算挂起—续跑」spec **定案 v1.1**（设计交付，零产品代码）

- ✅ **spec 定案（v0.1 立项稿 → v1.1 定案稿）** - `.trae/specs/long-task-suspend-resume.md`：把 v0.1 的 **8 项"待讨论"逐条定案（D1–D8）**，每项附回仓取证（`file:line`）与取舍。**要点**：① **D1** 挂起粒度 = **任务级（session）落轮间安全点**（不做工具中途冻结）；② **D2** 挂起标记**分链落各自既有检查点**（流式 = `StreamingAutoCheckpoint` metadata 标记；batch = `taor_checkpoints.type='budget_suspend'`）——**不新建表**；③ **D3** 修 **F1**（`TAORLoop.ts:1463` `pendingToolCalls` 恒 `undefined` ⇒ `reExecuteTools` 恒 false），取值由**末条含 `tool_calls` 的 assistant 消息**推导；④ **D4** 唤醒信号 = `DailyBudgetManager` **进程内回调**（非事件总线）；⑤ **D5** 按 `sessionId` 匹配、挂起时间序、**串行 + 单次放行上限默认 3**；⑥ **D6** TTL **沿用既有 24h**（不引入第二套阈值）；⑦ **D7** 两条链都做、**唤醒决策层统一**（`BudgetSuspendCoordinator`），并硬性要求 batch 链**"真的再跑"**；⑧ **D8** 三种 relief 都唤醒，`waive-once` 只唤醒 1 个。**实施阶段** A（前置修复 F1/F2/F4）→ B（挂起核心，两条链）→ C（唤醒）→ D（可观测）；新增开关 `FEATURE_BUDGET_SUSPEND_RESUME`（**默认关**）
- ✅ **回仓取证 + 自带自检（fresh builder）暴露并订正 3 处** - ① **D4 事实订正**：原稿「复用 `globalEventBus` 的 `cost:dailyBudgetUpdated`」**不成立** —— 该事件只经 `broadcastEvent` → `LocalHTTPServiceSSE.ts:65-82` 写给 **SSE 客户端**（全仓无 `globalEventBus.publish('cost:dailyBudgetUpdated')`）⇒ 进程内订阅不到；且 5 个发送点含 `PUT`/`reset`/**kill-switch** ⇒ 照原样订阅会**误唤醒** ⇒ 改**进程内回调**；② **D2 订正**：原稿只覆盖 batch，而**桌面聊天主路径是流式链**（`ReActLoop.ts:790-806/812-819`）⇒ 改**分链落点**；③ **D7 补硬要求**：`resumeFromCheckpoint` **只恢复状态不触发执行**（`bootstrap.ts:373-389`）⇒ 唤醒 batch 链**必须补"可触发执行"的既有入口**。另新增 **F4**：`waive-once` 是**未接线的死能力**（`consumeWaiveOnce` 仅测试调用；`canExecute()` 不读 `waiveOncePending`）
- ✅ **用户两项范围裁定** - ① **同时修 `waive-once` 闸门接线**（否则唤醒后仍 `locked` ⇒ 撞"放行无反应"反目标）；② **两条链（流式 + batch）都本期做**
- ℹ️ **零产品代码**（如实） - 依该 spec 的 HARD-GATE：**批准前不写产品代码**；本批次仅产出 spec v1.1 + 台账/方案/总览回填。证据 `FSM-SUSPENDED-P5`（`designed` 由 false **升为 true**、`coded` 仍 false）

#### v0.4.94 (2026-10-13)
债二专项：长程任务「预算挂起—续跑」最终整支评审修复波（v1.3，2 Critical + 4 Important）

- ✅ **C1（Critical，**口径变更**）流式链唤醒必须"真的继续跑"** - 事实：日预算闸门在 `ReActLoop.run` 的**轮首、REASON 之前**触发（`ReActLoop.ts:826-834`）⇒ 此刻上一轮 ACT 工具**已全部完成** ⇒ `resumeStream` 过滤"未完成工具"后剩余为 `0`，**直接 yield `task_all_done` 并 return**（不发起新 REASON 轮）。**新口径**（对齐 `daily-budget-over-limit-ux` §5-D-1 D「最简可续跑（**重发**）」）：`ChatManager.resumeSuspendedSession(sid,'stream')` 改为**先试重放、无实质进展则经既有执行入口（`ChatOrchestrator.sendMessage`）重发一轮**，且**返回值如实**（无进展且重发失败 ⇒ `false` ⇒ 协调器**保留挂起**，不 `release`）。**同步订正 spec §3-D7 流式链措辞 + §6.2 补"两链都必须断言真的继续跑"**
- ✅ **C2（Critical）`waive-once` 放行接到流式/发送侧唯一收口** - 事实：F4 只接了 `DailyBudgetManager.canExecute()`（唯一运行时调用者 = `TAORLoop`），而**流式/发送侧**闸门是 `query/dailyBudgetGate.checkDailyBudget()`（自述纯读、不读 `waiveOncePending`）⇒ `waive-once` 放行后流式会话**立刻再次 `locked`**（反目标②在主链仍成立）。修复：`DailyBudgetManager` 新增**只读**判据 `hasActiveWaiver(now?)`；`checkDailyBudget()` 在 `mode==='locked'` 时按其放行（`allowed = waiver || (mode!=='locked' && projected<limit)`；**保持无副作用**）；消费点仍在 `recordUsage()`（不改）
- ✅ **I1（Important，**默认路径**，不受开关门控）`registerTAORLoop` 无界增长** - 事实：每 sessionId 注册一次而 `unregisterTAORLoop` **全仓零调用** ⇒ 进程级 `activeLoops` 无界增长（内存泄漏 + 僵尸 TAORLoop）。修复：① 注册表**有界化**（`MAX_TAOR_LOOP_REGISTRY=200`，超出按最旧淘汰、同键重注册不淘汰）；② 会话拆除锚点（`ChatManager.deleteSession`/`clearAllSessions`/`cleanup()`）**反向注销**（`_registeredTaorSessions` 记账；拆除入口第一步、与拆除结果解耦）
- ✅ **I2（Important，计划缺项）启动期把 `budget_suspend` 登记为"待放行挂起"** - 事实：spec §4.4 要求"重启后交协调器登记为待放行"，实现只做了 `scanPending`/`hasPending` 的**排除** ⇒ 重启后挂起**不可见也不可唤醒**（`list()` 为空）。修复：新增 `ResumeManager.scanBudgetSuspends()`（batch）+ `ChatBootstrap.resumeBudgetSuspends()`（在 `initialize()` 调用；**两支**：batch = `type='budget_suspend'`；stream = 会话检查点带 `metadata.budgetSuspend`），**只登记（`reason='restored_budget_suspend'`）、绝不自动续跑**；受 `FEATURE_BUDGET_SUSPEND_RESUME` 门控
- ✅ **I3/I4（Important）返回值如实 + `pendingToolCalls` 消费点** - I3 并入 C1 的"返回值如实"（不再无条件 `true`）。I4：F1 落盘的 `pendingToolCalls` 此前**无运行时消费者** ⇒ 新增纯函数 `buildBudgetResumePrompt()` 消费该清单生成续跑提示（带未完成工具名 + 参数摘要；空清单 ⇒ 通用提示）：**流式** = `StreamingAutoCheckpoint.suspend` 落 `metadata.pendingToolCalls`，唤醒端读出作"重发一轮"的提示；**batch** = 并入 `resumeSuspendedSession('taor')` 的 `injectSteering`。**同步在 spec §3-D3 写明该消费点**（取代"仅落盘"）
- ✅ **M2/M3/M5（Minor）口径统一与测试补强** - M2 去掉 `resumeSuspendedSession('stream')` 为取 id 的多余查询（`resumeStream` 的 `checkpointId` 形参未使用）；M3 `isSuspended()` **计入过期**（与 `list().expired` 同口径）、唤醒上限改按 **handler 调用数**计、`resumed` 日志记 relief `kind` + 新增 `resume_summary`（带 `woken`）；M5 负向用例补 `null`、`budgetSuspendStream` 用例①补断言"预算确已耗尽"
- ✅ **验证** - 新增/加强覆盖：`budgetSuspendStream`（C1①②③/I4）、`budgetSuspendStartupRestore`（I2，**新文件**）、`taorLoopResumeWiring`（I1 三项 + I4 taor）、`budgetSuspendWake`（M3）、`budgetSuspendTaor`（I2 batch）+ `dailyBudgetWaiveOnceGate`（C2）、`taorCheckpointPendingTools`（M5/I4）。`bun test` 本批 5 文件 **59 pass / 0 fail**；`bun run typecheck` 0 错；`bun run lint:arch` **0 错**（修掉一处因新增 `query/taor` 子目录导入触发的 R03-002 ⇒ 改经 `@modules/query` 模块出口）
- ⚠️ **残余（如实）** - **M1 未做**：`_waiverGrantedThisTurn` 的**会话归属**需扩 `canExecute()`/`BudgetPort` 签名（跨模块 ripple），超出"最小改动"；流式链通行证消费仍依赖同轮曾走 `canExecute()`（`recordUsage` 末尾 Consume-and-Die），否则在其 TTL 内保持有效。`e2eVerified=false` 不变。证据 `BUDGET-SUSPEND-RESUME`

#### v0.4.93 (2026-10-13)
债二专项：长程任务「预算挂起—续跑」实施（阶段 A–D，subagent-driven）

- ✅ **阶段 A：三项前置缺陷修复**（**不受开关门控**，可独立回滚） - **F1** `TAORLoop.saveCheckpoint` 写入真实 `pendingToolCalls`（此前恒 `undefined` ⇒ `reExecuteTools` **恒 false**、未完成工具永不续跑）；**F2** `registerTAORLoop` 接线（此前**全仓零调用** ⇒ `activeLoops` 恒空、TAOR 恢复端点恒 404）+ `ChatManager.resumeSuspendedSession(sessionId, chain)`，`taor` 分支经**既有**执行入口触发"真再跑"（不新增执行路径）；**F4** `waive-once` **闸门消费点**（此前是**死能力**：`consumeWaiveOnce` 零生产调用、`canExecute()` 不读 `waiveOncePending` ⇒ 放行后仍 `locked`）。**G-T3-1**：一次性续跑意图使 `ChatOrchestrator` 跳过 `taorLoop.reset()`（否则 `resumeFromCheckpoint` + `injectSteering` 的恢复态在下一次执行前被抹除，"续跑"退化为普通新一轮）
- ✅ **阶段 B/C/D：挂起 · 唤醒 · 投影**（`FEATURE_BUDGET_SUSPEND_RESUME` **默认关**） - ① **挂起**：流式链在 `ReActLoop` 两处耗尽点新增 `onBudgetExhausted` 钩子 ⇒ `StreamingAutoCheckpoint.suspend(reason)` 落 `label='budget_suspend'` 检查点；batch 链经新 helper `taor/budgetSuspendHook.ts` 落 `taor_checkpoints.type='budget_suspend'`（`TAORLoop.ts` **净零行**，守 R04-001）；均登记 `BudgetSuspendCoordinator`（内存缓存，**挂起事实源 = 检查点**，**不新建表**）。② **启动扫描过滤**：`ResumeManager.scanPending`/`hasPending` 排除 `budget_suspend`（单一判据、两处共用）⇒ **重启不静默烧额度**（反目标①，带负向测试）。③ **唤醒**：`DailyBudgetManager.onReliefApplied` **进程内回调**（**刻意不用** SSE `cost:dailyBudgetUpdated` —— 该事件进程内订阅不到且含 kill-switch 误唤醒）⇒ 挂起时间序、**串行**、上限 `BUDGET_RESUME_MAX_PER_WAKE`（默认 3）、`waive-once` **恰 1 个**、**幂等**、>24h 不唤醒；两条链分别经既有 `resumeStream` 与 `resumeSuspendedSession(...,'taor')` 续跑。④ **投影/可观测**：`SUSPENDED`/`RUNNING` 只读投影（载荷键集恒为 `{at,domain,primitive,sessionId}`）+ 结构化日志
- ✅ **验证** - 本批 21 例 + `tests/query|chat|execution` **874 pass / 0 fail**；`bun run typecheck` 0 错；`bun run lint:arch` 0 错（`TAORLoop.ts` 未触顶）；两处 fix round 各消除 2 项 Important（① `resumeStream` 入口漏接 `suspend` ⇒ 幽灵登记；② 登记前未校验检查点落成；③ 续跑意图永久滞留；④ 构造器急于向进程级单例注册 ⇒ 监听累积 + resume handler 被丢弃实例劫持）
- ⚠️ **如实缺口**（`e2eVerified=false`） - 未做真实长会话端到端（撞限→放行→续跑全链）核对；`streamMessageToolLoopContext` 的 `as unknown` 断言口径仍是既有类型盲区（parked）；唤醒上限按"成功数"计数（handler 调用数可 > N，未单测）；`taor` 续跑的 host 胶水缺集成用例。证据 `BUDGET-SUSPEND-RESUME`

---

#### v0.4.92 (2026-10-13)
20261012 批次落地复查 · 补齐第九批（侧车化 S5：P2 媒体侧车）

- ✅ **侧车化 S5（`TOOLGOV-SIDECAR-S5`，受 `TOOL_SIDECAR_MEDIA`，**默认关**）** - **T5.1**：`vision_worker` 纳入**受管侧车面** —— 新增 `tools/sidecar/{mediaSidecar,mediaSidecarLifecycle,mediaCapabilities,SidecarMediaAnalyzer}.ts`（**复用** `ToolSidecarSupervisor` + `sidecarIpc`，**无第三套 IPC**；生命周期语义复用 S3 已验证的握手/崩溃结算/有界重启），`ImageAnalysisTool` 改**双跑**（关 ⇒ 既有 `WorkerGuard` 逐字不变；开 ⇒ 经 `media.analyze` 同形状返回）；覆盖 `ocr`/`objects`/`similarity`，其余**显式 fail-closed**。**T5.2**：`sharp` **只收一处** —— `ImageInputRouter` 的超大图缩放（原 >20MB 动态 `import('sharp')`）开关开经 `media.resize`，关逐字原路径；**未触碰** `media/image/ImageProcessor.ts` 主路径。**等价性**：off/on **字节级等价**（on 后端 = 同参数真 sharp）+ 断言确发 `maxSide:2048,quality:85`；后端抛错 ⇒ **不静默回落**。**验证**：先红后绿（3 errors + 5 fail / 1 pass ⇒ **17 pass / 0 fail**）；`tests/tools/sidecar` **64 pass**；`tests/{tools,utils,ai}` **1325 pass / 0 fail**；门禁全绿
- ⚠️ **如实遗留（S5）** - **真实 L2 模型端到端未验证**：真起侧车后握手与 `media.resize`（真 sharp）通过，但 `media.analyze(ocr)` 受阻于 `Model 'easyocr' is not installed`（缺 EasyOCR/ultralytics/open_clip）⇒ 仅打通到「模型缺失」的结构化错误；**无 >20MB 真图夹具** ⇒ 以 161KB 图 + 缩小 `maxBytes` 触发同一路径做等价验证（计划允许的退化）；**未摘未删** `ai/python/**`（CD05/CD06/CD07）

#### v0.4.91 (2026-10-13)
20261012 批次落地复查 · 补齐第八批（门禁 DX 硬化：登记表 JSON 破损可精确定位）

- ✅ **`lint:fix-evidence` 解析失败时给出精确行列 + 惯例提示** - 本仓已**三次**因"登记表字符串内误用 ASCII 双引号"致 JSON 提前闭合，而 bun 的 `JSON Parse error` **不带位置**（只见 `Unrecognized token 'X'`）⇒ 排障成本高。新增 `locateStrayQuote()`（纯文本扫描：字符串闭合后下一个非空白字符必须是 `,` `}` `]` `:`；否则即元凶）⇒ 失败时打印 `文件:行:列`、该行内容与「本仓惯例：字符串内一律用中文引号「」」提示（[scripts/lint-fix-evidence.ts](file:///e:/PY/Documents/CODES/PY_APP/scripts/lint-fix-evidence.ts)）
- ✅ **负向自证（含修 bug）** - `app/tests/gates/fixEvidenceGate.test.ts` 新增 1 例：喂入含未转义引号的登记表 ⇒ 断言 exit 1 + 提示文案 + **元凶行号**。**首轮该用例即捕获我自己的实现 bug**（闭合后未复位 `inStr` ⇒ 报错位置偏移到 3:3）、修正后 **8 pass / 0 fail**。`lint:fix-evidence` 正常路径仍 **119 条自洽**；`typecheck` 0 错；`lint:fn-size`/`complexity` 未增长

#### v0.4.90 (2026-10-13)
20261012 批次落地复查 · 补齐第七批（侧车化 S4：同源门禁）

- ✅ **侧车化 S4（`TOOLGOV-SIDECAR-S4`）** - **取证结论**：侧车工具**已在同一 `ToolRegistry` / 同一装配链**（[ToolManagerUtils.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/utils/ToolManagerUtils.ts) 的 `cond(coreFeature('LSP'), …)` 位于 `buildBuiltinToolLoaders()` 清单内 ⇒ 进唯一注册表），且 **PathGuard 与结果上限已天然覆盖**（`ReActToolLoop` 门禁落点 + 注册表驱动的 `resolveToolParamNames`（`file_path ∈ PATH_ARG_KEYS`）+ 公共 `ToolResultBudget`）。**T4.1 裁定 = 保名派**：**不**改名为 `${server}__${tool}`（改名派会破坏 S2 已锁定的 schema deep-equal 不变量，且侧车不是 MCP server ⇒ 需整套 MCP 基建）⇒ 达成「进同一 registry、自动获同套门禁」的**目标**，工具名恒 `lsp`；计划 T4.1 验收原文已按此订正并留档冲突。**T4.2 落地**：新增 `SIDECAR_LSP_LANDLOCK_APPLICABILITY` **显式声明**（代码常量 + 注释 + 测试三处一致；LSP 只读查询 ⇒ **Landlock N/A**，不装作同源）+ 测试 `sidecarSameSourceGate.test.ts` **9 例**。**如实**：真实红→绿**仅**发生在 Landlock 常量（PathGuard/结果上限两例因机制层 S2 已覆盖，**首次可运行即绿**）；`tests/{tools,chat,utils}` **1597 pass / 0 fail**；门禁全绿
- ⚠️ **如实遗留（S4）** - 真实 `typescript-language-server` 端到端仍未验证（同 S0/S2/S3）；未在 `ReActToolLoop` **全栈**做整轮拦截断言（改在门禁落点证明同源）；`TOOL_SIDECAR_LSP` 仍默认关 ⇒ 生产零行为变更

#### v0.4.89 (2026-10-13)
20261012 批次落地复查 · 补齐第六批（侧车化 S3：崩溃结算/重启 + 取消下传）

- ✅ **侧车化 S3（`TOOLGOV-SIDECAR-S3`）** - **取消下传**（T3.2）：工具层认领 `AbortSignal`（[SidecarLspTool.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/sidecar/SidecarLspTool.ts) 对齐既有 `McpToolWrapper` 做法）⇒ supervisor 写 `notify` 帧（**沿用 `sidecarIpc` 既有形状，未造新协议**）并本地结算 ⇒ 侧车 `abort()` 在飞连接 ⇒ 连接层转发标准 LSP `$/cancelRequest`；取消 ⇒ 明确「已取消」且**不回落内置**。**崩溃结算/重启**（T3.1）：崩溃 ⇒ **pending 全拒**（明确错误）+ **不自动重试**（避免重复副作用）+ **有界重启**（重启窗口内请求等待握手就绪；超限 ⇒ `fatal` fail-closed）。**验证**：先红后绿（实现前 2 pass / 5 fail ⇒ 后 **7 pass / 0 fail**）+ **真实进程级 + 故障注入（假 LS）E2E** 全链通过（取消 ⇒ LS 收到 `cancel:` 且主内核存活 ⇒ kill ⇒ 重启 ⇒ 再请求成功）；`tests/{tools,utils}` **1051 pass / 0 fail**；门禁全绿
- ⚠️ **如实遗留（S3）** - **真实 `typescript-language-server` 的语义端到端仍未验证**（本机未安装，同 S0/S2）；取消为 **best-effort**（侧车已崩时 `notify` 静默无写）；`fatal` 态后请求立即 fail-closed；`TOOL_SIDECAR_LSP` 仍**默认关** ⇒ 生产零行为变更

#### v0.4.88 (2026-10-13)
20261012 批次落地复查 · 补齐第五批（侧车化 S2：`lsp` 工具经侧车真接线，Option A）

- ✅ **侧车化 S2 —— `lsp` 工具**经侧车真接线**（`TOOLGOV-SIDECAR-S2`）** - 用户裁定 **Option A**：**不收敛轨 B**（`app/src/lsp/**` 与 `tools/lsp/**` **未触碰**；前置取证 = 轨 B 静态近零 + **运行时不可达**，见 T0.1）。新增 [lspConnection.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/sidecar/lspConnection.ts)（侧车**自持**最小 LSP 连接：标准 `Content-Length` 分帧 + `initialize`/`hover`/`definition`；`spawnFn` 可注入）与 [SidecarLspTool.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/sidecar/SidecarLspTool.ts)（适配器 schema 与内置 `LSPToolAdapter` **deep-equal**）；[lspSidecar.ts](file:///e:/PY/Documents/CODES/PY_APP/app/src/tools/sidecar/lspSidecar.ts) 由桩改为**真实分派**；loader 侧车分支由「返回 `null`」改为经侧车执行（**off 分支逐字不变**，装配点未动 ⇒ 同一 ToolRegistry/PathGuard/结果上限）。**覆盖 3 项**（`initialize`/`hover`/`definition`），**其余 11 个 action 一律 fail-closed `NOT_IMPLEMENTED`**（不假装成功、不静默回落内置）。先红后绿（7 fail + 2 errors ⇒ **38 pass / 0 fail**）+ **真实进程级（假 LS）E2E** 打通；`tests/{tools,utils}` **1044 pass / 0 fail**；门禁全绿
- ⚠️ **如实遗留（S2）** - **真实 LS 端到端未验证**（本机无 `typescript-language-server`，详见 S0）；LS 崩溃恢复/退避与**取消下传**未接线（属 S3）；**同源门禁**（S4/T1-11）未做；`tools/sidecar/` 全程 **默认关**（`TOOL_SIDECAR_LSP=false`）⇒ 生产零行为变更
- 📄 **文档订正（顺带）** - 实施计划 T0.2 的**错误前提**已订正：`CHANGELOG.md` 并无「D10 P1 未落地」表述（`:221` 早已记 ✅；`:90` 实为 MCP 安全段）⇒ 该任务**无需**改动 CHANGELOG；真正的漂移在 `工具治理方案`/`盘点清单`（先前已修）

#### v0.4.87 (2026-10-13)
20261012 批次落地复查 · 补齐第四批（侧车化 S0+S1 骨架 · 债四 S1+S2 换算内核，均默认关/未接线）

- ✅ **侧车化 S0（前置校验，零产品代码）** - ① **轨 B（`app/src/lsp/**`）静态近零但存在字面量动态 thunk**：`core/LazyModuleStrategy.ts:364` 的 `lsp: () => import('../lsp/index.js')`（`ON_DEMAND`），然而触发链 `ModuleInitializer.requestOnDemandModule()` **全仓零调用** ⇒ 属 CD07「未接线但动态可发现」**高风险项，登记不删**（结论与无法确认项已回填实施计划）；② 真机探测**如实受阻**：本机 `typescript-language-server` **不可用**（`npx --no-install` 失败）、仓库内**无 >5MB 图片夹具** ⇒ P2 真机项需外部环境补齐；③ 基座复核 `tests/utils/sidecarIpc.test.ts` **8 pass**
- ✅ **侧车化 S1（骨架 + 双跑开关，默认关 ⇒ 零行为变更）** - 新增 `app/src/tools/sidecar/{ToolSidecarSupervisor,lspSidecar,toolSidecarLifecycle}.ts`（**复用** `utils/sidecarIpc.ts`，**未新增第三套 IPC**；监督器**新写**并说明选型理由：不属 `daemon/ProcessManager` 的守护控制面语义）；开关 `TOOL_SIDECAR_LSP`/`TOOL_SIDECAR_MEDIA`（**默认 false**）；门控点 = 工具 loader `ToolManagerUtils.selectLspToolLoader()` 与启动层 `maybeStartLspSidecar()`（**关 ⇒ 零 spawn**，off 分支逐字返回原 `byKey('createLSPTool')`）；新增 17 例（含就绪超时/版本不兼容 fail-closed/**崩溃 ⇒ pending 全拒**/有界重启/stop 不重启）+ **真机进程级 E2E**（真实 spawn → 握手 → 诚实回 `NOT_IMPLEMENTED` → stop）。**⚠️ 与 spec §4 阶段 1 验收的差异（如实）**：本片仅骨架，**开关开 ⇒ 侧车分支 fail-closed 返回 `null`**（**不**回落内置"每次 spawn"，规避静默双轨）；工具面真接线在 **S2**（与实施计划 T2.2/T2.3 一致）
- ✅ **债四 S1+S2（换算内核 + 取价适配器，**未接线 ⇒ 零行为变更**）** - **S1 复用/下沉而非新写**：`core/pricing.ts` 新增/下沉 `resolveTimeBasedPricing`、`DEFAULT_MODEL_PRICING`、`projectRegistryPricing`（由 `cost/ModelPricing.ts` **原样下沉**，值不变），后者改为**委托/转出**；**S2** 新增 `app/src/query/modelPricingAdapter.ts`（`resolveModelPricing`/`estimateTurnCostUsd`，经 **core SPI** 取价 —— **`query` 不静态引 `cost`**，分层合规已 grep 自证 + `lint:arch` 0 error）。**如实**：适配器目前**仅有单测消费方**（经 `@modules/query` 桶导出），**生产闸门仍走现行 Token 口径**；`spec §12` 已回填**九项裁定**（U1/U2/U4–U10）并保留 **U3（USD 默认上限）待裁定 ⇒ 未定前不得实现任何默认值**
- ✅ **回归与门禁** - `typecheck` 3 工程 0 错；`lint:arch` 0 error（警告 = 基线）；`lint:size`/`lint:fn-size`/`lint:complexity` 未增长；`lint:doc-code`/`lint:fix-evidence`/`lint:models`/`version:check` 全绿；`tests/{tools,core,query,cost}` **1311 pass / 0 fail**

#### v0.4.86 (2026-10-13)
20261012 批次落地复查 · 补齐第三批（守卫挂起 + 独立继续入口 + 欠账缺陷更正）

- ✅ **`T3-12`：熵门禁 / 轮上限「接通挂起」+ 独立继续入口（`T3-12-GUARD-SUSPEND`）** - 用户裁定「两者都接通挂起」+「**新增独立继续入口，不复用 relief**」（部分推翻 `TOOLGOV-TG5` 的「绝不阻断」）。新增 `app/src/query/guardSuspend.ts`；协调器引入 `kind: 'budget' | 'guard'` 且 **relief 只唤醒 `budget`**（guard 挂起**不被放行唤醒**，含负向测试）；两条触发源接线：熵门禁（stream 链，`schema_entropy`）与 `TAORLoop.onMaxIterations()`（taor 链，`turn_limit`，落 `guard_suspend` 检查点）；新增端点 **`POST /v1/sessions/:id/continue`**（guard 挂起 ⇒ 200；未挂起 ⇒ 404；**budget 挂起 ⇒ 409**，防继续入口成为 relief 旁路；失败 ⇒ 502 且回滚）；`ResumeManager` 新增 `isSuspendCheckpoint` 使 guard 挂起**不被 Durable Resume 自动续跑**；开关 **`FEATURE_GUARD_SUSPEND`（默认关）** ⇒ 关时零行为变更。新增测试 28 例；`TAORLoop.ts` 维持 **1999 行**（净零）
- ✅ **缺陷更正：`waive-once` 的「计入欠账、次日扣回」此前是**静默 no-op**（`WAIVE-ONCE-DEBT`）** - `_consumeWaiverOnce()` 原**只清通行证、不累加** `debtTokens`（全仓无 `+=`）⇒ 文档/前端承诺的欠账与次日扣回**从未发生**。现于消费点按**本次实际消耗**累加欠账（`recordUsage(tokens, sessionId)` 的同会话分支），跨日扣回复用既有 `_rolloverIfNeeded()`（CS01，无需新机制）。**先红后绿**（`git stash` 反证：修复前 `Expected 1234 / Received 0`）⇒ 修复后 13 pass / 0 fail。⚠️ **行为变更（如实）**：欠账**自此真正生效** —— 用 `waive-once` 放行后的次日可用额度会按实际消耗扣回（这正是既有文档承诺的语义）
- 📄 **两份决策支持文档（只写文档）** - ① [债四 §12 十项待裁定的**裁定建议**](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/unified-budget-and-accounting-%E8%A3%81%E5%AE%9A%E5%BB%BA%E8%AE%AE-20261013.md)（逐项：取证/建议/备选与影响/落地切片）；② [侧车化**实施计划**](file:///e:/PY/Documents/CODES/PY_APP/.trae/specs/tool-sidecar-isolation-plan-20261013.md)（8 阶段 / 19 任务，含 CD05/CD06/CD07 切片与验收）
- ✅ **回归与门禁** - `typecheck` 3 工程 0 错；`lint:size`/`lint:fn-size`/`lint:complexity` 未增长；`lint:fix-evidence`（**114 条**）/`lint:doc-code`/`version:check` 全绿；`tests/{query,chat,http,state,session,tools,execution,budget}` **2334 pass / 0 fail**

#### v0.4.85 (2026-10-13)
20261012 批次落地复查 · 补齐第二批（工具数据源门禁 + 债一残余线性收口）

- ✅ **工具治理 阶段 3.2：「新数据源不以新增工具承载」源码门禁（`TOOLGOV-T12-32`）** - 新增 `app/tests/tools/toolDataSourcesNotNewTools.test.ts`：声明面 = `TOOL_NAME_CONSTANTS`（工具名唯一来源），**冻结基线 + 豁免清单（须非空理由）**，判据「新增 = 声明面 − 基线，必须已登记」否则 **fail-closed**；附基线陈旧检测与豁免重叠检测。**负向自证**固化在用例内（未登记的 `mysql_query` 被拦截、登记后放行）。先红后绿（3 fail → 6 pass）
- ✅ **债一残余：`readBySeq`/`getTailSeq` 线性路径收口 + 纳入基准（`DEBT1-T310`）** - `app/src/session/storage/EventLogStorage.ts` 两条路径改为**复用既有 idx 二分定位**（`readBySeq` 走 `resolveScanStartOffset` 段读；`getTailSeq` 从末区间起点续扫），新增 `loadIdxEntries()`/`resolveTailScanStart()`/`openOffsetReadline()`，并修正 `findIdxStartOffset` 对"未索引尾部"的回退为**末区间起点**；`app/scripts/bench-longrun.ts` 新增 **F1c 随机访问**基准覆盖两条目标路径。**实测**：规模 ×10 ⇒ `getTailSeq` P50 ×1.2、`readBySeq` P50 ×1.0（改动前末条 `readBySeq` 为 ×11.8 全扫）⇒ 与规模解耦。语义/返回值**不变**（等价性用例 + P0-5/CRLF 回归全绿）；**不迁 SQLite**；新增守卫 `app/tests/session/eventLogIndexedTailReads.test.ts`（先红后绿：4 fail → 6 pass；回归 49 pass）
- 📄 **两份 spec 推进（只写文档，未动产品代码）** - ① **侧车化**：新增 `.trae/specs/tool-sidecar-isolation.md` **v1.0 定案稿**（D1–D11 + 实施切片 S0–S7；前提订正：D10 的 P1 IPC 基座**已落地**）**待批准实施**；② **债四（USD 唯一口径）**：`.trae/specs/unified-budget-and-accounting.md` 由 v0.1 立项升为 **v1.0 定案稿**（D1–D9 + 切片 S0–S7），**§12 列 10 项待裁定**（HARD-GATE：裁定前不写产品代码）。**关键发现**：`DailyBudgetManager.debtTokens` **全仓无自增点** ⇒ 既有文档所述「`waive-once` 计入欠账、次日扣回」实为**静默 no-op**（已列为该 spec 的 S0 必修前置）
- ✅ **回归与门禁** - `typecheck` 3 工程 0 错；`lint:size`（`EventLogStorage.ts` 1983 行，仅 WARN）/`lint:fn-size`/`lint:complexity` 未增长；`lint:fix-evidence`（112 条）/`version:check` 全绿；`tests/{tools,session}` **1065 pass / 0 fail**

#### v0.4.84 (2026-10-13)
20261012 批次落地复查 · 补齐第一批（全方案落地复查 + 文档/台账漂移补齐 + T3-9 默认值单源统一）

- ✅ **全方案落地复查（35 条待办逐条对账）** - 对 `dev_docs/20261012/` 五方案逐条回仓取证（代码 `file:line` + 测试 + 证据台账），结论：**16 项已落地 · 8 项部分落地 · 10 项未落地**（含"未落地项"与部分落地缺口逐条列明）；结论入册 `五方案总览` §8，并做一轮**轻量真机 smoke**（真实会话 + 工具调用：`read_file` 返回 17580 字符 ⇒ 正确答 `0.4.77`；两个查询面 200；无挂起；环境已恢复）
- ✅ **`T0-4` 文档幻觉符号订正** - `README.md` 与 `agent/registry/AgentRegistry.ts` 的 `SwarmCoordinator`/`AgentChain`（**均无实体**）订正为 `AgentSwarm` / 仅 `CHAIN_*` 事件；顺带清除 README 结构树中**已移除**的 `core/gateway/`
- ✅ **`T0-6` `flows/FlowEngine.ts` 零消费者登记入册** - `.trae/specs/dead-code-and-unwired-items-rulings.md` §2 新增 **UW-4**（**只登记不删**，依 CD07）
- ✅ **`T3-9` 默认预算常量单源统一** - `query/DailyBudgetManager.ts` 的 `DEFAULT_DAILY_BUDGET_TOKENS` 与类内 `DEFAULT_CONFIG.dailyLimit` **合并为同一常量引用**（单源）；按用户裁定以 **`1_000_000`** 为准（与原方案裁断 500_000 相反，**如实登记**）
- ✅ **过时结论订正** - `state/engine/projectionBroker.ts` 与台账 `FSM-PROJECTION-P4` / `FSM-SUSPENDED-P5` 的「`SUSPENDED` 无生产者/不可达」已被债二落地推翻 ⇒ 更正为「**已有生产者、阶段 5 实质达成**」（`e2eVerified` 仍 false，因投影广播默认关）；侧车方案/盘点清单的「D10 P1 IPC 基座未落地」订正为**已落地（2026-10-10）**
- ✅ **顺带修复两处此前未被发现的红** - ① `tests/query/dailyBudgetSingleton.test.ts` 的**机器配置依赖**断言改为**从解析结果派生**（既存"环境型失败"一并消除）；② `tests/state/stateMachineHygiene.test.ts` 的应用安装状态守卫改**空白容忍正则**（prettier 折行后原单行契据**恒为 0、形同虚设**）
- ✅ **质量** - `typecheck` 3 工程 0 错；`lint:size`/`fn-size`/`complexity` 未增长；`lint:doc-code`/`lint:fix-evidence`/`version:check` 全绿；`tests/{state,query,chat,execution,http,session,budget}` **1550 pass / 0 fail**

#### v0.4.83 (2026-10-13)
M1 认领语义收紧：`waive-once` 通行证「先认领者独占」

- ✅ **`canExecute(sessionId?)` 不再每次调用都重写认领** - 改为**仅当无认领者时**认领（`_waiverGrantedForSession === null` 才置位；无 sessionId 的调用**不认领**）⇒ 消除「后到会话在同一 TTL 窗口内夺走消费归属」。依据：通行证是**单次**豁免 ⇒ 应由**最先**用它放行的会话负责消费，Consume-and-Die 的归属才稳定（承接上一批 M1 报告里如实披露的残余）
- ✅ **锁定测试** - `tests/query/dailyBudgetWaiveOnceGate.test.ts` 新增 **M1-⑥**（先红后绿：修复前 **11 pass / 1 fail**，修复后 **12 pass / 0 fail**）；广域 `tests/{query,chat}` **832 pass / 1 fail**（唯一 fail 为既存环境型 `dailyBudgetSingleton` env 遮蔽）
- ℹ️ **行为面** - 两会话同处 `locked` 且通行证有效时：**两者都会被放行**（既有语义不变），但只有**先认领者**的记账会消费该通行证；认领者若始终不记账，通行证由既有 **TTL** 兜底失效

#### v0.4.82 (2026-10-13)
长程任务「预算挂起—续跑」收尾四项开放项收口（M1 会话归属 / observeRound 落盘 / as-unknown 收窄 / E2E-2 定案）

- ✅ **M1：`waive-once` 通行证按会话归属（不受开关门控）** - 原为 manager 级布尔 `_waiverGrantedThisTurn`，而 `getDailyBudget()` 是**进程单例** ⇒ A 会话取得通行证后，**B 会话**任何一笔记账都会把它消费掉。现改为 `_waiverGrantedForSession: string | null`：`canExecute(sessionId?)` 置位、`recordUsage(tokens, sessionId?)` **仅同一会话**的记账消费（精确相等，CS02；跨会话/无 sessionId **不消费**，未消费者由通行证 **TTL 兜底**）；`settleFor(sessionId, …)`（chat 主路径唯一记账写者）与 `recordDailyBudgetFromUsage(usage, sessionId?)` 透传；`TAORLoop` 传其 `sessionId`。回归 `tests/query/dailyBudgetWaiveOnceGate.test.ts`（先红后绿）
- ✅ **observeRound：终态早退不再快于落盘（不受开关门控）** - `TAORLoop._observeRound` 的熔断/收益递减两条**终态早退**原先**位于** `persistMessages` 之前 ⇒ 该轮**已执行**的工具结果不落盘（用户观感"没继续"）。现将 `persistMessages`（含重试）**整块前移**到两条早退之前（why：工具确已执行 ⇒ 结果必须落盘；是否终止是另一件事）；`stopReason`/`stopped`/相位取值与两早退的相对顺序**均不变**；`TAORLoop.ts` 维持**净零行**（`lint:size` 计 2000）。回归 `tests/query/taorObservePersistsBeforeTerminalReturn.test.ts`（先红后绿：修复前 persist 计数 0）
- ✅ **as-unknown：收窄工具轮上下文的类型盲区（零行为变更）** - 移除 `streamMessageToolLoopContext.ts` 的**整体** `as unknown as ToolLoopContext` 断言 ⇒ 改为具名注解（编译器**逐字段**校验），并把 `ToolLoopContextDeps` 的 `unknown` 字段收窄为端口真实类型；**端口装配收敛到 `buildToolLoopContext` 内**（`toStreamingCheckpointPort`，含**必填** `suspend`）⇒ 两个调用方（流式主链 / 恢复路径）一律传裸检查点，**任何调用点都不可能漏接 `suspend`**（`ChatManager` 侧的重复包装与 import 随之移除）。保留 **5 处**带中文理由的**单字段**窄断言（host 桥接 4 + 端口入参形状 1）
- ✅ **E2E-2 定案（真实 E2E 复现 + 单测锁定）** - 真实 E2E（同一挂起点**两次放行**）证明：**协调器每次放行都被通知**（`resume_summary` 每次都打），第二次候选为空 ⇒ `woken:[]` 且 handler **零新增调用**；原观测「第二次未再触发 `onReliefApplied`」**系误判**（很可能是 v1.4 会话锁泄漏期的次生表现）。据此**定案**：**成功即释放** ⇒ 再次放行**幂等无操作**；**失败即回滚** ⇒ 再次放行**重试**。锁定测试 `tests/query/budgetSuspendWake.test.ts` 新增「E2E-2 定案」组（2 例）
- ℹ️ **既有测试口径变更（如实，2 处）** - ① M1 使 2 处既有用例（F4-② / C2）原「无 sessionId 记账 ⇒ 消费」的期望与新口径冲突 ⇒ 改为**会话化**（保留「放行恰消费一次」意图）；② `tests/chat/orchestrator/toolLoopContext.test.ts` 的「`streamingCheckpoint` **同引用**透传」改为**转发等价**断言（端口两方法必须转发到同一实例），原因：该字段由「调用方各自装配」改为「装配处统一适配」
- ✅ **回归与门禁** - `typecheck` 3 工程 0 错；`lint:size`（TAORLoop 2000 · streamMessageFlow 未增长）/ `lint:fn-size`（棘轮维持）/ `lint:complexity` / `lint:doc-code` / `lint:fix-evidence`（110 条）/ `version:check` 全绿；`tests/{query,chat}` **829 pass / 1 fail**（唯一 fail 为**既存环境型** `dailyBudgetSingleton` env 遮蔽，与本次改动无关）；真实 E2E 环境已恢复（`dailyLimit 500000` / relief 撤销 / 挂起清零 / 实例已停）

#### v0.4.81 (2026-10-13)
长程任务「预算挂起—续跑」正式启用：`FEATURE_BUDGET_SUSPEND_RESUME` 翻为默认开

- ✅ **开关启用（用户裁定「补齐查询面可见性与 taor 链 E2E 后再启用开关」）** - 两项前置已补齐（查询面可见性 v1.5 · taor 链真实 E2E v1.6 复核通过）⇒ `app/src/core/featureFlags.ts` 的 `BUDGET_SUSPEND_RESUME` **由 `false` 改为 `true`**：日预算耗尽时长任务在**轮间安全点**挂起并登记，用户放行（`boost`/`unlock-today`/`waive-once`）后按挂起时间序、上限内**真的续跑**（两条链均已真实端到端实证）
- ✅ **同批同步「默认关」措辞与负向用例** - ① 源码注释：`featureFlags.ts` 自身 · `query/budgetSuspend.ts` · `query/taor/budgetSuspendHook.ts` · `chat/ReActToolLoop.ts` · `chat/ChatManager.ts` · `chat/manager/bootstrap.ts`；② 测试头注（`budgetSuspendTaor` / `budgetSuspendStream` / `budgetSuspendStartupRestore`）；③ **3 处「开关关」负向用例改显式关** —— `delete process.env[FLAG]` → `process.env[FLAG] = 'false'`（`feature()` 三层解析 = env > 变体层 > 静态默认 ⇒ 默认为开后，**删 env 不再等于「关」**，不改则负向用例会静默失效）
- ✅ **回归** - `bun test tests/{query,chat,execution,http,session}` **1397 pass / 1 fail**（该 1 fail 为**既存环境型**：`dailyBudgetSingleton` 的 env 覆盖断言被持久化配置 `costControl.dailyTokenBudget` 遮蔽，与本次改动无关）；`typecheck` 0 错；门禁全绿
- ℹ️ **回退** - 改回 `false`（1 行）或 `FEATURE_BUDGET_SUSPEND_RESUME=false` ⇒ 撞限行为与启用前**完全一致**

#### v0.4.80 (2026-10-13)
长程任务「预算挂起—续跑」B3 收尾修复批次（B3-2 递减连续性复位 + B3-3 启动期装配唤醒端口 + 幽灵挂起根除）

- ✅ **B3-2 恢复边界复位 loop-local 收益递减连续性（不受开关门控）** - 根因：唤醒为保住恢复态**刻意跳过 `reset()`**（G-T3-1），而 `this.dailyBudget` 是 loop-local 实例（`TAORLoop.ts:301` 每实例新建）⇒ 其收益递减连续性（`lastTotalTokens`/`diminishingTurnsCount`，`DailyBudgetManager.ts`）**跨挂起边界残留** ⇒ taor 恢复首轮被 `_observeRound` 的 `checkDiminishingReturns` 误判为 `diminishing_returns` 提前终止，且该早退分支**先于** `persistMessages` ⇒ 工具执行了却不落盘。**修法**：`DailyBudgetManager.resetDiminishingReturns(baselineTokens?)`（原为**零调用者**且基线用 `todayUsed`，与 `checkDiminishingReturns(currentTokens)` 的入参**不同源**）改为 `lastTotalTokens = baselineTokens ?? this.todayUsed`；`TAORLoop.resumeFromCheckpoint` 在 `const currentTokens = checkpoint.budgetState.currentTokens ?? 0` 之后以之复位。**不受开关门控**（跨重启恢复本就 = 新实例/计数 0 ⇒ 本修复是让**进程内恢复与跨重启恢复对齐**，非新语义）；`TAORLoop.ts` 维持**净零行**（`lint:size` 计 2000，零余量守 R04-001）
- ✅ **B3-3 启动登记处一并装配唤醒端口（受开关门控）** - 根因：唤醒端口注册点仅由 `sendMessage`/`streamMessage` **惰性**触发（Fix round 2 刻意设计：避免命令处理器的丢弃实例向进程级单例注册永不解除的监听并劫持 handler）⇒ 服务**重启后未先发任何消息**即点放行 ⇒ `DailyBudgetManager.onReliefApplied` 回调集为空 ⇒ 放行**静默无效**（**影响流式链与 taor 链两条链**）。**修法**：`ChatBootstrapDeps` 新增**必填** `installBudgetSuspendResume`（守 CS03：不做 `?.(` 式静默兜底，宿主缺装配即编译期报错），在 `ChatBootstrap.resumeBudgetSuspends()` 的开关检查之后**最先**调用（**先装配、后 await 扫描**，避免启动扫描窗口内发生的放行被丢弃）；宿主 `ChatManager` 注入 `() => this._ensureBudgetSuspendResumeInstalled()`（复用既有幂等实现）。**仍钩在启动期而非构造期** ⇒ 不违反「丢弃实例零副作用」的既有裁决
- ✅ **幽灵挂起根除：会话删除同步清理 taor 检查点（不受开关门控）** - 根因：`ChatSessionTeardown.deleteSession` 此前只清**流式链**检查点（`session_checkpoints`），**不清** **taor 链**（`taor_checkpoints`）⇒ 删除的会话在服务重启时被 `ChatBootstrap.resumeBudgetSuspends()` 重新登记为「幽灵挂起」，用户放行时对已删会话尝试续跑（额外 LLM 开销 + 误导日志）。**修法**：新增私有 `clearSessionTaorCheckpoints`（动态 import `ResumeManager.clearSession`，与流式链清理**两链对称**；失败仅告警、不阻塞删除主流程）
- ✅ **真实 E2E 三项复核全通过（`--http-only` + `FEATURE_BUDGET_SUSPEND_RESUME=true` + 真实 LLM，端口 18990）** - ① **B3-3**：启动完成后**未发任何消息**即放行 ⇒ 日志 `budgetSuspend:resume_summary{kind:'boost',woken:[]}` 且**无** `budgetSuspend:relief_no_handler — 未装配唤醒处理器，跳过唤醒`（修复前该路径只会打后者并直接返回）⇒ 端口确已在启动期装配；② **B3-2**：taor 链「撞限挂起 → 放行 → **真续跑**」⇒ `Checkpoint saved{type:'budget_suspend'}` → `budgetSuspend:suspended{chain:'taor'}` → 放行 → `Resumed from checkpoint{turnCount:0,phase:'act'}` → `taorLoop:steering_injected{count:1}` → `reActLoop:seeded_acting{glob,glob}` → `budgetSuspend:resumed{chain:'taor',kind:'boost'}` + `resume_summary{woken:[<SID>]}`，该会话消息数 **5 → 14**（新增 3 条**真实工具结果**），**全日志无** `收益递减，终止循环`/`diminishing_returns`；③ **幽灵挂起**：上述会话经 `POST /v1/sessions/batch-delete` 删除后，直连 DB 查 `taor_checkpoints WHERE session_id=<SID>` = **0 行**（删除前该会话确有一条 `budget_suspend` 行）
- ✅ **回归与门禁** - 新增 `tests/query/taorResumeDiminishingReset.test.ts`（B3-2，先红后绿）· `tests/chat/taorLoopResumeWiring.test.ts` B3-3 组（3 例：装配恰一次 / 装配先于扫描 / 未发消息即生效）· `tests/chat/sessionTeardownTaorCleanup.test.ts`（幽灵挂起，先红后绿）；聚焦测试 **25 pass / 0 fail**；`typecheck` 0 错；`lint` 0 error；`lint:arch` / `lint:size` / `lint:fn-size` / `lint:complexity` / `lint:doc-code` / `lint:invariants` / `lint:unref` / `lint:fix-evidence`（110 条）/ `version:check` 全绿
- ℹ️ **边界（如实）** - `resetDiminishingReturns` 只复位**连续性**：真递减时 `_observeRound` 的早退仍**先于** `persistMessages`（**既有行为，本批明确出界**，未做）；`streamMessageToolLoopContext` 的 `as unknown` 类型盲区仍 parked；E2E-2 仍待定。`FEATURE_BUDGET_SUSPEND_RESUME` 依用户裁定「补齐后再启用」—— 本批次完成即具备启用条件

#### v0.4.79 (2026-10-13)
长程任务「预算挂起—续跑」收尾批次：查询面可见性 + taor 链真实 E2E（含 B3 续跑短路修复）

- ✅ **A1 挂起检查点可见性修复（不受开关门控）** - `GET /v1/sessions/:id/checkpoints/latest`（`app/src/infrastructure/http/handlers/chat-handlers.ts`）原仅以 `checkpoint.messages.length > 0` 判可用；而**轮首撞限**（尚未完成任何工具）时 `StreamingAutoCheckpoint.suspend` 落的是**空消息快照**（真实载荷在 `metadata.budgetSuspend`/`pendingToolCalls`）⇒ 把一个真实挂起**误报为** `checkpointAvailable:false`（真实 E2E 实证，spec §6.5 查询面缺口）。**修法**：判据在**端点侧**区分（带 `metadata.budgetSuspend` 标记者即使消息为空也如实可见，并如实暴露 `label`），**不动** `StreamingAutoCheckpoint.restore()` 的 `META_KEY='streamingAutoCheckpoint'` 可续跑过滤（二者判据必须不同）
- ✅ **A2 新增只读挂起清单查询面** - `GET /v1/cost/daily-budget/suspend`（`daily-budget-handlers.ts` + `routes/cost-channel-routes.ts`，经 `@modules/query` 桶动态取 `getBudgetSuspendCoordinator` 守 R00-001/R03-002）暴露协调器 `list()`：`{ sessions:[{sessionId,chain,suspendedAt,reason,expired,checkpointRef}], count }`；`expired` 由协调器按 `SUSPEND_TTL_MS`(24h) **现算**（不复制判据）；**不受 `FEATURE_BUDGET_SUSPEND_RESUME` 门控**（无挂起 ⇒ 空数组，开关关时亦可查，便于运维）
- ✅ **B1+B2 taor（batch）链真实入口与 E2E** - 真实入口实证：非流式 `POST /v1/chat/completions`（`stream:false`）→ `CoreAPIImpl.chat` → `ChatManager.sendMessage` → `ChatOrchestrator.sendMessage`（`shouldUseTAORLoop` 恒真）→ `getOrCreateTAORLoop` 委托 `runCollect`；撞限闸门 = `TAORLoop.beforeReasoning` 的 `getDailyBudget().canExecute()===false`。真实 E2E（`--http-only` + 开关开 + 真实 LLM）：`TAOR loop started` → `Checkpoint saved {type:'budget_suspend'}` → `budgetSuspend:suspended{chain:'taor',reason:'daily_budget_exhausted'}`，查询面如实列出；**重启负向通过** —— 启动扫描**只登记**（`reason:'restored_budget_suspend'`）**不自动续跑**（重启日志无 `委托 TAORLoop`/`Resumed from checkpoint`）
- ✅ **B3-1 唤醒后不真正续跑根因修复（不受开关门控）** - 根因：`TAORLoop.resumeFromCheckpoint`（`TAORLoop.ts:1528`）未清除挂起时 `beforeReasoning` 置的 `stopped=true`，而唤醒路径为保住恢复态**刻意跳过 `reset()`**（G-T3-1）⇒ 首个 seeded ACT 的 `shouldContinue` 判「有工具调用但被判不继续」⇒ 工具被静默丢弃。**修法**：恢复时 `this.stopped = false`（**净零行**守 R04-001：`TAORLoop.ts` 仍 2000 行）；回归 `app/tests/query/taorResumeClearsStopped.test.ts`（先红后绿）。修复后真实复测：至少一个 taor 会话 `budgetSuspend:resumed` + `resume_summary{woken:[SID]}` 且**新增真实工具结果消息**（真的续跑）
- ✅ **回归与门禁** - 新增 `tests/http/latestCheckpointSuspend.contract.test.ts`（4 例）+ `tests/http/dailyBudgetSuspend.contract.test.ts`（5 例）+ `tests/query/taorResumeClearsStopped.test.ts`（1 例，TDD 先红后绿）；`typecheck` 0 错；`lint:arch` 0 错；`lint:size` 0 错（TAORLoop 2000）；相关测试 **502 pass / 1 fail**（该 1 fail 为**环境型**：`dailyBudgetSingleton` 的 env 覆盖断言被持久化配置 `costControl.dailyTokenBudget` 遮蔽，与代码改动无关）
- ⚠️ **未修（如实，开放）** - **B3-2**：taor 恢复轮可被 `TAORLoop._observeRound` 的 `this.dailyBudget.checkDiminishingReturns()`（`TAORLoop.ts:1187-1195`）以 `diminishing_returns` 提前终止，且该早退**先于** `persistMessages` ⇒ 续跑落空；根因 = 跳过 `reset()` 后 loop-local `dailyBudget` 的收益递减连续性跨挂起边界残留（涉「`dailyBudget` 跨 run 保留」既有决策，属设计取舍）。**B3-3**：唤醒端口惰性装配（`_ensureBudgetSuspendResumeInstalled` 仅在 `sendMessage`/`streamMessage`）⇒ 重启后未先发消息即点放行则不唤醒。⇒ **taor 链 E2E 记为部分通过**（挂起/登记/负向通过，续跑对至少一会话成立但不稳定）。开关仍**默认关**

#### v0.4.78 (2026-10-13)

长程任务「预算挂起—续跑」：真实端到端复测修复（E2E-1 会话锁泄漏，唤醒从此真的续跑）

- ✅ **E2E-1 根因修复（不受开关门控）** - 真实端到端手测（`--http-only` + `FEATURE_BUDGET_SUSPEND_RESUME=true` + 真实 LLM）证实：挂起成功、**唤醒永远失败** —— `resumeSuspendedSession: 流式重发失败，保留挂起 {error:"上一条回复仍在生成中（已执行约 0 秒…）"}`，45s 后仍未恢复；再次唤醒则 `SimpleMutex: acquire timeout after 30000ms`。**根因**：`ChatManager.resumeStream` 的 `mutex.release()` **只覆盖工具循环那一段的 `try/finally`**，而 `StreamingAutoCheckpoint.restore()` 抛错与「无可用检查点 ⇒ yield error + return」两个出口都落在该 `try` **之前** ⇒ 会话互斥锁**永久泄漏** ⇒ `getHeldDurationMs() > 0` 使 `ChatOrchestrator.sendMessage` 的在飞守卫（`ChatOrchestrator.ts:681-686`，文案 `上一条回复仍在生成中…`）**永久**判「生成中」⇒ C1 的「重发一轮」被挡下。**修复**：把 `try` 前移到 `acquire()` 之后，使 `release` 覆盖 `acquire` 之后的**全部出口**（release 仍只有**唯一一处** = 最外层 `finally`，不引入双重 release）。**既有 `POST /v1/sessions/:id/resume`（用户手动续跑）同路径受益** —— 该路径此前也会把会话锁泄漏成「永久生成中」
- ✅ **回归测试（3 例，含反证）** - `app/tests/chat/budgetSuspendStream.test.ts` 新增 `E2E-1` 组：① 无可用检查点时真实 `resumeStream` 跑完后会话锁必须已释放（判据用 `acquire(0)` 而非 `getHeldDurationMs()`，后者有毫秒粒度假绿）；② 真实 `resumeStream` + 唤醒 ⇒ 真的重发一轮（返回 `true`、执行入口恰 1 次）且不残留锁；③ **负向**：会话锁被真实持有时同会话再发送仍被守卫快速失败挡下（防"一刀切绕过守卫"）。**反证**：以 `git stash` 退回修复前，①② 均以 `SimpleMutex: acquire timeout after 0ms` 失败、③ 恒绿 ⇒ 该组测试确能捕获本缺陷
- ✅ **真实验收（§6.8，`e2eVerified` 转 true）** - 修后复测全链通过：`reActLoop:daily_budget_exhausted{iteration:0}` → `budgetSuspend:suspended{chain:'stream'}` →（放行 `boost`）→ `budgetSuspend:resumed{kind:'boost'}` + `resume_summary{woken:[<SID>]}` → **该会话消息数 2 → 6**（新增续跑提示 user 消息 + 新 assistant + 2 条 tool 结果）。**负向**：真实并发双发仍被守卫挡下（日志 `[chat] 上一条回复仍在生成中…`）。开关仍**默认关**（关时零行为变更）
- ℹ️ **边界（如实）** - **E2E-2（开放）**：首轮观测「第二次 `applyRelief(boost)` 未再次触发唤醒」本次**未复现**（日志可见第二次唤醒尝试 ⇒ 原观测系被泄漏锁阻塞后的次生表现），仍列为开放判据。文档/台账：`.trae/specs/long-task-suspend-resume.md` v1.4（§0/§3-D7/§6.8）、`fix-evidence-registry.json` `BUDGET-SUSPEND-RESUME`（⑧⑨）、修复报告 `.superpowers/sdd/budget-suspend-resume/e2e1-fix-report.md`

#### v0.4.77 (2026-10-11)

**工具治理四阶段落地（D1–D11 / G1–G22 · 含 G18 上帝对象拆分）+ Token 日限额 R16 收口 + 边界收口批次（B2–B6）**

- ✅ **工具治理阶段 1–4（D1–D11 裁定落地）** - **阶段 1**：bash **硬拦截层恒执行**（不受灰度开关影响）+ 审批快照统一口径；新增 `tools/bash/commandNormalization`（`raw/preprocessed/normalized/paths/baseCommand` **单一事实源** —— preprocessed→spawn、normalized→哈希与展示）；`toolCallId` 熵 + `tool_calls` 唯一约束；删死常量 `BashOutputSchema`、`settleToolCall` 改可等待。**阶段 2**：工具调用状态语义化（`TOOL_CALL_STATUSES` + 转移表 + 读回边界校验）；取消全链路（MCP `callTool` / WebFetch 接 `AbortSignal.any`）；契约与清单门禁（`TOOL_FLAG_KEYS` / 工具类型 shim 守卫 / `deriveNamespaceFamilies`）；可观测性 `tools/monitoring/ToolMetrics`（`tools.invocation.*` / `tools.schema.*`，桥接 OTel）。**阶段 3**：结构治理死桩清理（4 个恒 `null` 注册入口 + 实现 + `WORKFLOW_SCRIPTS`/`ENABLE_WORKFLOWS` 死特性位）；ON_DEMAND 触发路径**零消费者**登记（G-C5，裁定「登记不删」）。**阶段 4**：**D1** `feature()` **三层优先**（`FEATURE_*` env → `BUILD_VARIANT_FLAGS` → 静态兜底）· **D2** 权限未注入 **fail-fast**（`assertPermissionInjected`，`NODE_ENV=test` 保留 fail-open）· **D3** `unknown` 工具调用复用 Inbox 审批通道 · **D5** 工具能力契约 + 渐进棘轮（`toolCapability` + `lint-tool-schema`）· **D6** 恢复两步同事务（`ExecutionStore.transaction()`）· **D7** VFS 文件类工具**默认不注册**（消除双轨）
- ✅ **G18 上帝对象拆分（零行为变更）** - `ToolFactory.ts` **1030 → 112** 行：**注册表驱动**（`factories/builtinToolRegistry` = 80 条 `name→thunk` **唯一来源** + `BuiltinToolFactoryKey` 字面量联合），`ToolManagerUtils` 的 ~80 处 loader 改 `byKey(...)`（语义逐字等价），新增**注册表↔loader 一致性门禁**（含负向夹具自证）；`BashTool.ts` **1027 → 696** 行：抽出 `bashCommandPolicy` / `bashOutputTruncate` / `bashSecurityGate` 三个内聚模块，`execute` **≈440 行 / 复杂度 52 → ≈184 行 / < 40**（安全门以命名消歧 `checkBashDangerousCommand` 保持纵深防御，不归并）；顺带外移 S2-6「工具集选择 + 工具面观测」内联块为 `chat/orchestrator/streamMessageToolSelectionFlow.ts`，并按门禁要求**下调棘轮基线**（`runStreamMessage` 2203→**2167** / 文件 2380→**2345** / 复杂度 262→**248**）
- ✅ **工具名单一来源（D11-B / G5）** - 新增 `tools/toolNameConstants.ts`（**90 项** = 73 生效名 + 17 flag-gated 条件名），工具名**唯一来源**；59 个工具类 `name = '...'` → 常量引用（**值不变 ⇒ 行为等价**）；`toolNameLists.test.ts` 声明面改读常量表（兼闭「声明了却无 loader」盲区）+ 补齐 **G5 双向门禁**（生效面 ⊆ 声明面；差额 = 17 项已知条件工具集）；`gen-tool-names.ts` 可列被排除名（台账 D-40/D-41 闭合）；生成物 `toolNames.generated.ts` 同步（75 名）
- ✅ **变体链路 CI 矩阵（S3-1 / G2 / G3）** - `scripts/build-variant.ts` 正名为「变体 flags 生成（不做编译）」，消除"构建变体"歧义；`ci.yml` 新增 `variant-check` 作业（`matrix.variant=[core, coding, enterprise]`，每变体 生成 `BUILD_VARIANT_FLAGS` → `typecheck` → 跑工具面/契约门禁，注入 `LIRI_BUILD_VARIANT`、不跑全量）；`src/core/buildVariantFlags.ts` 按声明默认变体重生成（消费者见 D1 三层优先）
- ✅ **工具治理证据与棘轮登记（S3-4 / G12 / G-C5 / D8–D10）** - `fix-evidence-registry.json` + `修复证据登记.md` 新增/升级 `TOOLGOV-*`（S1-1..S3-2 / GATE-SELFPROOF / DOC-INTEGRITY / D1–D11 / G18 / G-C5），`lint:fix-evidence` **85 条**自洽；S3-4 文档完整性复核（`workflow-*` 家族 4 处「已完成」逐条回仓核验、**纠正 1 处假闭环**）；`default-off-switches-review-gates.md` 补 G12 登记；`unknown-tool-call-recovery.md` 增 §6（D9 口径）；新增 `.trae/specs/tool-quota-and-async-tool-adapter.md`（D8 独立立项）
- ✅ **Token 日限额 R16 收口（阶段 1–5）** - 修复「重启绕过 / 不可配置 / 不可观测 / 日界错位 / 死配置」五类缺口：用量状态落盘 `~/.pyapp/data/daily-budget-state.json`（1s 去抖 + 启动恢复），日界由 UTC 改**本地时区**（读/写两侧一致）；上限/阈值**单一事实来源**（`costControl.dailyTokenBudget` ＞ env ＞ 常量，运行期热更新）；新增 `GET/PUT /v1/cost/daily-budget`（+ reset / kill-switch，边界 fail-loud，变更经 SSE `cost:dailyBudgetUpdated` 广播）；前端「日限额」tab（`DailyBudgetPanel`）+ zh/en i18n；死配置治理（`workspace.costControl` 停止播种并逐字段标注、`/cost/budget` 标注 USD 口径）、`CostBudgetManager.getPeriodCost` 改按周期起点查 `CostRecordRepository`（原返回全时累计 ⇒ daily/weekly/monthly 三档失真）；LRO-17 长程任务日限额中止补 warn 日志
- ✅ **隔离测试 `LIRI_*` 环境变量跨文件泄漏修复** - `resolveDataDir` 中 `LIRI_DATA_DIR` **优先于** `setUserDataDirOverride`，且 bun test 同进程按文件运行 ⇒ 设置后不还原会把同进程**后续**测试文件落盘/读盘重定向（实测假红：`pdca-list` + `dailyBudgetPersistence` 2 fail）⇒ 修 5 处（记录原值 + `afterAll/afterEach` 还原）；判定性验证：临时移除守护后由 2 fail → **12 pass / 0 fail**
- ✅ **测试环境变量归一（本机/CI 假红修复）** - `app/.env` 含 `NODE_ENV=development`；`bun run <script>` 会自动加载 `.env` 并被其 spawn 的 `bun test` **继承**（Bun 仅在 `NODE_ENV` 未设置时才默认 `'test'`）⇒ `bun run test:guarded`（CI 的 `bun run ci` 末步）与 `.github/workflows/ci.yml`（先 `cp .env.example .env`）下，测试进程实为 `NODE_ENV=development`，与裸 `bun test` 的 `'test'` 不一致 ⇒ D2 权限注入 fail-fast 断言误触发，致 `ChatManagerHangupTimeout.test.ts` **2 例假红**（裸 `bun test` 不复现）。处置：`bunfig.toml` preload 强制 `process.env.NODE_ENV='test'`，对齐 CI 口径、消除环境漂移
- ℹ️ **边界收口批次（`.trae/specs/boundary-convergence-plan.md`）—— B2 测试补齐 · B3 性能收口 · B4 工程卫生 · B5 Q4 复评批 · B6 存量债**

- ✅ **B2（2026-10-10）`INV-EXEC-006` client 执行路径 handler 级用例补齐** - 新增 `app/tests/http/chatStreamExecutionHandler.test.ts`（4 例：写前记账 / 终态结算 / 断开 `FAILED: client_disconnected` / 开关关守卫）⇒ 不变量 `partial → verified`；翻转 `CLIENT_STREAM_EXECUTION` 的**前置条件已满足**（翻转仍须 `default-off-switches-review-gates.md §2.3` 复评 + 用户裁定）
- ✅ **B3（2026-10-10）`events.idx` 缺失/落后时的续页线性续扫（L-9 残余 / P0-5）** - `EventLogStorage` 新增**续页锚点** `readBoundary`（页满时记「下一个未处理行的 UTF-8 字节起点」，口径与 append 折叠 `.idx` 同源）；idx 未覆盖时按锚点 seek 续扫替代"每页从 offset 0 重扫"，`isLineStart` 行边界校验兜底（不通过即回退全扫 ⇒ **只慢不错**）。新增单测 3 例；`scripts/bench-longrun.ts` 追加 **F1b** 回退路径对照（页粒度 1000 + 快照热窗口 100）⇒ 5 万事件 ×10 趋势 **×30.6 → ×17.6**（绝对 1743.7ms → 646.5ms）
- ✅ **B4（2026-10-10）工程卫生：`MODE-A9` 验收口径就地收口 + 去 `any` 类型化专项 spec 立项（不动码）** - `MODE-A9`（未提交改动堆积）由 `fixed=false`（原 `reopenWhen=n/a`）收口为**每版复查项**：验收口径 = `main...origin/main` 同步 **且** 工作区无未提交改动（registry 改 `fixed/coded=true`，`code` 指向计划 §2-P1-4；`testVerified=false` —— 非代码缺陷、无自动化，如实）；⚠️ **本次收口快照工作区尚未干净**（B2/B3 待授权提交）⇒ 依赖提交授权。P1-2：新建 1 页 spec `.trae/specs/event-payload-type-specialization.md`（口径复核 + 域分布 + 分批 S1–S5 + 编译期穷尽断言收益），**未动产品代码**
- ✅ **B5（2026-10-11）Q4 复评批：9 项季度项逐条读观测 ⇒ 全部「维持」+ 台账 `postReleaseReviewed` 0 → 43** - 逐项读数落 `.trae/specs/default-off-switches-review-gates.md` **§2.4**（`BASH_INTERPRETER_GUARD` · `BASH_APPROVAL_STRICT` · `EXECUTION_TWO_PHASE_CANCEL` · `CODE_RUN_DEEP_SCAN_STRICT` · `CLIENT_STREAM_EXECUTION` · `PLAN-P2-4` ＋ `OUTPUT_GUARD`①② / `RESOURCE_GOVERNOR`① / `SELF_VERIFY_PATTERN`①）。**观测读数（本机运行期数据）**：`data/logs/app.log`(+16 轮转) 中 `"level":"debug"` ≈ **0 条** ⇒ O1-B2/O1-B3/O2/O4 四个 `logger.debug` 观测点**零采样**（§7-4 已登记风险的实际发生，故记「无可判定样本」而非「信号为零」）；O5 `pattern/decision` 事件实测 **1 条**（`selected='competitive_strategy'`），`selected=='self_verify'` = **0 会话**；`OUTPUT_GUARD` 接入点 **2**（未达 ≥4）/ 改写文件 **47**（未达 ≤5）；`CODE_RUN_DEEP_SCAN_STRICT` 的 `ran` 比例不可计算（同名不同义的 `scanStatus` 已辨析）。**未翻转任何默认值**（`featureFlags.ts` 逐字未动，R07-2）。台账 `postReleaseReviewed` **43/58 置 `true`**（= 全部 `testVerified=true` 条目；判据 = 实现与测试文件均已入发布 tag），其余 15 条因 `testVerified=false` 如实保持 `false`
- ✅ **B6（2026-10-11）存量债：`L-12.1` 干净环境 e2e 复核 + `runStreamMessage` 拆分残余原因登记（零代码）** - ① **P1-1 维持现状 + 触发条件登记**：复核 `.github/workflows/release.yml` `Smoke test (clean env)`（L281–L337）对**真实 zip 产物**在全新临时目录执行「[1/4] 解包 → [2/4] 关键路径断言 → [3/4] 首启 `healthcheck`（退出码 0 + `LIRI_HEALTHCHECK_OK` + `version: ${VER}` + `LIRI_HOME` 隔离 + **包内零写入 diff 断言**）→ [4/4] 清理并断言临时目录消失」⇒ **便携面已覆盖「解包/首启/清理」三态**，**不宣称**「干净环境安装→启动→卸载 e2e」已完成；未做面 = 产品级卸载断言（当前产物为**便携 zip、无安装器**，卸载语义 = 删除目录）与容器化/安装器路径（**需容器/打包机**）⇒ **有意不做**（CS03，不建投机 spec），触发条件维持「需要发行可信度证据时；打包机/容器可用时」。② **P1-3 拆分残余原因登记**：落 `.trae/specs/file-size-debt-partition-plan.md` **§48**（实测 `continue;`=4 / `break;`=5 / 行首 `yield`=24；`functionLines` **2203** / 文件 **2380** / 复杂度 **262**）—— 残余为**控制流关键字不可搬运**（外移即割裂控制流，`yield` 外移产生二层生成器属行为变更），再抽唯一路径是**状态机化**（收益未证 ⇒ 不排期）。两项均**未动产品代码**
- ✅ **质量** - `typecheck`（app 3 tsconfig + client）**0** · **`bun run test:guarded` exit 0**（**5868 pass / 42 skip / 0 fail**，118.7s）· `lint:arch` 违规 **0**（4 基线警告）· `lint:fn-size`（未增长）/ `lint:fix-evidence`（85 条）/ `lint:doc-code`（38 断言）/ `lint:invariants` / `lint:complexity` / `lint:no-module-mock` ✅ · `version:check` ✅ · 本版区间 `v0.4.76..v0.4.77` 共 **14** 次实质提交（7 docs / 3 feat / 2 test / 1 perf / 1 refactor）
- ℹ️ **边界（如实）** - 未翻转任何默认开关（`featureFlags.ts` 逐字未动，R07-2）；ON_DEMAND 触发路径**零消费者**登记不删（G-C5）；D7 下 VFS 文件类工具**默认不注册**（`VFS_ENABLED` 默认 false）；`runStreamMessage` 拆分残余受 `continue`/`break`/`yield` 控制流关键字约束（再抽唯一路径为状态机化，收益未证 ⇒ 不排期）；D2 权限注入断言以 `process.env.NODE_ENV` 判别测试环境（见「测试环境变量归一」）

#### v0.4.76 (2026-10-10)

**可靠性收口二批：执行内核崩溃恢复闭环（P0）+ 工程护栏（P1）+ 编排拆分与机器守卫（P2）+ 门禁治理基座 + 统一检索边界收敛**

- ✅ **P0 执行内核：崩溃恢复闭环（5 项）** - 新增两个**默认关**灰度开关 `CODE_RUN_DEEP_SCAN_STRICT`（深扫未完成/失败 ⇒ fail-closed 拒绝）/ `CLIENT_STREAM_EXECUTION`（客户端流式接入执行生命周期），安全开关表 **15 → 17** 项并同步 `lint:doc-code` 断言与 `SAFETY_SWITCHES` 契约测试；客户端 `/v1/chat/stream` SSE 入口接入 Execution（`acquire` 注入 `executionId`、工具执行前写前记账 + fail-closed、终态 `complete`/`fail`、断开 ⇒ `FAILED: client_disconnected`，fencing 下幂等）；`recover()` 返回 `unknownToolCalls` 并新增 `toolEffects.resolveToolRecoveryPolicy` ⇒ **非幂等 / 未声明工具禁止自动重放**（对应 `INV-RECOVERY-003`）；深扫状态纳入统一四态 `verdict`（新增 `security/decision.ts` + `DeepScanStatus` + 单调合并），**消除 `INDETERMINATE → ALLOW` 折叠**（对应 `INV-SEC-004`）；新增进程崩溃注入真负向夹具（对应 `INV-EXEC-005` / `INV-RECOVERY-001`）
- ✅ **P1 工程护栏（4 项）** - bash 子进程最终环境收敛为**唯一构造点** `buildBashSpawnEnv`（父进程敏感键 + 调用方同策略清洗 + 执行控制键剥离 ⇒ 调用方无法改写执行语义），跨层一致性测试断言「env 清洗 → 最终 spawn」全链；沙箱**真负向**纳入 CI **必需**门禁（`ci.yml` 新增 `sandbox-negative` job：Linux + `landlock-run` helper，`SANDBOX_NEGATIVE_REQUIRE=1` ⇒ **环境不满足即失败，不得静默跳过**，R14 质量摘要同步该层）；新增 SPI **装配顺序守卫** `core/spi/wiringGuard.ts`（显式依赖声明 + 注册期断言 ⇒ 顺序错误**启动即失败**并给出可读原因，不晚失败、不静默降级，对应 `INV-ARCH-001`）；修复**跨文件全局污染**（L-23：6 个 ai/providers 与 llama 测试的 `globalThis.fetch` 快照还原、2 处 `mock.module` 泄漏改走真实 DI 缝）并新增**零豁免**门禁 `lint:no-module-mock`（棘轮只允许减少）
- ✅ **P2 拆分与机器守卫（4 项）** - 流式编排逐阶段拆分：`runStreamMessage` **2532 → 2203** 行、文件 **2684 → 2380** 行、圈复杂度 **309 → 262**，新增 11 个 `streamMessage*.ts` 阶段模块与 15 个阶段用例；MCP **双轨子进程边界**裁定 + 机器守卫（SDK 轨**有意不并入**自研追踪器 —— SDK 只公开 pid、PID 快照存在复用误杀风险，由其 `closeAll()` 承接）；模式闭环冻结为 `patternAssemblerClosure` 守卫（2 ready + 3 unavailable）；门禁自证扩展（跳过项**风险分级** S4/S5 + 状态机与安全链**控制样例**，防判分器恒真）
- ✅ **门禁与治理基座（4 项）** - 新增 `lint:invariants` / `lint:entrypoints` / `lint:fix-evidence` / `lint:fn-size` / `lint:complexity` **五个门禁脚本 + 自证测试**并接入 `ci` 链，新增 `.github/workflows/doc-gate.yml`（**不设** `paths-ignore`，承接纯文档/规则/spec 改动）；`.trae/architecture/` **6 文件入库**（门禁基线缺失即 `exit 1`，不入库则干净检出推送即红）；`lint:fix-evidence` 数据源由 `dev_docs/error_repairs/` 迁至 `.trae/architecture/`（`git mv` 保留历史）；`dev_docs/` **全量移出版本控制**（`git rm -r --cached`，工作区文件保留、不删除；撤销 `.gitignore` 中全部反排除例外）
- ✅ **统一检索边界收敛（随本版实际发布）** - v0.4.75 段「✅ 边界收敛（同日补做）」的两条（`mergeResults` 对外值域归一回 `(0,1]`、重叠命中 `'hybrid'`）**随本版发布**；登记 `.trae/architecture/` `RRF-CONV` 与 `INV-KB-001`，`.trae/specs/unified-rrf-retrieval.md` 升 **v1.2**（测试 +11 例）。两条边界的详细描述见本文件 **v0.4.75 段**（不在此重复）
- ✅ **质量** - `typecheck`（app 3 tsconfig + client）**0** · **`bun run ci` exit 0**（含 `test:guarded` **5736 pass / 42 skip / 0 fail**）· `lint:arch` 违规 **0**（4 基线警告）· `lint:invariants`（17 条 · gap 0）/ `lint:fix-evidence`（58 条）/ `lint:fn-size` / `lint:complexity` / `lint:no-module-mock` / `lint:doc-code`（38 断言）/ `version:check` ✅ · 本版区间 `v0.4.75..v0.4.76` 共 **19** 次实质提交
- ℹ️ **边界（如实）** - 两个新增开关**默认关**（零行为变更），翻转须经用户裁定；P2-1 拆分后 S2/S3/S5 多数动作受 `continue`/`break`/`yield` 语法约束**仍留编排函数**（判据/载荷/装配单元已抽净）；`dev_docs/` 移出版本控制后，仓内溯源引用（源码注释 / spec 依据 / 门禁文案）在 GitHub 上**成死链**（仅本地可解析；已核实无脚本读盘 ⇒ 不影响构建与门禁）—— **订正（2026-10-10）**：原文称「约 **68** 处」与实测不符，`git grep -o -- "dev_docs/" ":!dev_docs"` 实测 **399 次 / 241 文件**（根级 `dev_docs/` 394 + `app/docs/dev_docs/` 5，两者**均 0 入库**）⇒ 以实测为准；该数字为**截至本版快照**（出库后仍有新增引用，非固定值）。收口计划见 `.trae/specs/boundary-convergence-plan.md` §4-A；跨平台（Windows/macOS）**无强隔离后端**仍属边界（见 `.trae/architecture/invariants.md` §6，P2-4）；未建 `VfsKernel`、未改 provider / 通道契约

---

#### v0.4.75 (2026-10-10)

**统一检索 RRF 收敛：单一零拷贝实现 + `mergeResults` 由"名义 RRF"改为真 RRF（用户覆盖裁定）**

- ✅ **单一事实源（零拷贝 / 延迟物化）** - 新增 `app/src/utils/rrf.ts`：`reciprocalRankFusion`（k 缺省 60，支持加权）。融合期只累计「键 → {分数, 引用}」，**Top-K 截断后才物化** ⇒ 分配量 **O(N) → O(K)**；排序为 `score` 降序 + `key` 升序（确定性）
- ✅ **记忆侧接入** - `memory/services/UnifiedSearchService.search()` 改调该 util（缺省 k=60，与旧 `1/(60+rank+1)` **数值等价**），删除其本地 `RRF_K`
- ✅ **`KnowledgeRouter.mergeResults` 改真 RRF（行为变更，用户明确选择）** - 原文注释自称 RRF、**实为归一化加权平均**；现按 `score(d) = kw/(k+rank_kw+1) + sm/(k+rank_sm+1)`（k=60）融合，`prefer:'last'` 保留「语义 snippet 覆盖」的可见行为；并列规则补 `docPath` 末位；删除改造后**无消费者**的 `normalizeKeywordResults`
- ✅ **下游展示配套订正** - `/knowledge search` 原按绝对分 `≥0.7/≥0.4` 分档 `🔥/⭐/📄`，RRF 绝对值远小于 1 ⇒ 会**恒落 📄**；改按**本页最高分归一化**后再分档
- ✅ **删死字段（独立提交，CD06）** - `knowledge/search/UnifiedSearchService.ts` 的 `RRF_K` 全仓仅**声明处 1 命中**（零消费者）⇒ 删除，并订正「可进行二次 RRF 重排序」的失实 docstring；提交信息含六步核查结论与回滚路径
- ✅ **质量** - `typecheck`（app 3 tsconfig + client）**0** · **`bun run ci` exit 0**（含 `test:guarded` **5736 pass / 42 skip / 0 fail**）· `lint:arch` 违规 **0**（4 基线警告）· `lint:invariants` / `lint:fix-evidence` / `lint:doc-code` / `lint:fn-size` / `lint:complexity` / `lint:no-module-mock` ✅ · 新增定向用例 `tests/utils/rrf.test.ts`（12 + **5** 例）+ `tests/memory/unifiedSearchRrf.test.ts`（6 例）+ `src/knowledge/__tests__/KnowledgeRouter.test.ts`（**+6** 例）
- ✅ **边界收敛（同日补做）** - ① `mergeResults` 对外 `score` 原为原始 RRF 和 `Σw/(k+rank+1)`（缺省 ≈ `1/61` ⇒ 2 位小数下只剩 `0.00~0.02` 三档，下游恒显 "2%" / 配色恒灰）⇒ 改为按 `rrfMaxScore([kw,sm]) = Σw/(k+1)` 归一化，值域回落 **`(0,1]`**（精度 4 位小数、**保序**，上界 ≤0 时不归一化以杜绝 NaN）；② 重叠文档 `matchType` 由 `keyword`/`semantic` 收敛为 **`'hybrid'`**（server/client union + `SearchHitCard` 两处 `Record` + zh/en i18n 同批；单路命中保留原值）。`minScore` / `semanticThreshold` 仍作用于融合**前**（不变）。测试 +11 例（`rrfMaxScore` 上界 5 · `KnowledgeRouter` 归一化/`hybrid`/负权重 6）
- ℹ️ **边界（如实）** - 未建 `VfsKernel`、未改 provider / 通道契约（外部建议所引路径与 API 经取证在仓内**不存在**）

---

#### v0.4.74 (2026-10-10)

**A2A/MCP 进程级侧车隔离（① P0–P3）+ 语法觉知型上下文闭环引擎（② P0–P2，Rust FFI）+ 第九轮审查遗留项收口（专项 A #7 / §九 / 专项 B §十七-5 / 专项 C）**

- ✅ **① MCP stdio 子进程受管化（P0）** - 孤儿兜底 `killOrphanedProcesses(true)` **接入 `mcpSystem.cleanup()` + SIGINT/SIGTERM**（此前**全仓零调用点** ⇒ 名义存在但从未启用）；修正 2 处既有缺陷（接线后成真实路径）：`twoPhaseKill` 的 **TDZ**（`kill('SIGTERM')` 同步抛错 ⇒ `ReferenceError`）· 孤儿表仅存 PID ⇒ `activeProcesses.find` 恒空 ⇒ **永不回收**（改 `Map<pid, TrackedProcess>` 保留引用）
- ✅ **① 轻量 IPC 基座收敛（P1）** - 新增**单一契约** `utils/sidecarIpc.ts`（协议版本 / 帧类型 / 换行分帧 / 就绪握手 / major 兼容 / 心跳）；`ai/python/JsonRpcBridge` **收敛消费**（分帧改 `encode/decodeFrame` + 版本再导出 + startup 帧**版本协商** fail-closed）；**未新建第三套**（`daemon/IPCService` 属控制面，不并入）
- ✅ **① A2A 只读发现面外置（P2）** - 纯发现面 `infrastructure/http/a2a/discoverySurface.ts`（卡片 / 健康 / ETag / 405 / 503）· **独立 sidecar 进程**（自有端口 `A2A_DISCOVERY_PORT`、P1 契约、同源鉴权 `isA2AAuthorized`）· 开关默认关的监督器（就绪握手 / 快照推送 / 有界重启）· 接入 `LocalHTTPService` 生命周期；**实测** 200 / 304 / 401
- ✅ **① A2A 委派执行进程化（P3）** - 导出**单一实现** `runA2ADelegation`（复用 `runDelegation`）；监督器**反向 RPC** `a2a.delegate`；sidecar `POST /v1/a2a/tasks` **经 IPC 转发回主进程内核**（**不自建 CoreAPI**，遵守 `channel-process-isolation §2-#3`）；**实测** 真子进程端到端 200
- ✅ **② 语法觉知型上下文闭环（P0–P2）** - **P0** 单一结构切点 `utils/structureCut.ts`（括号 + 围栏感知；接线工具结果预览 + 通道分片，**默认不劣化**）· **P1** Rust `py_close_structure`（**词法级**括号栈 + 引号/注释感知，**零新 crate**；FFI 注册 + 三态降级桥）· **P2** 先建**截断级质量度量** `scripts/bench-truncation-closure.ts`（真实语料 321 文件：结构闭合率 **0%~6.4% → 100%**，代价少保留 1.6%~9.3%）⇒ 接线 Tier2 单条截断头部闭环（原生不可用 ⇒ 退回硬切）
- ✅ **第九轮审查遗留项收口** - 专项 A **#7 跨层安全回归**（`crossLayerSecurityConsistency.test.ts` 17 例；**当场发现并修复** `BashSecurityAnalyzer` 哨兵缺陷 —— 与缺陷 #1 同类，原生分析器**方才真正生效**）· **§九「沙箱执行」**（`spawnPathRestrictions.test.ts` 9 例）· 专项 B **§十七-5 恢复故障注入**（`recoveryFaultInjection.test.ts` 5 例）· **专项 C 8 项**（`specialCResilience.test.ts` 12 例）
- ✅ **质量** - `typecheck`（3 tsconfig）**0** · 相关套件全绿（`context/chat` 532 · `infrastructure/http`+`agent` 53 · `utils/ai` 253 · `execution`/`sandbox`/`security`/`tools`/`channels`/`services` 等）· `lint:arch` 违规 **0**（4 基线警告）· `eslint` / `lint:scripts` 干净
- ℹ️ **边界（如实）** - A2A sidecar 端口**独立于主进程**（单端口无法被两进程同时监听，无前置代理）；sidecar 委派端点**未在卡片广告**（卡片仍指向主进程 RPC）；A2A **JSON-RPC / SSE 面未搬运**；`killProcessTree` 未复用（`sandbox` 属 moduleRegistry 受管模块，跨层直连被拦）；**Tier3 无字符级截断**（P2 落点仅 Tier2 单条截断）；② P2 度量为**结构闭合**代理指标，非"语法幻觉下降"直接证明

---

#### v0.4.73 (2026-10-10)

**第九轮外部审查落地（专项 A 五缺陷 + §七 安全基线 + 专项 B 执行生命周期 B-01–B-05 及跨层改造）+ Rust SWC CallExpression 扫描器（FFI 贯通）+ 默认关开关触发条件治理**

- ✅ **专项 A（Bash/AST 安全，5 缺陷全修）** - ① `lazyInitNative` 哨兵 `=== undefined` **恒假** ⇒ 原生解析器**从未加载**（改三态 + `getBashAstStats()` 可观测）· ② TS `splitCommands` 不识别 `||` ⇒ `echo safe || rm -rf /` **绕过**（已修 + 转义判定）· ③ `normalizeCommand` 转小写/折叠引号内空白 ⇒ 语义不同命令**同 hash**（改引号感知状态机、**保留大小写**）· ④ AST 不确定（`too-complex`/`parse-unavailable`）**不失败关闭**（转**人工审批**）· ⑤ 调用方 `env` 可**覆盖**已剥离敏感项（新增 `sanitizeCallerEnv()` + 接线 + 留痕）
- ✅ **§七 安全开关基线** - `BASH_APPROVED_REVALIDATE` **默认 `false` → `true`（安全基线）**（其关闭时"已批准命令**跳过整套硬拦截**"风险最高）；R07-2 全链同步（`featureFlags` + `SAFETY_SWITCHES` 保 `def:true` **防静默翻回** + `project_rules §1.4` + 规则版本 7.23.0）；`BASH_INTERPRETER_GUARD` / `BASH_APPROVAL_STRICT` 维持灰度 + **启用/回滚条件/迁移期限** + `warnGraySecuritySwitchesOnce()` 一次性告警（§七 建议 1/3/4/5）
- ✅ **专项 B（执行生命周期 B-01–B-05）** - **B-01** 恢复 `kept` 不计入内存 ⇒ 可能并存**双 `RUNNING`**（新增 `foreignActive` 外部占用；**不盲目 `owner.set()`**，STALE 时解除 ⇒ 不永久锁死）· **B-02** 恢复两步间崩溃 ⇒ 工具调用**永久 `running`**（**倒序**：先标 `unknown` 再置 `STALE`，幂等收敛）· **B-03** `MAX(seq)+1` 并发竞争（按 `executionId` 串行化 + `(execution_id, seq)` 唯一索引兜底）· **B-04** `requestCancel()` 对 `QUEUED` **恒 false**（按状态分流：`QUEUED` ⇒ 直接 `CANCELLED`）· **B-05** 记账 fire-and-forget（新增**可等待** `beginToolCall()`）
- ✅ **B-05 跨层改造：`executionId` 下传工具执行者** - `ChatRequest.executionId`（已存在）→ `CoreAPIImpl.chatStream` 透传 → `StreamMessageOptions.executionId` → `ChatManager._sessionExecutionIds`（与 `_sessionAbortControllers` 同生命周期）⇒ **`ChatManager.executeTool` 执行前 `await beginToolCall()`，落盘失败即拒绝该工具**（**逐工具** fail-closed，底层 `svc.execute` **不被触达**）；记账收敛为**单一写入方**（Router 移除 chunk 观察式 begin/settle）
- ✅ **Rust SWC CallExpression 扫描器（覆盖 B7「不立项」裁定 —— 用户主动决策）** - 新 `app/native/src/js_ast.rs`：SWC 解析 TS/JS → `Visit` 遍历 `CallExpr` / `NewExpr` → 特征表（危险/可疑）→ C-ABI `py_scan_js_calls`；`index.js` FFI 注册 + `CodeRunner` 静态校验链第 5 步（原生不可用 ⇒ **降级跳过**，默认零行为变更）；**识别计算成员混淆** `globalThis['eval']`（TS 侧正则看不见）；`cargo test` **101 pass**（含 `js_ast` 14 例）
- ✅ **P0 触发条件补全与治理 + 清理登记** - O1–O5 观测点（3 新增 / 2 复用既有，**零行为变更**）· 新建单一事实源 `default-off-switches-review-gates.md`（默认关项"可观测信号 + 阈值 + 窗口 + 复评节奏"）· CI **登记完整性断言**（`lint:doc-code` 断言 **23 ⇒ 34**）· `project_rules §1.4` 增「触发条件（何时重开）」指针列；删除零消费预留端口 `ERROR_SERVICE_ID` · PDCA 启动扫描**不再静默跳过**可续跑任务 · `degrade` 复核判定**已由 `soft` 承担**（不新增第三模式）· Ch.16 / Ch.21 落 spec + 裁定（**未写代码**，理由在 spec）
- ✅ **质量** - `typecheck`（3 tsconfig）**0** · `tests/{execution,channels,chat}` **755 pass / 0 fail** · `tests/{tools,security,permission}` **788 pass / 0 fail** · `lint:arch` 违规 **0**（4 基线警告）· `lint:doc-code` ✅
- ⚠️ **未完成（如实登记）** - 专项 A **#7「跨层安全回归测试」**（Rust AST / TS 分析 / Guardrail / 审批 / 实际 spawn 的**最终决策一致性**）与 §九「**沙箱执行**」测试组**未做**；专项 B **§十七#5 故障注入**仅覆盖 B-02 的**调用顺序**断言（无真实崩溃注入）；**专项 C 的 8 项测试清单未做**（其 C-01/C-02/C-03 与 B-03/B-02/B-05 **同源、已修**；C-04/C-05 为审查明示的**待验证设计边界**，非确认缺陷）
- ℹ️ **边界** - 未做端到端沙箱攻击验证（与审查原文口径一致）；`executionId` 目前仅由**渠道 Router** 注入，client（`/v1/chat/stream`）路径未接入 Execution（不记账/不拒绝）

---

#### v0.4.72 (2026-10-09)

**第九轮外部审查「复查任务计划」R1–R18 落地 + 事件日志恢复超线性定位（L-9）+ 门禁/质量治理补强**

- ✅ **确定性缺陷与恢复语义（R1–R5）** - **R1** 统一 ID 熵源补齐（`generateId` 6→10 hex；`generateMessageId` / `generateAttachmentId` 7→10）· **R2** 沙箱能力矩阵 + **负向集成测试**（权限不足 / 并发隔离 / 越权读·写·子进程**真拦截**，3 文件 18 pass / 6 skip）· **R3** 崩溃窗口恢复：未结算工具调用标 **`unknown`**（不可知副作用不误判成败）+ 审计计数 · **R4** `messageRouter` 时序契约矩阵（6 契约）+ **去重键作用域收敛**（`渠道:发送者:messageId`，修**跨账号误去重**）· **R5** 门禁自证（违规控制样例 ⇒ 命中 `R00-001` 实为 warning ⇒ **已提升为 error**，零回归）
- ✅ **补证 / 补测（R6–R9）** - **R6** 多 Agent 状态所有权五问核查（**无新增缺口**，产出 1 守则 + 1 契约边界）· **R7** 压缩**语义保真** 6 维 + 派生性（7 pass）· **R8** 评测 **skip 分级**（26 位点 / `security·env·platform·perf·pending`）+ 判分器边界样例 · **R9** 长期运行与恢复基准（`scripts/bench-longrun.ts`：F1 恢复分布 / F2 并发加速比 / F3 长跑内存趋势）
- ✅ **治理 / 质量基础设施（R10–R14）** - **R10** 状态复杂度门禁（**最小启用** `complexity warn 40`；6 指标可行性矩阵，分支覆盖率因工具链不产出**不可行**）· **R11** 通道能力契约矩阵 **147 pass**（**命中真缺陷**：`msteams` `exportKey` 大小写漂移 ⇒ 通道永不注册，**已修**）· **R12** 依赖**许可证扫描**（`lint:license`，1335 依赖分级）+ CI 步骤 · **R13** 删除代码安全流程落为规则 **`code-deletion.md`（CD01–CD07）** · **R14** 质量指标**分层**（CI 摘要 5 层分列 · **不合成单一分数**）
- ✅ **谷歌输入补证（R15–R18）** - **R15** 自唤醒重启恢复：定位并修复**重启后重发链路失效**（`WakeStore` 内存索引未重建 ⇒ `fire()` 不续跑、`fired` 不幂等）· **R16** 每日 Token 预算**统一**（进程共享单例 + 记账收敛 + **原子预留** `reserveFor`/`settleFor` + 子代理/任务侧记账；预算仍建议式）· **R17** OTel 背压核查（`BatchSpanProcessor` 有界队列**已提供背压**；实测 ~1.46µs/span **无数量级回归** ⇒ 不优化）+ 清理 `OTelTracing` 陈旧死导入 · **R18** 压缩语法感知核查（粒度 = 消息/轮次，**不做代码字符切片**）+ 分片器**结构感知**（围栏成对 + 括号深度）+ 工具结果**安全预览**（行/块边界、围栏收尾）
- ✅ **L-9 事件日志恢复超线性定位** - 扫尺度 + 首页/续页分解，**证伪**原候选根因（`filterSnapshotEvents` 受 10K 热窗限 ⇒ **非主因**），定位主因 = 夹具绕过 append **缺 `events.idx`** ⇒ 续页从 0 重扫 ≈O(N²/PAGE)；`bench-longrun` 夹具**按 append 同义补写 idx** 后 F1 **×11.9 ✅ 近似线性**（旧 ×13.9~15.1 ⚠️）
- ✅ **质量** - `typecheck` **0** · 全量 **5414 pass / 42 skip / 0 fail** · `lint:arch` 违规 **0** · `lint:size` **0 错** · `lint:doc-code` ✅ · 新增门禁脚本 `lint:license` / `audit:complexity` / `bench:otel`（后两者非 CI 阻断）
- ⚠️ **登记（非阻断，待触发）** - `L-10` `runStreamMessage` 单函数复杂度 **309 / 2532 行**（待专项拆分）· `L-12.1` 干净环境「安装→启动→卸载」e2e（需容器 / 打包机）· `L-9` 残余：`events.idx` 缺失/落后时回退路径仍 ≈O(N²/PAGE)（真实暴露窄）

---

#### v0.4.71 (2026-10-09)

**沙箱回滚恢复与接线（S5/S1/S7）+ `messageRouter` 拆分达标（1290→816）+ 存量 lint 警告清零**

- ✅ **沙箱子系统恢复** - 回滚 v0.4.69 的三笔"死面清理"提交：恢复 24 个文件（`IsolationManager` / `EnhancedSandboxManager` / `PTYSandbox` / `SSHSandbox` / `docker/**` / `WorkspaceManager` / `ProcessRegistry` / `ResourceLimitManager` 等 + 5 项测试）并回滚 21 个存活文件的配套改动（SPI/HTTP handler/client/landlock）；同批**订正**因回滚被带回的失实陈述（`runWithLandlock` 接线落点、spec/台账）
- ✅ **沙箱接线（S5 / S1 / S7）** - **S5**：`runWithLandlock` 补齐 `maxBufferChars`（`appendWithinLimit` 软限）/ `timedOut` / `error` 三态，并**纠正**「spawn 错误误归因 exit 125」；bash 的默认 helper runner **改为委托** `runWithLandlock`（去重复；code_run 因需 **RPC 子进程句柄**保留自身 spawn）。**S1**：组合根启动期创建 `default` 工作区 ⇒ `ISandboxPort` 的 `hasWorkspacePermission` / `isWorkspacePermissionDenied` / `activeWorkspaceCount` 由 `config.sandbox.permissionLevel` **真实驱动**（此前恒取"工作区不存在"分支）。**S7**：bash（plain/landlock 两路径）与 code_run 在进程 spawn 处登记 `ProcessRegistry` ⇒ `GET /v1/sandbox/status` 的 `processStats` 由**恒空**转为真实；`ResourceLimitManager` 维持 D5「观测面」裁定（不接执行路径）
- ✅ **C3-S3 `messageRouter` 拆分（1290 → 816 行）** - 子 spec [`.trae/specs/message-router-split.md`](.trae/specs/message-router-split.md)：**S1** 外围迁出（契约/常量、串行化助手、帧验证、内容去重、文本审批、出站投递 → 6 个 <500 行子模块，`validateInboundFrame` 等经重导出保 API）；**S2** 流式消费循环迁出（`streamConsumption.ts`：空转计时器 / `requestCancel`+`abort` / `done` 分支 `finishExecution` / `tool_call` 记账 / 工具进度通知 / 长任务占位），**两段式取消的 `catch` 留原文件**保时序。`routeChannelMessage` **保留原文件**（R03-004 渠道入站唯一入口）
- ✅ **存量 lint 警告清零** - `bootstrap/*` · `compaction/*` · `tokenBudget/*` 共 **56 条 warning**（`no-unused-vars` ×44 / `no-explicit-any` ×12）人工清理（删死导入 / `_` 前缀 / 类型化）⇒ `bun run lint` **0 error / 0 warning**
- ✅ **质量** - `typecheck` **0** · 全量 **5178 pass / 36 skip / 0 fail** · `lint:arch` 违规 **0**（警告 4 = 基线）· `lint:size` **0 错**（`messageRouter` 退出 >1000 行组）· `lint:doc-code` ✅
- ⚠️ **顺带发现（预存，台账 L-6）**：`tests/utils/commonId.test.ts`「C1 唯一性」为 **flaky**（`generateId` 6 位十六进制 ≈1670 万空间，批量 2000 ⇒ 按生日悖论约 **12%** 碰撞）—— 非本版引入，已登记台账

---

#### v0.4.70 (2026-10-09)

**Bash 安全面收口（A1–A5）+ Execution 生命周期所有权体系（PR1–PR5）+ 统一 ID 熵源收口与 EventBus 三语义 + `CoreAPIImpl` 拆分达标（清豁免）**

- ✅ **Bash 安全（批次 A，A1–A5）** - 审计 `sessionId` 由 `toolUseId` 订正为真实会话（A1）· 已批准命令**不再豁免全部安全检查**（A2，灰度 `BASH_APPROVED_REVALIDATE`）· `spawn` **剥离敏感环境变量**（A3，单一事实源 `security/sensitiveEnv.ts`：子串族 + 具名集，`ScriptHookExecutor` 同批去重）· **高能力解释器**（node/bun/npm/python/pwsh…）纳入需确认判定（A4，`BASH_INTERPRETER_GUARD`）· 批准**严格模式**（A5，`BASH_APPROVAL_STRICT`：禁命令名级放行，仅精确 hash）⇒ 安全开关清单 **11 → 14**
- ✅ **Execution 生命周期（批次 B，PR1–PR5）** - **PR1 Execution Identity**：`execution/*`（branded `ExecutionId`/`Generation` + 集中状态机 `canTransition` + `ExecutionManager.acquire` 原子占用 + generation fencing）；**PR2 真取消**：两段式 `CANCEL_REQUESTED → CANCELLED`（未确认**保留 lease**）+ `AbortSignal` 端到端贯通（Router → CoreAPI → ChatManager 中继既有取消链路）+ 空转超时改抛类型化 `ExecutionAbortedError`；**PR3 Session safety**：`activeExecutionId` 记名 + `cleanIdle` 跳过执行中会话；**PR4 Dedup 语义收敛**：`RECEIVED/ADMITTED/REJECTED` 单一状态图（替代 inflight+processed 双结构）+ 超时不再"伪造已处理"（改真实 `REJECTED`）；**PR5 Durable Execution**：**新增 3 张表**（`executions` / `execution_events` / `tool_calls`，仅新增）· `ExecutionManager` 写穿 + 启动期 `recover()`（陈旧心跳孤儿 ⇒ `STALE` + `generation++`，**跨重启 fencing 不回退**）· execution 生命周期**会话事件三处同批**（编译期强制）+ `tool_calls` 记账接线 · **Router 级准入**（会话占用 ⇒ 有界等待，超时 `SESSION_BUSY` 且**不吞消息**）· 去重处理态**落盘**（`DedupStore` + 启动 hydrate，跨重启阻断重传 ⇒ 防重复计费）
- ✅ **C1 统一 ID 收口（生产零弱随机）** - 全仓 `Math.random().toString(36)…` ⇒ `randomIdSuffix()`（`crypto.randomUUID` 派生），**生产代码归零**（约 151 处 / 50+ 文件；仅余测试白名单）；新增 `core/ids.ts` 承载单一实现（解 `core → infra` 倒挂，`utils/common` 再导出 ⇒ 既有 import 零改动）
- ✅ **C2 EventBus 三语义显式化** - `publish`（fire-and-forget，零行为变更）与 **`publishAndWait`**（按序 await、返回 `{delivered, failed}`、单监听器失败不中断）分工明确；`once()` **幂等守卫**（重入/并发至多触发一次）；历史**快照**（防外部原地改数组污染）；wildcard 顺序契约文档化。⚠️ 事件名/载荷**去 `any` 类型化**经评估为**破坏性**（39 文件 / 87 处）⇒ 如实**另立项**，不夹带
- ✅ **C3 `CoreAPIImpl` 拆分达标（清掉一个豁免巨头）** - **2522 → 1898 行**：外迁 `sessionAgentOps.ts`（工具查询/`executeTool`/会话 CRUD 与查询/代理任务/文件类型，~680 行）与 `llmChatOps.ts`（LLM 懒初始化/`resolveSmartModel`/非流式 `chat`，~256 行），宿主仅留**薄转发** + 惰性 deps 端口（读写端口保持宿主状态权威）⇒ **移除 R04-001 豁免 FSZ-007**（例外 **8 → 7**）
- ✅ **配套**：`HEARTBEAT_STALE_MS` 等阈值经 `configManager.env` 单一入口；新增灰度开关 `EXECUTION_TWO_PHASE_CANCEL`（默认关 = 零行为变更）⇒ R07-2 安全开关断言 **14 → 15**（代码/断言表/规则表三处同批）
- ✅ **质量** - `typecheck` **0** · 全量 **5137 pass / 36 skip / 0 fail**（5173 tests / 553 files）· `lint:arch` **违规 0 · 警告 4（基线）** · `lint:size` **0 错**（例外 8 → **7**）· `lint`(eslint) **0 errors**
- ⚠️ **顺带发现（预存）**：`bun run lint`（prettier）在本仓**存量**违规（`bootstrap/*` · `compaction/*` · `tokenBudget/*` 等，非本版引入）——本版已把**触碰文件**清零；余 **0 errors / 56 warnings**（均为 `no-unused-vars` 类警告）待专项清理

---

#### v0.4.69 (2026-10-08)

**MCP 客户端双轨收敛（C-1/C-2/C-3）+ AI-VFS 从只读试点到用户可配置挂载面（P2 → T3）+ 沙箱/隔离死面清理（P1 / S1 / S6 / S7）+ 任务步骤证据链机械化**

- ✅ **MCP 客户端单链化（双轨收敛）** - `mcp_tool` / `mcp_resource` 改走**已连接的 SDK `Client` 顶层方法**（与 `mcp__*` 主路径**同一条链**）；删**增强层 `MCPManager` 重实现**（528 行）及其 `MCPCommandLoader`、删 `MCPClient.ts`（577 行）；`MCPServerManager` 改为**投影化**（`setProjection`/`clearProjection`），`MCPConnectionManager` 去掉 `connectAll`
- ✅ **MCP 实测缺陷修复（P0 + 资源泄漏）** - `client.capabilities.get()` 实为**不存在的属性** ⇒ 每次 `TypeError` 被 catch 吞成 `failed` ⇒ **整条 SDK 链不可用**（静态检查不可见）⇒ 改 `getServerCapabilities()`；诊断面按**真实 `status`** 映射（不再一律 `pending`）；`closeAll()` 逐个 `cleanup()` 修**进程泄漏**
- ✅ **AI-VFS 落地（P2 只读试点 → T3 用户可配置）** - 新增 `app/src/vfs/`（`IVfsDriver` + `VfsMountRegistry` + `DevDocsDriver` / `McpResourcesDriver`）与 **4 个系统调用工具**（`read_vfs` / `list_vfs` / `stat_vfs` / `write_vfs`）；`mcp://` 复用既有 SDK 链（**不复制**协议投影）；`GlobalConfig.vfs.mounts` 由 `buildMountPlan()`（纯函数）驱动装配；`list_vfs` 支持 **scheme-only 发现**（契约 v1.5）
- ✅ **VFS 前端管理面 + HTTP API** - 新增 `GET/PUT /v1/vfs/mounts`（**fail-closed** 校验：未知 scheme / `mcp` 缺 server ⇒ 400 且**绝不写盘**；**无热更新**，`requiresRestart` 如实上报）；客户端「设置 → VFS 挂载点」面板 + `vfsService`（挂在**既有「设置」模块**，未新建顶层路由）；接口清单 `api-spec.md` → 2.11.0
- ✅ **VFS 循环依赖 TDZ（P0，生产装配路径实证）** - `@modules/vfs` 桶**冷启动** import 抛 `Cannot access 'McpResourcesDriver' before initialization`（环的闭合边 = `MCPResourceTool` **模块作用域 `new`**）⇒ `registerVfsMounts()` 失败 ⇒ **全部挂载点启动注册不上**；根因修复为**惰性单例**（探针 `PROBE ERROR…` → **`PROBE: registerVfsMounts OK`**）
- ✅ **沙箱 / 隔离死面清理（P1 盘点 → S1/S6/S7）** - 删 `IsolationManager` / `EnhancedSandboxManager` / `docker/**` / `PTYSandbox` / `SSHSandbox` / `runWithLandlock`、`SandboxManager.execute()`、**workspace 子系统**、`ProcessRegistry` / `ResourceLimitManager`、未接线的 `SandboxConfigBuilder` 策略库；`createAdapter` 收敛为 **Local-only**；订正 `landlockSensitivePathGuard.test.ts` **测了不存在的路径**
- ✅ **工具注册表归一（P1 审计 D1–D4）+ 工具分类** - 注册表经**单一写入口**（弃 `new ToolRegistry()` 覆盖全局）；保证**每个已注册工具都有类目**（模型可见）；删桩化 MCP 资源工具只留真实实现；修「空注册表漂移」
- ✅ **任务步骤证据链机械化** - 步骤**机械回读**写入产物（证据不再依赖模型自觉）· 验收标准由工具输出**可证** · 证据喂入 verifier 的 `toolResults` 契约（REVIEW 不再恒 `ESCALATE`）· `/v1/pdca/start` 亦注入步骤 TAORLoop · LRTO/PDCA 步骤获**真实工具**（长任务可执行）· 阻塞工具改为**逐步引导**而非丢步
- ✅ **会话与工具口径修正** - steering 注入**落为 `context/steering` 事件**（可重建）· 删**第二套 steering 实现** · grep 60s 重复短路**不再伪装零命中** · 删孤立的消息命令队列 / 上下文修饰队列 · 删废弃 `resolve-module-aliases` 脚本
- ✅ **质量** - `typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4617 pass / 24 skip / 0 fail**（4641 tests / 511 files）；前端 vitest **535 passed**（62 files）· 本版 **170 文件 +9340/−10174**

---

#### v0.4.68 (2026-10-08)

**用户工作流模板从"清单"到"可执行"（P1-19 ①②③ / P0-2）+ 路径护栏家族收口（S27 / D-244~D-247）+ 轨迹与检查器口径修正（S17 / S21 / S28）+ 工具描述中文化（P2-2）与裁定归档**

- ✅ **工作流模板持久化（S24 ①）** - 用户模板从模块私有内存 Map 改为**落唯一 `app.db`** 的 `workflow_templates` 表（对齐 `AgentRoleStore` 模式；进程重启不再丢失）；5 个 CRUD 路由经**服务层端口**取用（避免 service→app 静态倒挂）
- ✅ **模板↔执行器绑定（S24 ②，spec 推荐形态「①+②」）** - `WorkflowStep` 增**可选 `tool`**（缺省 = **显式不可执行**，不猜不降级）；新增装配层 `templateToDefinition()`（定义名 `template:<id>` 防撞名）+ `WorkflowTemplateProvider`（seam 的**同步** `listWorkflows()` 由 store 同步快照供数；逐步执行 + 步骤边界取消）
- ✅ **执行入口与权限边界（P0-2 / S24 ③）** - 新增 `POST /v1/workflows/templates/:id/run` **与模型可见工具 `workflow:run-template`**（`list`/`run`；**不用 enum** —— 模板是运行期 CRUD 的动态目录，未知 id 回列可用清单）；**执行前权限预检**：仅允许**非破坏性工具**（事实源 `tools/toolEffects.ts`，**未声明工具亦拒**，fail-closed），越界**整体拒绝**且**不静默跳过**；`assist` 类目放宽到 `coding`/`agent`
- ✅ **内建 4 模板 = 人工方法论清单（明确化）** - 取证确认"补 `tool`"不可行（每步含 `manual`/`review`、seam 无人工确认点、`WorkflowStep` 无 per-step `params`、破坏性步骤会绕过任务裁剪 ⇒ 权限提升）；`/run` 对 `builtin:*` 由 **404 not-found 改为 400 + 准确原因**
- ✅ **路径护栏家族（S27 / D-244~D-247）** - `.env` **模板白名单**（`.env.example`/`.sample`/`.template`/`.dist`/`.defaults`/`.tmpl` 放行，**真实密钥仍拒**）· PathGuard 拦截改为**只跳过命中调用**而非终止整轮（`ReActToolLoop` / `TAORLoop` 同族收口）· 路径护栏**折叠 `.`/`..` 段**关闭绕过
- ✅ **口径修正（S17 / S21 / S28）** - `tokenBudget` 抽**叶子常量模块**打断循环初始化 TDZ · 轨迹 `context/model-input` 读端改**逐单元回溯**（修"每面板每轮只呈现其一"）· 检查器窄视口可**手动展开**（根因 = effect 依赖 `isOpen`，**非**阈值）
- ✅ **评测与对抗提案阶段（D-244 / D-245 / D-247）** - 空提案轮**重试**而非中断阶段 · 提案 id 唯一 · 压缩 token 口径**如实**（不再把不同源数值相减）· 路径改写技术登记为**机械反作弊向量** · 逐目标提案分布输出
- ✅ **编排模式（pattern）与协作端口** - `self_verify` 触发接线 + **未接线原因如实上报** + 模式目录持久化；新增**协作端口（SPI）与通道适配器**（scope A，薄端口，不新建编排运行时）
- ✅ **工具描述中文化（P2-2）+ 裁定归档** - 工具 schema 描述 **6 批**中文化；死代码降债（删 4 处已裁定死面）；台账 stale-pass（23 项"待裁定"中 **11 项其实早已闭环**）与多项 spec 裁定归档（文档/规则订正、依赖收敛）
- ✅ **质量** - `typecheck` **0** · 改动文件 `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 受影响测试目录 **683 pass / 0 fail**（`tests/tools` + `tests/workspace`）

---

#### v0.4.67 (2026-10-07)

**A2A v1.0 协议面收口（T4 A–E）+ 资源治理与输出护栏接线（P26-1/P26-2）+ 会话黏性路由与任务依赖硬阻断 + 死代码降债与文件拆分（C1–C14）+ 提示词中文化（P2-2 B1–B8）+ settings 权限接线**

- ✅ **A2A v1.0 协议面（T4 A–E）** - 新增 v1.0 JSON-RPC 协议类型 → 在 `/v1/a2a/rpc` 提供绑定 → SSE 流式任务更新（并声明 streaming）→ Agent Card 重塑为 v1.0 并恢复 binding → JSON-RPC 绑定从 `a2a-routes` 拆出；配套：**多 API Key + 可选过期**（零中断轮换）· 共享密钥**常量时间比较** · Agent Card 未接线时**不再广告** JSONRPC binding · 声明 `stateTransitionHistory` + 就绪探针
- ✅ **资源治理（P26-1）** - 请求优先级从 HTTP/通道入口**透传**到 governor → 超限时**抢占**低优先级跨会话流 → 超限请求**排队**（优先级交接 + 时限兜底）；抢占/排队状态经 **SSE** 暴露给前端
- ✅ **输出护栏双侧（P26-2 / PC-1）** - 护栏结果**回显到消息**（PC-1）· 改写审计**默认只记元数据**（动作 / 护栏名 / 原文长度 / 原文 SHA-256）· 秘密检测**收窄到真实值形态**并对 MIT 协议头**免报**（FP 修正）· 不可见 Unicode 表**收敛为单一事实源**（并集口径，加宽由测试锁定）
- ✅ **安全姿态钉死（R07 系列）** - R07-1 `long_task_pdl` 保持**装配不可达**（防误修）· R07-2 安全开关默认值升格为 **CI 断言事实**（doc-code 断言 5→15）· R07-3 **非幂等工具重试需审批** · R07-4 A2A 默认关 + 认证 fail-closed 钉死（断言 16→18）· R07-5 省略验收标准**永不可通过**（+3 用例）
- ✅ **会话黏性路由** - `SessionRouterStore` 单例接线（`main` 注入，benchmark 路径有意不注入）+ **上界保护**（长消息 + 低档位黏性不复用，交回 Judge）+ 守卫 7 例；**删死路由器族**（`AgentRouter` + 连带孤立 `StrategySelector`/types + `PlatformRouter`）
- ✅ **任务依赖阻断默认翻 hard（13-P1-1 Step 1+2）** - 先做**显式降级标注**（默认仍 soft、零阻断语义变化），再默认翻 `hard` + 模型按步 opt-out + 阻断回灌会话
- ✅ **提示词中文化（P2-2）B1–B8 全量** - 系统身份前缀 → 路由/编排/压缩 → 记忆 → 工具/子代理 → Agent 策略 → 命令（12 文件）→ 其它（建议模式 / 安全分类器 / goal 模板 / 内置技能正文）；**协议与契约保留英文**（JSON 字段名 · `VERDICT:` · `{{占位符}}` · `[SYSTEM] ` · 工具名 · 路径 · frontmatter 键），受影响断言同批同步
- ✅ **品牌残留清理（P2-1 重开）+ settings 权限接线** - `CLAUDE_CODE_*` 内部标志 → `PY_APP_*`（4）· 渠道凭证 → `CHANNEL_CLAUDE_*`（2）· `ClaudeChannel` 常量去品牌 ⇒ `app/src` 的 `CLAUDE_[A-Z_]+` **14 行 → 5 行**；**settings 的 `permissions.allow/deny/ask` 原为零消费者（写进 settings 不生效）⇒ 接入 `PermissionManager` 决策上下文**（来源优先级 user < project < local < policy），并**修掉** `getEmptyToolPermissionContext()` 的 allow/deny/ask **共享同一对象**缺陷（写 allow 会串写 deny/ask）+ 4 例回归
- ✅ **死代码降债（P2-8 批次 1–5）** - 删零消费者废弃符号 / 死 barrel / 重复实现；`utils/common.retry` 覆盖迁至 `withRetry` 后删除；**移除 5 处 blanket `no-explicit-any` 关闭**（类型化收口）
- ✅ **文件拆分 C1–C14** - 启动 preflight（C1）· 会话轻量扫描与 FTS5 分片（C2/C3）· Llama 日志与模型目录（C4）· `EventLogStorage`（C5a/C5b）· 前端 `MediaPage`（C6）· 知识维护 handler（C7）· QQ 协议常量与入站事件族（C8/C9）· `TAORLoop`（C10）· `streamMessageFlow`（C11）· `LongRunningTaskOrchestrator`（C12–C14）
- ✅ **门禁与契约文档** - 新增 **doc-code 语义一致性门禁**（A13/R11-1）并接入 `ci` + `version:check`；`lint:arch` **项目根与 cwd 解耦**（AR-2）+ pre-commit **不再容忍 exit 2**（AR-3）；新增 `core/spi` 端口实现点地图（R11-4）· 工具调用安全检查链路契约 · 编排模式目录暴露给前端（PC-6）
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4878 pass / 21 skip / 0 fail**（4899 tests / 519 files）

---

#### v0.4.66 (2026-10-06)

**U4 在线质量评估器全链闭环（D1–D6）+ ACP 远程暴露 fail-closed + 记忆冲突检测接线 + 死代码簇清理**

- ✅ **U4 在线质量评估器（新模块 `evals/online`）** - 纯函数 `scoreTurn()`（4 维加权：完成度 0.4 / 裁决 0.3 / 工具空转 0.15 / 成本 0.15）+ 4 条结构化可疑规则（`not-completed` / `verdict-negative` / `low-score` / `low-score-streak` 连续 3 轮）+ `deriveTurnSignals()` 从事件日志派生每轮信号（含正文摘录，处理 `assistant/text.replace` 清空重建）+ `runTurnQualityPass()`（水位去重 + 回看窗口 + 上限 5 最低分优先 + 分片让出 + 单会话错误隔离）+ 会话级摘要 `summarizeTurnQuality()`；**不消费 `BehaviorMetrics`**（其「仅观测、不得作判据」契约由反向锁定测试守住）
- ✅ **U4 D3 可疑轮 LLM 复核** - `createVerifierTurnReviewer()` 复用 `VerifierAgent`（**每轮新建实例**——`cycleCount` 为实例态，复用会使第 2 轮起恒 `ESCALATE`）；模型只取 `modelRouter.resolveRole('verifier')`，未配置即返回 `null` 跳过；实测边界：**无正文 ⇒ 跳过复核**
- ✅ **U4 D4 空闲期接线（主链零调用）** - 挂在 `ChatOrchestrator._ensureIdleScaleMonitor().onIdle`（每次空闲只触发一次）；会话范围 = 活跃会话 ∪ 最近 30 个历史会话（`rankRecentSessionIds` 按 `updatedAt` 降序去重截断）⇒ **历史会话补评**同步落地
- ✅ **U4 D5 事件契约四处同批** - `turn/quality` 新增：`shared/events/eventNames.ts` 名字 + `session/types/eventPayloads.ts` 后端载荷 + `client/src/types/events.ts` 前端载荷 + `knownEventTypes.ts` 登记清单（编译期穷尽断言强制，漏一处即 `TS2322`）
- ✅ **U4 D6 消费点 = core SPI** - 新增 `ISessionQualityPort` + 转发代理（未注册返回 `null`），实现由 `entrypoints/spiWiring.ts` 注入 ⇒ 梦境（`chronos/autoDream`）可读在线质量分而**零 infra→app 倒挂**；`AutoDream.buildSessionLines` 追加质量摘要（失败只 `warn` + `@ignore-catch`）
- ✅ **N-81 ACP 远程暴露 fail-closed** - 非回环地址 + 无 token ⇒ **拒绝启动**（不再默认放行）；配套 `acpContract.test.ts` / `acpRemoteExposure.test.ts`
- ✅ **记忆冲突检测接线** - 空闲期只检测与记录，**零数据改写**
- ✅ **死代码簇清理（N-78 / N-82 / N-83）** - 删除 `AdaptiveRouter` 整类 + `subagent/communication/` 4 文件族（`SubAgentCommunicator` 占位模拟 + `receivePermissionResponse` 无条件 `granted:true` = CS04 + fail-open）+ 权限同步双轨孤儿 3 文件 + MOA 成本死码；同步清理 `lint-architecture` 例外与 barrel 再导出
- ✅ **N-74 i18n en 补齐** - 96 键 + 键一致性守卫（防再漂移）；**媒体提取工具命名统一为下划线** + 守卫测试
- ✅ **契约测试补齐** - A2A 委派/回查 405 两态 + ACP 全契约
- ✅ **D2 迁移评估（`dependsOnMode`）** - 取证结论：`hard` 在**生产不可达**（分解 prompt 不产出该字段、无 config/UI/env 开关、调用方未传）⇒ 13-P1-1 的修复在生产上不生效、A3 缺陷原样存在；结论 = **应当翻转但不能单独翻转**（两步走方案已入台账 §20.6）；`topoBatches.ts` 注释补入该结论。**订正（2026-10-07）**：该评估的**两步均已落地（2026-10-06）** —— `topoBatches.ts` 默认已翻转为 `?? 'hard'`（Step 2）+ Step 1 显式降级 + F8 回灌，详见台账 §20.6 ⇒ 本条为**评估当时**的中间结论，**最终状态＝已翻转**
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 · 警告 4（基线）** · 全量 **4718 pass / 21 skip / 0 fail**（500 files；较上版 **+74 例**，逐数吻合）

---

#### v0.4.65 (2026-10-06)

**评测体系四项扩展（A1 / A2 / A3 / A6）+ 协议与可观测性对齐（A5 / A4）+ README 特色重写**

- ✅ **A1 可靠性口径：pass^k 曲线** - 新增 `passHatK()`（`C(c,k)/C(n,k)` 组合式**无偏估计**，逐步连乘避免溢出）+ `computeReliabilityCurve()`（逐点任务平均，**只算跑够 k 次的任务并记录参与数**，`n_t < k` 的任务**退出该点**而非记失败）；报告与 CLI 新增「可靠性曲线」段（仅 k≥2 点，k=1 退化为单点不展示）；**不改**既有 `pass1`/`passK`/`checkGate` 与 `baseline.json`；新增 `tests/evals/passHatK.test.ts` **10 例**
- ✅ **A2 真实任务级回归基线** - 新增逐用例 JUnit 解析 `parseJunitCases()`（`<testcase>` 三态 + 实体解码）+ 稳定键 `junitCaseKey()`；由**双实测自动派生** `F2P`（起点红→修后绿）/ `P2P`（起点绿→保持绿），物化期 **fail-closed**（F2P 为空即拒绝出题）；打分新增 `resolved` / `breaking` / `no-op` 与 `resolvedRate`（仅双清单任务进分母）；用例 **17 例**
- ✅ **A3 安全评测：聚合 ASR（Max 口径）** - `SecuritySummary` 增 `aggregatedAsr`/`aggregatedWon`：同一场景**任一**已完成攻击得手即该场景记"被攻破"（**空转不算**，与 `asr` 分母口径同源），与 attempt 级 ASR **并存展示**（各自标注口径，防误读）；**不改**题集 / 运行时防护 / 退出码；用例 **5 例**
- ✅ **A4 可观测性：OTel GenAI 语义约定** - LLM 请求 span **并存**写入 `gen_ai.operation.name` / `gen_ai.request.model`（span 创建时）+ `gen_ai.usage.input_tokens` / `output_tokens`（结束时）；span 名与 `Liri.*` 指标**零改名**（避免破坏覆盖去重键与客户端 trace 视图）；内容类属性按规范**默认不采集**
- ✅ **A5 A2A 对齐 v1.0.0** - 发现路径 → `/.well-known/agent-card.json`；`A2ATaskState` → **9 值 `TASK_STATE_*`**（补齐 `UNSPECIFIED` / `AUTH_REQUIRED`）；`A2A_METHODS` 值 → v1.0 PascalCase 抽象操作名；枚举改名的**编译期强约束实测**精确捕获 4 处残留状态字面量
- ✅ **A6 检索基准：真实语料 + 对照口径** - **删除模拟语料生成器**（`${topic}${w}${p}` 式假词），改用仓库自身 **143 篇真实文档**（复用既有 `FileDocsProvider`）；查询词由语料标题派生；新增 `benchRetrievalModes()` 对照 `exact-title` / `keyword` / `hybrid` / `vector` / `graph` × `recall@1/5/10` · `MRR` · 延迟 · `matchType` 分布；不可得模式**显式标记不可用 + 原因**（不填 0 冒充）
- ✅ **README 重写（非仅版本说明）** - 新增「**🌟 为什么是 Liri**」6 条工程取向（可复现优先 / 写前持久化 / 自带评测与回归门禁 / 架构门禁化 / DB 为唯一事实源 / 真实语料自测）；新增 5 个功能小节：**评测与回归门禁** · **可复现与回放** · **知识库与知识图谱** · **多智能体协作与工作流** · **协议面**
- ✅ **质量** - `typecheck` **0** · `eslint` **0** · `lint:arch` **违规 0 / 警告 4（基线）**、分层 **3886** · 全量 **4644 pass / 21 skip / 0 fail**（4665 tests / 492 files）

---

#### v0.4.64 (2026-10-06)

**A10 协作编排单一构造点 + CLI 退出码（O6）/ 知识图谱 domain round-trip（P2-12）修复 + 记忆分层文档化 + A2 立项**

- ✅ **A10 协作编排单一构造点（零行为变更）** - 原 `new CouncilOrchestrator(...)` **散落 2 处**（`chat/ChatManager.ts` / `runtime/api/domainSnapshotOps.ts`，无共享工厂）⇒ 新增 `workspace/CouncilOrchestrator.ts#getCouncilOrchestrator()` 模块内单例，两处改走该入口 ⇒ **模块外构造点 2 → 0**；`lint:arch` 与基线**逐数一致（零新边）**；立项 spec `.trae/specs/collaboration-orchestration-contract.md`（G3 窄端口按 CS03 暂缓——无消费者即死抽象）
- ✅ **O6 CLI 失败路径返回非零退出码** - 根因**实证**：退出钩子内 `process.exit(0)` 会把已确定的退出码**强制改 0**（实测 `exitCode=3` ⇒ **0**），令 commander 的 `exit(1)`（未知选项/缺参）与 action 失败码全部失效。① `cli/exitHandler.ts` 新增 `runExitCleanup()`（**只清理、不 `process.exit`**），退出钩子改调它；② CLI 局部 `handleError` 包装（import 改名 `recordError`）统一置 `process.exitCode = 1`（17 处 action 失败，**零调用点改动**）；新增 `tests/cli/exitHandler.test.ts` **3 例**
- ✅ **P2-12 知识图谱 `domain` round-trip 保真** - `KnowledgeGraph.ts#rowToEdge` 由 `row.domain || undefined` 改 **`|| ''`**（与 INSERT 侧 `edge.domain || ''` 及唯一索引 `COALESCE(domain,'')` 同源）⇒ 消除"导出时字段消失、导入又还原 `''`"的 round-trip 不保真；新增 `tests/knowledge/knowledgeGraphDomainRoundTrip.test.ts` **3 例**
- ✅ **记忆分层文档化 + 端口注释行号订正** - `app/src/memory/README.md` 重写为**分层 + 端口文档**（域边界表 / 关系图 / 四窄端口实现者行号 / 命名消歧 4 条 / 域外同名易混清单）；顺带订正 `memory/ports/MemoryPort.ts` 注释内 `MemoryManager.ts` **行号整体陈旧**（实现者 10 处 +14 行、死契约 `:63`→`:72`，共 **11 处**按实测订正；纯注释）
- ✅ **A2 立项：S1 真实任务级回归基线** - 新增 `.trae/specs/eval-s1-real-task-baseline.md`（SWE-bench 精读落地项 A2：**F2P/P2P 双清单判据** + `resolved/breaking/no-op` 语义；D1–D4 待裁定，**未动码**）；同批登记 `.trae/specs/dsh-plugin-shim-contract.md`（T-3 契约）与 `orchestration-lifecycle-contract.md §9`（`LoopLifecycle` 维持排除）
- ✅ **文档回填 + 质量** - `data-contract-unification.md **§9.14**`（P1-8 收官：E 组 type-only 仅上报 + R02-002 维持 `≥3`）· `layer-inversion-a-class-inventory.md **§3.17.20**`（P1-9 收官）· 提示词中文化报告 **v2.0**（原 6 项对账 + ~35 文件现存英文提示词面 + 排期建议）· 台账。门槛：`typecheck` **0** · `eslint` **0** · `lint:arch` **错误 0 / 警告 4（基线）** · 全量 **4612 pass / 21 skip / 0 fail**（4633 tests / 488 files；较上版 **+6 例 / +2 文件**，逐数吻合）

---
#### v0.4.63 (2026-10-06)

**技能系统收口（SK-2 + `impl` 契约）+ 媒体页任务重试与状态单一事实源 + CHANGELOG 历史补录**

- ✅ **SK-2 内置技能收敛为 prompt 型** - 内置 7 个 `type:'agent'` **空壳**（verify/loop/batch/optimize/document/refactor/test）**无条件注册** ⇒ ① 三处 placeholder **假执行**；② **同名遮蔽**（真 prompt 型 `verify` 不可达）。改为**只注册 `type:'prompt'`**，删除 `executeCommandSkill`/`executeAgentSkill`/`executeGenericSkill`，`executeSkill` 收敛 prompt-only + 边界**如实拒绝**（§1.15-6 技能仅提示词注入）；新增 SK-2 测试 **5 例**
- ✅ **`Skill.impl` 类型契约订正** - **取证**：类型一直**必填**、6 处生产构造点**全部提供** `impl`、全仓无「无 `impl` 技能」、台账无 V-14 记录 ⇒ 原规则「`impl` 可选」**失真**。订正 `project_rules §1.15-11` 为「**必填**」（规则版本 → **v7.15.0**），并收口 `SkillRegistry` 唯一防御点 `skill.impl?.kind` → `skill.impl.kind`（CS03：不为生产中不可达的形态写防御）
- ✅ **媒体页 MD-2/6/9/10/11 收口** - ① **MD-2** 删除 `VideoTaskItem`/`activeTasks` **影子副本**及其 4 个 action，`useVideoTaskPolling` 重写为**派生自 `generationTasks`** 的单一事实源（轮询直写、`submitTask` 不再补写占位条目）⇒ 消除「双写 + `remoteTaskId` 匹配」的结构性易漂移；② **MD-10** `GenerationTask` 新增 `videoParams`（留存原始请求参数）⇒ 失败视频卡新增「**重试**」（移除失败卡 + `submitVideoTask` **忠实重放**，与 `handleGenerate` 共用，§1.3 方法禁止重复）；③ **MD-6** `ActionMenu` 去掉「非图片返回 null」+ **GridView 补渲染**（原图片编辑/图生视频/下载/删除全不可达）；④ **MD-9** 新增 `scrollMediaItemIntoView`，生成后自动定位新图；⑤ **MD-11** `removeGalleryItem` 补 `saveFavorites`（消除删除后刷新收藏复活）
- ✅ **`KnowledgeSaveTool` 模块顶层 TDZ 修复（预存缺陷）** - 顶层 `getAllFragmentPrefixes()` 与 `ContextualFragment` 循环导入 ⇒ 单独运行技能测试**必现** `ReferenceError: Cannot access 'PREFIX_BY_KIND' before initialization`（全量跑靠模块加载顺序偶然通过；已 `git stash` 复现证实非本批引入）⇒ 改**惰性 + 记忆化**
- ✅ **CHANGELOG 历史补录** - 自 `v0.1` 起按 git tag/log 补录 **38 个版本段**（+411 行），全文件按版本号降序归并（数值相等时更具体者更大）；新增 `versioning.md **§3.1**` **补录标记约定**（触发条件 / 事实统计 / 顺序 / 异常标注 / 工具与粒度红线）
- ✅ **质量** - `typecheck` 0 错（前后端）· `eslint` **0 error / 136 警告**（基线）· `vitest` **506 pass / 56 files / 0 fail** · 服务端全量 **4582 pass / 21 skip / 0 fail**

---
#### v0.4.62 (2026-10-06)

**A1 Fail-Closed 受阻机制全链闭环 + §13 七项建议全部落地 + A5 跨会话资源治理（新模块）**

- ✅ **A1 Fail-Closed 受阻机制（T1–T6）全链闭环** - ① **取消判定去字符串匹配**（`PendingOption{label,outcome}` 结构化 + `isGateCancelled()`，订正 `NegotiationState` 失实自称）；② **挂起清单事件投影 + 启动重建**（`pendingSuspensions.ts` + `bootstrapPendingRecovery()`）；③ **fail-closed 结算**（不可判定 ⇒ 不放行）；④ **结算实时可见**（`suspension_settled` → chunk 映射）；⑤ 验收归档（投影等价性 + 结算收敛幂等 + spec §8 验收表）
- ✅ **§13 七项建议全部落地（《Agentic Design Patterns》21 模式复查）** - ① **13-P0-1** 验证器三条降级路径 **fail-closed**（`passed:false` + `ESCALATE`，开关 `VERIFIER_FAIL_CLOSED` 默认 true）；② **13-P0-2** `SuccessCriteria` **一等对象化**（新增 `core/successCriteria.ts`：解析 / 骨架 / 判定对齐，漏项不复行）；③ **13-P1-1** 拓扑分批**依赖失败传播**（`computeTopoSkips` + `block/continue` 传播 + `skipped` 终态）；④ **13-P1-2** 工具**幂等 / 副作用声明**（新增 `tools/toolEffects.ts`，71 个内建工具逐一声明、编译期联合防漏；非幂等禁盲重试）；⑤ **13-P1-3** 装配升级为**执行配方**（`PatternRecipe` + `self_verify` 升 `ready`，复用既有 `VerifierAgent`）；⑥ **13-P2-1** **输出侧内容护栏**（core `outputGuard` 统一契约 + 注册表；PII 打码 / 敏感拦截 / 注入回显，**默认关**）；⑦ **13-P2-2** **评估指标回流**（新增 `tasks/behaviorFeedback.ts`，任务结果率回灌 `PlanDrivenLoop` 路径选择）
- ✅ **A5 跨会话资源治理（新 app 模块 `resourceGovernor`）** - 在飞会话**只读视图**（`snapshot()`）+ 并发上限**告警**（`overLimit`，不拦截）+ `admit`/`release` 生命周期；两条请求路径（流式 `streamMessageFlow` / 非流式 `sendMessage`）接入；开关 `FEATURE_RESOURCE_GOVERNOR` **默认关**（关闭时零行为变更）。⚠️ 如实边界：**抢占 / 排队未做**（用户裁定最小范围）、**优先级透传未做**（生产侧恒 `interactive`）
- ✅ **治理与文档** - `CHANGELOG.md` **建库**（版本变更单一事实源）+ `README` 精简（只留最新一版 + 指回本文件）+ `version:check` 覆盖 README/CHANGELOG；任务计划 §2.4 **逐项裁定与执行**（onReady 失实订正 / 通道进程隔离立项 / 删死工厂 / 注释与计数订正 / 7 篇 stale 状态头）；`roughTokenCountEstimationForMessages` 标记 `@deprecated`
- ✅ **质量** - `typecheck` 0 错 · `eslint` 0 错 · `lint:arch` 违规 **0**（4 警告基线）· 全量测试 **4577 pass / 21 skip / 0 fail / 4598 tests / 484 files**

---

#### v0.4.61 (2026-10-05)

**工作流运行记录（P1-19）全链闭环 + 工具链（Code Mode）升级 + 治理 G 组 §3 收口 + 测试盲区补齐**

- ✅ **工作流运行记录（P1-19 系列）** - ①**成员级事件实时化**：run 执行期即按序落盘（注入式 `WorkflowRunEventAppender`，去重判据 = 持久化布尔 `metadata.workflowRun.liveEmitted`，非字符串匹配）；②**前端专用卡片** `WorkflowRunCard`：`run_start`/`step_start`/`step_end`/`run_end` 四类事件**原地聚合**为单张卡 + 重放期中断合成；③集成/观察者测试 **14 例**（真实 `DocOrchestrator` / `EventLogStorage` 落盘 / `EventMessageDeriver` 派生）；④**中止链路闭环**：编排工具透传会话中止信号 + 注入 `gracePeriodMs: 0` ⇒ 中止**立即**结算 `cancelled`（在飞步骤被账本封闭丢弃），并跑通**会话级 e2e**（观测到 `run_end@+142ms(stopReason=cancelled)` 与卡片 `cancelled`）
- ✅ **工具链 · Code Mode（T-2）** - ① `code_run` **注入可调用工具清单**（由工具注册表按生效白名单生成轻量声明 `name(param: type) — description`，经 `description` getter 反映运行期注册表）；② **Tier2 opt-in 开关** `CODE_MODE_TOOL_TIER`（**Tier1** 本地只读默认 / **Tier2** 只读扩展 10 项需显式开启 / **Tier3** 写执行类**永不放开**，须走主循环逐次审批）
- ✅ **修复：冒号命名空间工具在模型侧不可见（N-45）** - 根因＝出站 **wire 安全名**（`office:workflow` → `office_workflow`）与**类别表真名**错配 ⇒ 落 `misc` 被按任务**静默裁剪**；已加 wire 名索引三级解析 + 补登记 `office:doc-pipeline`，并加**系统性不变量**测试（探针复核裁剪 43→41、形态不一致 1→0）
- ✅ **事件契约单一事实源（P1-18）** - 4 个联合下沉 `shared/types/goal-types.ts`；app↔client **字段级**契约校验（分配式条件类型）升级 + client 守卫用例；**顺带修复 2 处真实跨端漂移**（`user/message.attachments` / `assistant/status.phase`）
- ✅ **治理 G 组 §3 剩余 5 项收口** - ①**§3-2** bash Landlock 新增 `sandbox.landlock.bashExtraWritablePaths`（默认 `[]` ⇒ 与治理前策略逐条等价）；②**§3-5** 打包大小写校验（实证 `tsc` 报 **TS1261**；client 显式化 `forceConsistentCasingInFileNames`）；③**§3-6** 新增 `lint:case` 同名目录防回归守卫（仅大小写不同的同级条目，含**自检控制组**防"空集假绿"，已纳入 `ci`）；④**§3-7** G3 守卫化（隔离提示词工具名取自**注册表生成物**，漂移即 typecheck 报错）；⑤**§3-8** 删除 `BashTool.safeExecute`/`executeCommand` 死调用点及 `isDangerousCommand` 死静态方法
- ✅ **P1-10 测试盲区补齐 + 死注入面清理** - 新增 `checkpoint-handlers`（**6 端点 / 11 例**）· `auto-reply-handlers`（**4 端点 / 7 例**）· `MCPToolBridge`（**5 例**，含"未注入端口 ⇒ 明确抛 AppError"契约）；删除 `CompactServiceImpl` **AI 摘要死注入面**（全链不可达，运行期行为逐字不变）
- ✅ **P2-13 台账遗留清理** - `phase3.test.ts` 迁出 `src/`（迁移即**暴露被隐藏的类型漂移** `ToolExecutionError` → 订正为 `ToolErrorRecord`）· `ErrorCodeDef.level` **删 `INFO` 档**（不可表达档将编译期报缺键）· 4 项 stale 订正；修复 `lint:exit`（`gen:toolnames` 补显式退出，`ci` 链恢复全绿）
- ✅ **质量** - `typecheck` 0 错 · `eslint` 0 错 · `lint:arch` 违规 **0**（4 警告基线）· 全量测试 **4468 pass / 21 skip / 0 fail / 4489 tests / 472 files**

#### v0.4.60 (2026-10-05)

**文件规模债拆分收官（ChatManager / CoreAPIImpl / ReActToolLoop / AgentTool）+ 行数上限 1000→2000 + P1 遗留多项补齐**

- ✅ **文件规模债拆分 · ChatManager（批 A1–A6）** - 6729 → **5238**（−1491）；新模块 `chat/manager/{requestPrep,rollback,promptAssembly,bootstrap,recovery,sessionTeardown}.ts` + `chat/pipeline/streamMessageLifecycle.ts`
- ✅ **三处宿主文件拆分收官** - `CoreAPIImpl` 5336 → **2521**（−2815；新 `domainSnapshotOps` / `sessionMessagesRead` / `messageMutation` / `sessionTitling`）· `ReActToolLoop` 3595 → **2543**（−1052；新 `toolTurnBudget` / `streamingLlm` / `toolResultPostProcess`）· `AgentTool` 3288 → **2652**（−636；新 `agentToolPool` / `agentTeammateIsolation` / `agentLedgerLifecycle`）；`ReActToolLoop` B2 经判据裁定「不建议拆」
- ✅ **R04-001 行数上限 1000/800 → 2000** - 并清理陈旧 `fileSizeExceptions`（161 → 16 条）
- ✅ **目标实体 X11** - 目标自动创建入口（后端 swarm 路径 `ensureGoalForBatch` + 前端聊天区目标条 `GoalBar` / `goalService`）
- ✅ **通道监控加固（P1-23③）** - `ChannelRealtimeMonitor` 探测超时 → 不确定态 + `consecutiveProbeFailures` 连续失败确认（≥2），消除忙时误判自愈
- ✅ **context-contract（P1-7）** - §5.2 全 **12 条**裸前缀拼接迁移为 `ContextualFragment` + `renderFragment()`（渲染文本逐字不变）；**#5 读取侧 CS02 改结构化标记** `FRAGMENT_KIND_FIELD`（移除 `startsWith` 判定）；新增**单条注入 token 上限运行时护栏**（>10K error / >1K warn，非阻断；动态 import 破环）
- ✅ **请求边界补齐（P1-16）** - 工具轮与非流式路径现均产 `request/start` 并透传 `requestId`；`CompactionSummaryEnvelope.usage` 聚合填充；**根因修正** `ToolLoopContext.appendStreamEvent` 返回类型（原 `Promise<void>` 与运行期不符，被 `as unknown as` 掩盖）
- ✅ **PDCA / WorkItem 检查点迁入 app.db（GAI-3）** - 新表 `pdca_checkpoints` / `workitems` + **写链串行化原子 UPSERT**，根治 read-modify-write 竞态；删除 `prewarm` 与文件 I/O；`list` 实测 **9.2ms**（旧首次 ≈1.1s）；WAL 经统一封装继承（未新增 PRAGMA）
- ✅ **P1 现状核对 sweep** - 26 项专项逐项 file:line 取证并订正文档（含 `plan-workspace-isolation` Phase 1–5 全部已落地）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 全量测试 **4398 pass / 0 fail**

#### v0.4.59 (2026-10-05)

**R03-002 单一事实源专项收官 + 评测沙箱 Landlock 加固（capability-gated）+ WSL2 真机验证**

- ✅ **R03-002 模块出口单一 · 单一事实源（D-3-c 专项）** - `moduleRoots` 由**硬编码 45 项**改为**派生自 `modules-to-layers.json`**（消除漂移；一次性暴露存量违规以正式收口）；收口批次①②③共**移除 26 个登记键**（白名单引用 909 → 843）
- ✅ **门禁缺陷修复** - `TEST_FILE_EXCLUSIONS` 跨平台分隔符失效（Windows 反斜杠路径下 `__tests__` 排除**永不命中**）⇒ 消费点归一正斜杠
- ✅ **P0-4 ② 评测期强制 bash 走 Landlock（capability-gated）** - 新增意图开关 `LIRI_EVAL_BASH_LANDLOCK`：能力可用 ⇒ 真受限；不可用 ⇒ **回退 plain（绝不 `refuse`）**，不打断非 Linux 评测
- ✅ **Landlock 三处加固（WSL2 真机驱动）** - ①`LandlockDetector` LSM 预检改**三态**（securityfs 未挂载不再误判 `not-in-lsm`）；②只读放行 `/mnt/wsl`（WSL2 域内 **DNS 不再被拒**）；③`buildLandlockArgv` **统一按存在性过滤**规则路径（缺失路径不再令 helper `exit 125`、整只沙箱失效）
- ✅ **WSL2 真机验证** - 内核 `6.18.33.2`：门控路由 / 敏感路径拒绝 / DNS / 普通命令**全部符合预期**（`curl` HTTP:200、`~/.pyapp/config.json` EACCES）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 定向测试全绿

#### v0.4.58 (2026-10-04)

**事件循环阻塞源收敛（A/B/C 三档收官）+ 对抗 Agent 形态 A（红队提案器）+ 预存缺陷修复**

- ✅ **阻塞源收敛 · A 档（死代码）** - 删除 7 个零消费者文件（`utils/git.ts`、`hooks/ShellHookDetector.ts`、`tools/ExpansionTools.ts`、`plugins/utils/{pluginVersioning,gitLoader}.ts`、`context/context.ts`、`modules/doc/execution/ResourceGuardian.ts`，**−3044 行**）并清理连带引用与例外清单
- ✅ **阻塞源收敛 · B 档（交互热路径）** - `execSync`/`spawnSync` → `promisify(exec/execFile)` 异步：doc（`OfficeCLIDetector`、`PdfPageExtractor` 60s、`DocGenerateTool`）· tools（`VideoAnalysisTool`、`AgentRunStore`、`ClipboardTool`）· monitoring+voice（`MonitoringService` 死分支、`audioFormatConverter` 60s）· worktree 工具 `isEnabled`（改同步 fs 探测，不再 spawn）· `recorder` 与 `recordingDetector.hasCommand`；并**放宽 `STTProvider.isAvailable` 公共契约为 `boolean | Promise<boolean>`**（`STTRegistry` 静态门面 async 化）
- ✅ **阻塞源收敛 · C 档（管理/安装）** - `DaemonService`（31 处）· 插件安装/分发（`NpmDistributor` / `PluginInstallManager` / `PythonPluginInstaller`）· `BackupCommand`
- ✅ **预存缺陷修复** - `recordingDetector.hasCommand` 原把 `where`/`which` 的非零退出误判为"命令存在"（导致无 ffmpeg 时仍选 ffmpeg 录音链）⇒ 按真实语义修正
- ✅ **对抗 Agent 形态 A** - 新增 LLM 红队**提案器**（proposal-only，裁决权仍归机械判据）+ 确定性半，`evals/cli` 接线
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0（4 警告基线）· 定向测试全绿

#### v0.4.57 (2026-10-04)

**Agentic Design Patterns 对标推进（A3/A4/A8 闭环）+ Landlock 真机实测结案 + 组②/组⑥ 缺陷修复 + ChatManager 拆分首批**

- ✅ **A8 模式装配闭环** - 新增装配入口 `instantiatePattern`（描述 → 可执行路由），补上「模式清单」到「运行时装配」的最后一公里（B1）
- ✅ **A4 编排家族收敛（T-①04）** - 下线 **8 个零可达编排类**；存活者命名复核（无重名）；新增 **L2 窄契约 `SchedulerLifecycle`** 并让 4 个调度器（`DiscoveryScheduler` / `DreamScheduler` / `CronScheduler` / `KnowledgeCompileScheduler`）实现之（D1=a/D2=b/D3=a）
- ✅ **A3 权限命名消歧（T-①05）** - `security/PermissionManager.ts` 同名双轨收敛，类改名 `SecurityPermissionView`（文件路径保留系既定裁定）
- ✅ **记忆分层收敛（T-①07）** - 新建记忆窄端口 `MemoryPort`（Read/Write/Search/Forget）；`MemoryManagerImpl` 声明实现四端口；会话域另立 `SessionMemoryPort`；RAM 侧同名 `MemoryManager` 消歧；会话记忆三类型下沉 `session/memory/types.ts`；下线增强层与悬空实现（5 文件）及 2 处零消费者
- ✅ **Landlock 真机验证结案（T-③06/③07/③08）** - `native/main.c` 补 `<stddef.h>`（GCC 15 / glibc 2.43 隐式声明修复）；WSL2 Ubuntu 真机实测：网络两态（`--net-deny`）与文件系统侧（`~/.pyapp/config.json` EACCES 拒绝）**8/8 符合预期**（假阴性风暴根因为 PowerShell→WSL 引号污染，非应用缺陷）
- ✅ **组② 契约与单一事实源** - **T-②02** 目标监控闭环接线（新增 `goal/deviation` + turn 预算偏差判定）；**T-②04** 路由决策可观测性（`context/model-input` 补 `model/route`，resolve 出口落 INFO 决策）；**T-②05** 分流判据配置化（阈值 + 危险意图正则入 config）；**T-②06** 经验自动演化（写回面 + 自动回灌 + 可观测）
- ✅ **组⑥ 缺陷修复与取证** - **T-⑥01/⑥02** 导出侧去重与时间戳兜底；**T-⑥04** 工具卡失败原因可见（提取器按既有契约逐级取数）；**T-⑥05** 工具调用协议前缀形态漏解析修复（任意非 `>` 前缀 + 真实样本回归守卫）；**T-⑥08** 空回复兜底补结构化诊断；**T-⑥09** 402 余额不足归类与引导；**T-⑥11** 长任务静默心跳（45s 补发 status chunk）；**T-⑥12** 自唤醒续跑审计事件 `session/wake`（可回放）；**T-⑥14/④02** `write_project_file` 新文件被拒修复 + 写后回读校验
- ✅ **HTTP / 模型链路修复** - `/v1/chat/completions` 的 `model` 支持 DB UUID 解析；DeepSeek wire 名对齐；无工具回合终稿 mermaid 校验补齐（P0-1② 覆盖面）
- ✅ **ChatManager 拆分首批（文件尺寸债）** - 提取 `ChatEventLogStore`（批 1/3）→ 迁入流式写入三件套（批 2/3）→ 迁入读回族 7 成员（批 3/3），主类 **6729 → 6377 行**；出拆分路线图（4 巨型类优先序 + A1-A6 批次）
- ✅ **基础设施归一与门禁** - **D-241** SQLite 连接统一封装补齐（归一化 5 处直连）；**D-239/D-240** 工具结果二级/三级防御两侧形态订正（此前在生产整体空转）；**T-③01** `R03-002` 提升为 `error`（违规即阻断 pre-commit/CI）；`tests` 纳入 lint（一次性收敛 379 处 prettier）
- ✅ **死代码与资产清理** - 下线 `chronos/CronScheduler.ts`、daemon 队列/健康链（5 文件）与「存量未接线族」4 文件；更新 liri logo（根目录与 `client/public` 统一）
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` 违规 0 · 定向 515 pass/0 fail · **全量 3883 pass / 9 skip / 0 fail（426 文件）**；预存问题逐项登记

#### v0.4.56 (2026-10-02)

**分层倒挂治理完全收官（`已豁免` 151 → 0 · 例外清单归零）+ 数据契约统一专项 + 门禁口径修正**

- ✅ **分层倒挂治理完全收官** - `lint:arch` 的 `已豁免` 由 **151 → 0**（**首次归零**），`layer-exceptions.json` 的 `bulkExceptions` / `perModuleExceptions` **全部清空** ⇒ 今后任何跨层**值边**一律**直接报违规**（不再有沉默容忍）。四类手法：**物理归位**（`AttachmentManager` → `services/file/`）· **层再分类**（`tokenBudget` / `compaction` 归 app、`scripts` 归 entry）· **端口注入**（`CoreAPIImpl` 依赖反转：新增 `setCoreApiAppDeps()` 注入缝 + 组合根注册；8 符号注入 / 7 符号动态化）· **删死码**
- ✅ **死码清零** - `commands/builtin/**/*UI.tsx`（**90 文件**整棵零引用子树）· `core/flows/`（5 文件）· `analytics/CostTrackerPassesHook.ts` · `streaming/StreamEventInk.tsx` · `commands/tools/remote/remote-session.ts`
- ✅ **数据契约统一（跨模块同名簇消名）** - `Message` 7→1 · `SessionContext` 3→1 · `Context` → `HelpContext` · `Tool` 2→1 · `CheckpointStorage` → `TAORCheckpointStorage` · `PermissionMode` → `ToolPermissionMode` · `parseContextLimitFromError` → `parseContextOverflowSignal` · `core/types Message` → `ProtocolMessage`
- ✅ **会话链路类型归一（B11/B14）** - `chat/types/*` **拍平**迁入 `session/types/`；`Context` 家族下沉 `types/context.ts`；`ContextWindowResolver` 解除对 `ai` 的静态耦合（改 infra 缓存 + 同步推入）
- ✅ **门禁口径修正与可见化** - `R00-001` **不计纯 `type-only`** 跨层引用（改为**仅上报**）；测试文件在 `R00-001/003` 与 `R03-002` **同口径排除**；`R05-013` 落点口径（工具契约改落 `utils/toolContract`）⇒ 类型中心冲突 **20 → 0**；`R02-002` 同名导出冲突清零
- ✅ **B18 工具端口化** - 工具契约下沉 `utils/toolContract/`（原址 9 转发）+ 工具端口注入 ⇒ `services -> app` 归零
- ✅ **质量** - `typecheck` 0 错 · `lint:arch` **违规 0 / 已豁免 0**（type-only 6 · 动态 33，**均仅上报**）· 启动路径冒烟通过 · 预存问题逐项登记（`project_rules §1.16` 表述不准 · `batch-test-all` 的 `INDEX_PATH` 失效 · `cli.tsx` 无 `import.meta.main`）

#### v0.4.55 (2026-09-30)

**分层倒挂治理收官（A/B/C 类）+ 门禁盲区可见化 + 通道清单归一 + 死代码与陈旧副本清零**

- ✅ **分层倒挂治理收官（C1）** - 静态面 `已豁免` 逐批收敛至 **220**；动态面新增门禁 **`R00-003`**（动态 `import()` 造成的跨层引用，warning 级上报）并把它从 **95 → 28**；**三类真实错层（⑥ 真倒挂 / ⑤ 装配本体错层 / ② SPI 家族）全部归零**，余下均为"设计即如此"或测试文件（详见 `.trae/specs/layer-inversion-a-class-inventory.md`）
- ✅ **`core` 下沉与门面化** - `abortReason` / `errorCodes` / `errors` / `errorHandler` / `lazySingleton` / `loggerFacade` / `profilerFacade` / `pricing` / `tracingFacade` 下沉 `core` 模块根；core 对 infra 的消费改走**门面 + SPI**（日志门面化 + SPI 延迟绑定 / 注册前缓冲回放），消除 `core → infra` 倒挂
- ✅ **SPI 家族扩建至 8 个（引入"推送模型"）** - Logger / OTel / Profiler / Broadcast / PluginSystem / AiAccess / DiagnosticsProbe / Knowledge；实现体集中到 `entrypoints/spiWiring.ts`，由**入口侧装配后推入**容器 ⇒ 消除 SPI 自身反向导入产生的跨层对；未注册一律 noop / 空值降级
- ✅ **服务层端口化（`runtime/api/*OpsPorts`）** - 新增 **12 个端口文件**（ai / buddy / commands / knowledge / pluginAdmin / project / query / skills / task / thirdPartySkill / tools / workspace），替代 `runtime → app` 的直接领域依赖
- ✅ **门禁盲区可见化（`core/LazyModuleStrategy`）** - 字符串路径表改为**字面量 thunk 表**：把"藏起来的依赖"变为门禁可见（`R00-003` 18 → 28，**数字变差但真实** —— 该规则设计目的即让盲区可见）；并删除 4 条失效条目（`remote` / `doc` / `mail` / `calendar`）
- ✅ **通道清单归一（4 份 → 1 份）** - 新建单一事实源 `channels/ChannelCatalog.ts`（存**位置无关的惰性 thunk**），删除 `setupChannels` / `LocalHTTPServiceHelpers` / `channel-handlers` 四处重复清单；顺带修复 `tryDynamicRegister()` 对 whatsapp / signal / matrix **恒返回 false** 的漂移缺陷
- ✅ **死代码与陈旧副本清零** - 删除 `ExtensibilityService` / `StateMigrator` / `NotificationService` / `StartupPreloader` / `MemorySnapshotService` / sandbox 旧实现（4 文件）/ `EnterPlanMode` / `ExitPlanMode` / `FileSearch` / `SessionsHistory` 等 **27 个跟踪文件**；并删除 `LocalHTTPServiceHelpers` 中 `tryDynamicRegister` 的**陈旧死副本**（**P0-4 之前**版本，会**明文落库凭据**，属"复制函数致安全修复只落一份"的典型）
- ✅ **工具名编译期枚举** - 新增 codegen 产物 `constants/toolNames.generated.ts` + `scripts/gen-tool-names.ts`，工具名收敛为单一来源（含回归用例）
- ✅ **对外 Agent 协议（A2A）** - 新增 `a2a-routes` / `a2a-delegator` 与契约测试；环境变量 `A2A_ENABLED` / `A2A_API_KEY` / `A2A_PUBLIC_URL` / `A2A_DELEGATE_MAX_WAIT_MS`
- ✅ **沙箱与安全** - Landlock 网络策略两态（+ 测试）；快照存储配额治理（+ `snapshotQuota` 测试）；`PathGuard` 注册表驱动化（+ 测试）；通道进程隔离规格登记
- ✅ **错误处理与监控收敛** - 错误处理 core sink（`core/errorHandler.ts`）；监控 Logger core SPI；`shared/events/` 事件名单一来源（奇偶门禁保障两端一致）
- ✅ **回归守卫** - 全量 `bun test` = **4251 pass / 21 skip / 0 fail**（4272 用例 / 447 文件）；`typecheck` 0 错；`lint:arch` 违规 0 / 错误 0（2 条警告均为既有存量）

#### v0.4.54 (2026-09-29)

**工具层死代码清理与命名 / 错误契约修复 + PDCA 检查点性能与留存 + DAEMON 启动路径死角修复**

- ✅ **工具死实现清理（D-15 / 另案①②）** - 删除**未注册进运行时**的 `TaskTool` 4 个工具类及其 8 个孤儿文件（`TaskStorage` / `types` / `constants` / `TaskOutputUI`）、以及**零消费者**的 `tools/guardrails/` 整模块（4 文件）；并摘除 `ToolUIRegistry` 中指向已死 UI 的 4 条注册 ⇒ 源码扫描文件数 **3984 → 3972**
- ✅ **工具别名冲突 + 注册期守卫（另案③）** - 修复 `todo_write` 抢占**真实工具名** `create_task_list`（实测 `tool_search(select:create_task_list)` 指错工具、模型连续 3 轮 **0 次**成功调用）与 `video_generate` 抢占 `video`；`findToolByName` 改为**真实名优先**；`ToolRegistry.registerTool` 新增**双向别名守卫**（撞真实名 ⇒ 跳过 + warn；真实名被先前别名占用 ⇒ 摘除该别名）
- ✅ **工具入参归一化 + 失败可判定（另案④）** - `create_task_list` 复用同族文本字段兜底链（新增 `ToolUtils.pickTaskText`，与 `TodoWriteTool` **同一实现**）；失败分支统一落 `success / error / errorLevel`；`ToolExecutor.processResult` 补**顶层 `error` 回退** —— 原先只读 `metadata.error`，而该字段**全仓无人写入** ⇒ 失败原因从不进入模型视野（模型只看到 `{}`）
- ✅ **PDCA 检查点性能（另案⑥）** - 列表链路由"每次请求 `readdir` + **逐文件** `readFileSync`+`JSON.parse`"改为**文件级 `mtime`/`size` 记忆索引**：真实目录 3394 文件实测 **1032ms → ≈32ms（≈30×）**；并把 handler 内 **3 处重复内联扫描**收敛到同一索引（GR02）
- ✅ **启动异步预热（另案⑥ 补）** - 新增 `prewarmPdcaCheckpointIndex()`：**分批 + 每批让出事件循环**（预热 1.2s，事件循环**最大阻塞仅 62ms**，对比同步做法 ≈1138ms），预热后首个请求 ≈35ms
- ✅ **检查点留存策略（另案⑥ 补）** - 启动时清理"**终态或超期孤儿** + 超 **30 天**"（在跑 / 待审批**一律保留**）；真实目录 **2860 → 2798**（删 62）；判据收敛为单一事实源（`PDCA_TERMINAL_STATUSES` / `PDCA_ACTIVE_STATUSES` / `PDCA_AWAITING_APPROVAL_PHASES`）
- ✅ **DAEMON 启动路径死角修复（另案⑦）** - `launchDaemon` 末尾 `await new Promise(...)` 永久挂起 ⇒ `launch()` 尾部（「启动完成」汇总、`_appReady` 兜底、PDCA 启动扫描、`profileReport()`）在 **DAEMON 下从未执行**；抽出 `reportBootCompletion()` 并由 DAEMON 就绪点调用 ⇒ daemon 侧**首次产出**「启动完成 + 阶段耗时」（实测 `启动完成 (929ms)`）
- ✅ **会话水合死分支清理（c2）** - 删除 `SessionStateHydrator.extractTodos()`（实测**恒不命中**）及其专属辅助 `parseToolResult`、`HydratedState.todos`、两处**只写不读**的 `metadata.hydratedTodos`
- ✅ **测试隔离修复 + 夹具清理** - `pdca-list` 契约测试原为**假隔离**（模块级路径常量被 preload 链冻结 ⇒ 单测实读真实 3394 文件 ⇒ 两次调用必然越过 5s 超时 ⇒ 偶发红灯）；改**惰性解析**后该用例 **1225ms → 2.9ms**；并清理真实数据目录里被测试写入的夹具（`pdca_ck_a/b`、`d5-test-*` 529 个、`pdca_st_*` 3 个）
- ✅ **回归守卫** - 新增 `toolNameResolution` / `taskOrchestratorToolsOutput` / `pdcaCheckpointRetention` 等用例（含"删除后索引同步""守卫不误伤"等边界）；全量 `app` 侧 **4201 pass / 21 skip / 0 fail**（439 文件）、`typecheck` 0、`lint:arch` 0 错 1 警
- ✅ **工程治理** - `.trae/rules/` **13 个规则文件纳入版本控制**（原被 `.gitignore` 吞掉，现与代码同仓可 review）

#### v0.4.53 (2026-09-27)

**聊天区渲染与导出链路修复（P0–P2）+ ChatArea i18n 全量迁移**

- ✅ **工具结果信封 JSON 泄漏（三条路径）** - 工具卡合并入口统一走 `decodeToolResultContent` 解码；导出侧把 tool 消息合并进助手消息并解包 ⇒ 修复前导出件 `tool_result` 20+ 处、`🛠 role:tool` 单独成节 12+ 个、字面 `\n` 转义，修复后全部为 **0**（42KB → 10.7KB）
- ✅ **表格空单元格丢列** - `splitCells` 不再丢弃空 cell，按表头列数补齐；单测 + 突变验证覆盖
- ✅ **表格列错位 / 导出完整性** - JSON 透传块级结构化载荷（原 `any` 化丢失 `questionData` 等）、超长内容改**带标注截断**（原静默截断 5000 字）、md/json 补会话元数据（会话 ID / 消息数 / 轮数 / 导出时间）
- ✅ **导出结构保护** - 闭合未配对的代码围栏（原奇数个 ``` 会把其后 5 条消息的角色标题吞进代码块，md/html/word 三格式同源受影响）
- ✅ **会话导出新增 HTML / Word** - 复用既有 `exportMessageAsFormat`（不另立实现），导出菜单 2 项 → **4 项**
- ✅ **长会话滚动位置恢复（D5=B）** - 锚点改由 **DOM 几何**判定顶部可见项并**延后一帧**读取（原读 `getVirtualItems()[0].index`：含 overscan 且为上一帧范围，实测偏差约 9–10 条）；真机 A（重载贴底）/ B（切走切回恢复阅读位置）/ C（手动滚动不被抢回）三项全通过
- ✅ **轮次导航在虚拟列表下可达** - 改走 `highlightedRoundId` / `scrollToMessageId`，不再依赖离屏 DOM 的 `querySelector`（原点击较远轮次静默无反应）
- ✅ **会话切换整表重排（P2-9）** - 排序主键 `lastEventSeq` 缺失者不再按 `0` 兜底顶到最前（改为"全体具备才用该主键，否则回退 timestamp 序"）
- ✅ **ChatArea i18n 全量迁移（P2-1）** - 用户可见 UI 文案全量迁至 `react-i18next`（zh/en 成对维护，`chat` 段按轮次分组）；**未登记枚举一律回退后端原值**，不臆造映射；ChatArea 内已无裸中文文案
- ✅ **可访问性（P2-5 剩余）** - hover-only 操作改键盘可达（`focus-visible` / `group-focus-within`）、补可访问名、`ChatMessage` "⋯" 菜单完整键盘导航（Esc 关闭并归还焦点 / ↑↓ 移动 / 关闭态 ↓ 打开）、`DAGFullScreen` 与 `SaveKnowledgeModal` 补 `dialog` 语义、`StatusFloatBar` 展开指示改真 `<button>`（`aria-expanded`）
- ✅ **导出性能与规模（P2-7）** - 后端导出改**边分页边 `res.write`**（jsonl 逐行）+ `writeWithBackpressure` 背压控制（客户端断开即停止，避免无界缓冲与悬挂连接）；前端导出逐条累加、**每 20 条让出事件循环**（JSON 产物与 `JSON.stringify(…, null, 2)` 逐字符一致）
- ✅ **零散修复（P2-8）** - `InboxBlock` 过期倒计时改 30s 心跳（原渲染期一次性快照）、`OfficePreview` docx 暗色滤镜链修正（图片不再被一起反色）、`DebugBlockInfo` 无界 `title` 截断、回复引用截断补 `title`、`SessionHeader` 标题输入宽度类化
- ✅ **死代码清理（P2-3）** - 删除 5 个零引用文件 + `PdcaActivityStrip` 组件本体（保留仍被复用的具名导出）
- ✅ **工程修复** - 导出 Diff 文案「接受/拒绝」改「复制 diff / 忽略此改动」并提示不会自动改动文件；`GroupStatusLine` 收敛为结构化 `status` 精确匹配（CS02）；`exportMessage.ts` 源码裸 NUL 字节改 `\u0000` 转义（原被 git 判为二进制、**无法逐行 review**）
- ✅ **回归守卫** - 新增 `exportFenceBalance` 等用例，关键用例做**突变验证**（还原旧实现即转红）；门禁 `client` 49 文件 / 471 用例全绿、`app` 相关子集 291 用例 0 失败、双端 `tsc --noEmit` 0

#### v0.4.52 (2026-09-27)

**长等待期可见性（等待态）+ 自发轮次模型归属修复（记账 / 窗口 / 估价）**

- ✅ **长等待期"仍在干活"可见性** - 后端 `/v1/sessions/:id/streaming` 增 `pendingWake`（自唤醒待触发项按会话过滤 / 排序）；前端新增 `useWaitState` 派生等待态，浮动栏第 4 态显示「⏳ 等待中，预计 N 秒后自动继续」（静态蓝点、倒计时实时递减），`YieldNoticeBar` 收敛为仅展示未决 yield；已真机端到端复现（真实工具 + 真实端点 + 真实浏览器）
- ✅ **自唤醒丢唤醒修复** - 四处登记改为 load → 追加 → save 的**合并写**（原整文件覆盖会在并发登记时丢失唤醒）
- ✅ **用量归因 `model=unknown`** - 三处记账点改取 provider 回显模型（复用既有 `extractModelFromResponse`，未新增实现）；修复前回落兜底价 `$3/M in · $15/M out` 使**金额高估约 7.8×**（真机 `unknown … $0.0747` → `deepseek-v4-flash … $0.0096`）
- ✅ **发送前模型归属（窗口 / 压缩 / 估价）** - 新增只读 `resolveEffectiveTurnModel({ explicitModel, client, sessionId })`：取值链「显式 → provider 级默认模型 → 路由档位（`skipJudge`，不进 LLM Judge）」，**零额外模型调用**、不改实际请求路由；StreamPipeline 与 orchestrator 三路径（`sendMessageFlow` / `streamMessageFlow` / `preSendContextProtection`）的窗口 / 阈值 / 压缩 / 估价站点统一解析一次后复用 —— 自发轮次（续跑 / 自唤醒 / PDCA / 空闲续接）不再回落硬编码 128k，避免长会话过压 / 过截或保护不足
- ✅ **回归守卫（含突变验证）** - 等待态派生、`resolveEffectiveTurnModel` 取值链、用量归因与**窗口 / 估价归属防漂移**（还原旧写法即转红）
- ✅ **CI 修复** - ubuntu 的 `PYAPP_DATA_DIR` 跨用例污染（收尾恢复 env）；`globAsync` 的 `beforeAll` 显式 30s 预算（Windows runner 上偶发超出 hook 默认 5s）

#### v0.4.51 (2026-09-26)

**长任务被误杀（token 预算）根因修复 + 工具名漂移家族收口 + 可诊断性**

- ✅ **长任务误杀根因（流式 + batch 双路径）** - `reActLoop:budget_exhausted` 在长任务中途反复出现（实测 `iteration 114 / maxIterations 190` 即被掐断）。根因是**预算记账量纲错**：用 `estimateMessagesTokens` 估算，实测与 provider 真实 `prompt_tokens` 相差 **6.4×**（真实 29,143 vs 记账 185,195 / 200,000 = 93%），且该值在长会话中**单调不降**（压缩期间零回落）⇒ 对称记账的"退款"分支永不触发。现两条路径均改用 provider **真实 `usage.prompt_tokens`**：流式取 `ChatResponse.usage`；batch（TAORLoop / PDCA / 子代理）从 `callModel` 块的 `usage` 捕获（此前被 `...lastChunk` 展开丢掉，这正是"只能退回用估算"的原因）。无 usage 时**不记账**（fail-open：宁可少一道兜底，也不误杀）。
- ✅ **窗口口径统一** - 两条路径的 `total` 原取**价格表**（实测 200,000），与 `UnifiedTokenTracker` 的 `resolveContextWindow`（实测 128,000）不一致 ⇒ 阈值线失准。现统一为后者（用户显式 `budgetConfig.maxTokens` 仍优先）。⚠️ 单独回退窗口会**放大**误杀，务必与量纲同批评估。
- ✅ **可诊断性** - `reActLoop:budget_exhausted` / `budget_grace_call` 补 `sessionId`（此前同级日志都带、唯它不带 ⇒ 只能靠时间戳反推会话）。
- ✅ **工具名漂移家族收口** - `PathGuard`（路径守卫曾对真实工具名**完全不生效**）、`query/tool-constants`（含调用链入参键）、`tools/orchestration`、`promptSuggestion`、`tools/sandbox` 等处的工具名清单统一为真实注册名；三份同名 `WRITE_TOOLS` 按「共享取值 + 各自命名」收敛（`SPECULATION_WRITE_TOOLS` / `SERIALIZING_TOOLS`），并删除 lint 中随之失效的同名豁免。
- ✅ **测试** - 新增回归守卫：单轮记账量纲、**长任务端到端不误杀**（loop 级，用生产同款预算）、batch 侧量纲、`FileIOLoopDetector` 生效断言、工具名清单防漂移（原 3 红转绿）；关键用例均做**突变验证**（还原旧实现即转红）。
- ℹ️ 本次发布同时包含工作区内其他并行改动（`sandbox` / `evals` / `session` / `modules/doc` 等），明细以本版本 commit 为准。

#### v0.4.50 (2026-09-21)

**多 Agent 协作优化（B6/B7）、专项缺陷修复与工程护栏**
- ✅ **AgentTool 台账与描述符解析链（B6）** - AgentRunLedger 改共享单例 + 显式状态机 `canTransition`（`running → cancel_requested`、`running|cancel_requested → completed|failed`）；AgentRunStore 持久化新增 `descriptor_source` 来源列与 PID 复用判定（比对 `owner_started_at`，容差 5s）；四级描述符解析链（DB 角色 → 运行时注册表 → 内置类型 → **fail-closed 拒绝**）
- ✅ **委派授权与控制面归属** - `agent_roles.can_delegate` 双判据合取（角色策略 ∧ 父侧深度上限），模型不可自选；控制面归属校验 fail-closed（owner 缺失即拒绝）；新增 Tier1 血缘链 `sessionLineage`（fork 即登记，支持多跳祖先判定）
- ✅ **Agent 统一管理界面与运行态 API（B7）** - 新增 `/v1/agents/control`、`/v1/agents/runs`（字段裁剪守隐私边界）、`pause`/`resume`/`stop` 路由；角色 HTTP 层补 model 三道判据校验；前端角色页模型下拉（按 `modelId` 口径）+ `canDelegate` 授权位 + 「运行态」面板；`CouncilAgentRolesPage` 超限拆分出 `AgentRuntimePanel`（969 → 735 行）
- ✅ **嵌套委派真机实证** - 以真实 provider 驱动「顶层 → architect → security」两级嵌套，OTel 证据 `tools.count 59 / 58` 量化授权位生效（父被授权持 Agent、子未授权被剔）；修复**子代理工具池恒为空**（N-41，归一至唯一注册表 `getToolRegistry()`，真机 `tools.count` 0 → 59）
- ✅ **media 工具名规范化（N-42）** - 15 个工具 `media:<域>:<动作>` → `media_<域>_<动作>`，修复其冒号违反 MCP 命名规范导致 DeepSeek 返回 400 并拒绝**整个 tools 数组**（子代理与顶层非流式路径均受影响）；顺带修复 `MediaDelete` 审批键与注册名不一致（审批永不命中）
- ✅ **工程护栏** - 新增 `lint:exit`（入口脚本显式退出）与 `lint:refs`（引用可达性）两项 CI 检查，上线即查出 3 处引用断裂（`memory`、`bin.liri-memory`、`test:reporter`）；`build:update:win` 原指向从未存在的脚本，改用 `package.ts --update-only`
- ✅ **启动性能** - `extended.ts` 惰性化重量级依赖，`i18n:check` **9.37s → 0.21s**（约 **44 倍**）；根因为静态 import `@modules/error` 连带拉起 DB 建表 / OAuthService / TaskComplexityClassifier
- ✅ **稳定性修复** - 连接状态机 `start()` 幂等判定与真实资源脱钩致健康检查停摆（N-47，修复后后端真掉线可正常转 `disconnected`）；长任务编排误调 `AIService` 上不存在的 `chat()`（N-44）；代码执行器改用进程组终止消除孙进程残留（O4）；测试写入隔离避免污染生产台账（N-46）
- ✅ **CI 全绿** - `bun run ci` 全链 EXIT=0 · 3029 tests / 0 fail · 双端 typecheck 绿 · client 244 passed

#### v0.4.49 (2026-09-10) （git 历史补录）

> 实质提交 **3** 条：fix 1 · build 1 · style 1

- tauri.conf.json version 0.4.48→0.4.49（bump 漏改此处）
- 单档矩阵收敛——退役 personal/pro 双档，full 全量构建为运行时 tier 预留
- eslint --fix 格式化资产选择链（单档收敛后续）

#### v0.4.48 (2026-09-09) （git 历史补录）

> 实质提交 **19** 条：fix 10 · style 4 · build 3 · feat 1 · refactor 1

- personal 双档运行时隔离 + CI/产物/updater edition 化（专项 P1-P3）
- NSIS smoke sidecar 去后缀事实修正 + Rust cache 跨档污染 + bundle 残留二次后缀
- sidecar cwd 锚定安装目录修复 bun compile external 解析 + NSIS smoke 路径事实修正
- Windows zip 打包 pkg\* 经 bash 转义致条目带 pkg/ 前缀，smoke 找不到运行时
- bun runtime shim 误复制根因修复 + portable 变体参数化 + smoke 注解诊断
- Windows smoke 解压改用 Expand-Archive（Git-Bash 无 unzip）+ 失败诊断写 step summary
- …（另有 13 条实质提交，详见 `git log v0.4.47..v0.4.48`）

#### v0.4.47 (2026-09-09) （git 历史补录）

> 实质提交 **35** 条：feat 16 · fix 9 · style 5 · chore 2 · refactor 1 · docs 1 · build 1

- 打包资源契约——ffmpeg 内置化（内置优先/PATH 兜底）
- openai-gateway 通道完善（dawate 私有化网关路由/UI/API 规格）
- 新增「私有化部署」供应商（dawate 智能体平台 v3/chat 协议）
- 文件管理与知识库协同收敛（去重呈现/记录出处回链/已入知识库状态）
- 知识库优化收官 B0-B10/F1-F5/D1-D5 + UI 走查 P1/P2 全量
- R5 引用锚点渲染（识别 #p.N/#L42-L58 → 点击打开本地文件定位）
- …（另有 29 条实质提交，详见 `git log v0.4.46..v0.4.47`）

#### v0.4.46 (2026-09-07) （git 历史补录）

> 实质提交 **40** 条：fix 20 · feat 18 · refactor 1 · chore 1

- 文件管理 P0-P2/L 修复、chat 轨迹与 PDCA 收口、research/pattern 模块批次
- 会话删除联动 PDCA 终态化收口（阶段一 4.2-5）
- project 会话判定收敛单一换算（阶段一 4.2.1）
- 注册 project 模块实体 + emoji meta（阶段一 4.2.2）
- /v1/sessions 项目会话判定收敛（阶段一 4.2.3 双读）
- PDL 快速路径注册 checkpoint 任务实体（4.0-2 N1）
- …（另有 34 条实质提交，详见 `git log v0.4.45..v0.4.46`）

#### v0.4.45 (2026-09-02)

**上下文治理与内存水位机制（OS 内存管理式）**
- ✅ **上下文分层治理落地** - D7 事件索引（events.idx 二分定位 + UTF-8 偏移 + 损坏行区间降级）；A text-batch 正文聚合（64KB/2s，事件数 10K→169/622）；B0/B1 滑动窗口快照 + 热窗 ≤10K + 缓冲下沉存储层；C 请求分层（token 动态分页点 + `session_lookup` 按需取回 + CONTEXT_LAYERING 开关）；D 摘要事件化（session/summary）+ 跨会话记忆上卷与检索适配器
- ✅ **会话中断与内存尖峰排查修复** - 优雅关闭防 torn（全会话缓冲先落盘）、图谱提取节流、MEM_PROFILE 内存画像插桩、单轮长任务 45K 分层压缩触发、MemoryStore flushBatch 竞态根治
- ✅ **内存水位触发机制** - OS kswapd 式 L0/L1/L2 分级回收（flush 脏页/后台让位/窗口收紧 45K→32K），内置事件循环滞后探针（GC STW ≥2s→L1 / ≥5s→hard）+ 反向放宽（thrashing 防护）+ 压力期自动逐点采样
- ✅ **基准验收** - P3-7f 同源长任务真实重测：事件数 PASS、单请求 inputTokens 封顶 ≈45K（较基线 124,475 降 64%）、会话数据内存 4-24MB/会话达标
- ✅ **D5② 代码/长文档取回增强** - 代码/文档类任务分层切窗时注入更强"原文可取回"提示，`session_lookup` 页预算 8K→16K chars（判定 `isCodeContextMessage`，stream/send 双路径；内存仍受 ctx 压缩点保护）

#### v0.4.44 (2026-08-31) （git 历史补录）

> 实质提交 **13** 条：fix 8 · refactor 1 · test 1 · chore 1 · ci 1 · style 1

- P3 前端交互专项 — 标题双写竞态/确认框防连点/虚拟滚动前插测量缓存
- 前端遗留专项 — 补 DELETE /v1/workspaces/:id 路由 + 删除 projectStore 死代码
- tests/ 类型错误 491 个清零并纳入 typecheck 覆盖
- child_process mock 泄漏修复 — 全量 bun test 隔离污染根因
- 修复预存测试失败 — Python 子进程编码、ReActLoop 桶 TDZ、知识库路径重设、ai 桶导出补齐
- Release 测试范围统一（bun test tests/）+ Dockerfile external yoga-layout 修复构建
- …（另有 7 条实质提交，详见 `git log v0.4.43..v0.4.44`）

#### v0.4.43 (2026-08-30) （git 历史补录）

> 实质提交 **153** 条：fix 89 · feat 25 · refactor 25 · chore 6 · style 3 · perf 2 · test 2 · docs 1

- 事件快照缓存补齐对标短板（dsh eventsSnapshot）+ 损坏行恢复 excludeTypes 修复
- 记忆索引/关系图谱接入统一信封格式(gzip+checksum)
- 记忆文件压缩 + checksum 校验（L1 深化，对标 dsh 存储工程化）
- 对标报告短板补齐 - 存储工程化 / MCP 开放接口 / 真实 embedding
- 长会话分页懒加载（阈值触发：超 100 条显示加载更早，后端 limit/before 分页）
- 错误面板新增继续按钮（先落盘再基于已生成内容续写）
- …（另有 147 条实质提交，详见 `git log v0.4.42..v0.4.43`）

#### v0.4.42 (2026-08-18) （git 历史补录）

> 实质提交 **6** 条：feat 2 · fix 2 · chore 2

- 渠道模块 26 项问题修复 + 可观测性指标 + 僵尸代码清理
- fetchWithConnectionRetry 增加详细重试日志（间隔/原因/底层 cause）
- Provider 连接错误与 SSL 证书验证兼容 Bun 运行时
- OpenAI 流式连接失败诊断增强（展开 fetch cause：DNS/端口/超时）
- 续期 20 条分层例外（BULK-001~018 + PM-001/002，60 天衰减到期）
- BaseAIProvider 重试日志 cause 断言格式化（eslint --fix）

#### v0.4.41 (2026-08-17) （git 历史补录）

> 实质提交 **5** 条：fix 3 · feat 1 · chore 1

- handleCreateCustomModel 与邮件读取关键分支加详细日志便于排查报错
- 办公模块复查 N-3~N-9 修复（邮件 UID/正文拉取、日历提醒与生命周期）
- 前后端同步 isCustom 字段（创建模型标记自定义）
- 模型管理添加模型失败（20 values for 21 columns）
- eslint 自动修复 + 版本升级 V0.4.41

#### v0.4.40 (2026-08-17) （git 历史补录）

> 实质提交 **38** 条：fix 24 · style 5 · feat 3 · ci 3 · refactor 1 · test 1 · chore 1

- extractMailBody 关键分支加日志便于排查 MIME 解析异常
- 模型价格体系——官方价格源/分时/按次计费 + 前端价格展示与一键同步
- AI 回复气泡导出（md/html/word，含数学/物理/化学公式渲染）
- 邮件详情显示真实正文（IMAP body 解析纯文本）
- 办公模块复查 N-1/N-2 打通下载与上传 + 遗留低危项
- OpenAI 流式断连自动重试 + 修复 OfficeCLIDetector prettier 格式（CI lint 失败根因）
- …（另有 32 条实质提交，详见 `git log v0.4.39..v0.4.40`）

#### v0.4.39 (2026-08-15)

**安装与打包修复**
- ✅ **安装目录启动崩溃修复** - 安装到 Program Files（只读）后 EPERM 崩溃，会话存储迁移至 `~/.pyapp/data/chat_sessions`
- ✅ **SOUL_PATH 数据分散修复** - pyapp.ts 延迟加载 handleError，消除 paths.ts 在 LIRI_HOME 设置前的早期求值
- ✅ **external 依赖检测修复** - `~BUN` 虚拟路径判断失效改用 `process.execPath`；sharp/pdfjs-dist 改为文件级探测（probeExternalModule），消除编译产物误报
- ✅ **发布单元机制** - 新增 `build:win:coding:dist` 打包脚本，exe + node_modules 整体分发

#### v0.4.38 (2026-08-15)

**稳定性与 CI**
- ✅ **CI 全绿** — E2E 故障注入测试、三平台 Test Suite、静态检查全通过
- ✅ **E2E 适配新 UI** - Agent 任务管理迁移至 /agent 页面，重写对应测试
- ✅ **版本号一致性** - sync-version.ts 统一同步 6+ 版本文件

#### v0.4.37 (2026-08-14)

**会话链路与稳定性**
- ✅ **会话链路排查** - TAORLoop 污染、水位告警降噪、估算系数校准、删除 404 修复
- ✅ **压缩超时根治** - 超时保护收敛到 Tier3、保留 Tier2 成果、60s 上限、2560 摘要窗口
- ✅ **会话不物理删除** - SSE 鉴权白名单、fetch 补充 Bearer
- ✅ **知识库编码支持** - GBK/GB18030 编码自动检测

#### v0.4.36 (2026-08-04) （git 历史补录）

> 实质提交 **11** 条：fix 8 · feat 2 · chore 1

- 阶段偏好改为直接选择模型（phase → modelId）
- 任务分工新增「知识库编译」任务类型，支持独立配置编译模型
- CI lint 失败 — 修复 6e61f4d4 引入的 prettier 格式违规
- 打包后 sharp 找不到 — Bun compile external 解析修复（autoload flag + chdir + 同级 node_modules）
- 语义索引构建刷屏 — rootDir 兜底 + embedding 失败熔断 + 进度日志节流
- Dream 精炼与记忆精选模型显式走 modelRouter，消除同类 Kimi-K2.6 400
- …（另有 5 条实质提交，详见 `git log v0.4.35..v0.4.36`）

#### v0.4.35 (2026-08-04) （git 历史补录）

> 实质提交 **137** 条：fix 53 · feat 45 · refactor 17 · chore 11 · docs 8 · other 3

- 全模块监控覆盖 — handleError/OTel 统一入口
- PDCA 思维注入普通聊天 + 项目桥接建议
- 隐性引擎升级通道 — 检测到 goal 自动发起完整 PDCA 循环
- Project.pdcaIds 归属字段 — PDCA 任务反向索引到项目
- 讨论记录 — ProjectHistoryStore 追加式落盘 + 两级展开面板
- PDCA 后台集成 — WorkItem 联动 + 归属打通 + 幂等 + 启动扫描
- …（另有 131 条实质提交，详见 `git log v0.4.34..v0.4.35`）

#### v0.4.34 (2026-07-16) （git 历史补录）

> 实质提交 **2** 条：fix 1 · refactor 1

- 恢复 Tauri sidecar 编译脚本（build:win:coding/build:mac/build:linux --compile）
- 废弃 standalone-exe，全量切换到 portable-bundle

#### v0.4.33 (2026-07-16) （git 历史补录）

> 实质提交 **6** 条：feat 2 · fix 2 · chore 1 · ci 1

- Office 模块（Doc/Calendar/Mail）+ CronScheduler 状态转移修复
- 便携 Bun + bundle 打包 CI/CD 完善，版本升级至 v0.4.33
- copy-bun-runtime 跨平台兼容（Linux/macOS which + bun 无 exe 后缀）
- CronScheduler inFlightJobs 去重防止 catchUpMissedJobs/tick 竞跑双次执行
- 版本同步至 v0.4.33（6 个文件统一）
- lint-test 中 bun test 允许预存 flaky 测试失败不阻断 pipeline

#### v0.4.32 (2026-07-16) （git 历史补录）

> 实质提交 **3** 条：fix 2 · feat 1

- 便携 Bun + bundle 打包架构（方案 C）
- 媒体页面图片编辑、对比、删除交互问题修复
- security-full-audit-report 全面修复整改

#### v0.4.31 (2026-07-15) （git 历史补录）

> 实质提交 **9** 条：feat 6 · chore 2 · fix 1

- media page comprehensive optimization — 33/33 tasks complete
- Loop optimization Phase 4 complete -- VerifierAgent, StreamingToolExecutor, failure modes & anti-patterns docs
- Loop module comprehensive optimization — Phase 1-3.5 planning + eslint fixes
- loop-engine optimization + chat UI redesign + media tools
- loop-engine 优化 + 聊天界面 UI 改造 + 多媒体工具
- add path utilities — traversal check, cross-platform compare, tilde expand, display path, sanitize
- …（另有 3 条实质提交，详见 `git log v0.4.30..v0.4.31`）

#### v0.4.30 (2026-07-13) （git 历史补录）

> 实质提交 **61** 条：feat 25 · fix 21 · docs 5 · refactor 3 · chore 3 · test 2 · perf 1 · bench 1

- translation page full optimization — voice input, live translate, OCR image translate, alternatives, compare mode, share, UI polish
- P1-3 content templates (4 templates), P1-6 batch move-to-base, P2-3 send-to-chat button, P2-6 search snippet expand + keyword highlight
- P1-9 soft-delete trash/restore, P1-10 knowledge export (JSON manifest download)
- P1-5 compile progress bar, P1-1 concurrent batch upload (5x), P1-2 source distribution chart
- P0-1 server-side pagination (offset/limit + pagination UI controls)
- P1-4 SaveKnowledgeModal combobox, P1-7 auto-save + draft recovery, P1-8 empty state guide buttons
- …（另有 55 条实质提交，详见 `git log v0.4.29..v0.4.30`）

#### v0.4.29 (2026-07-09) （git 历史补录）

> 实质提交 **1** 条：feat 1

- image recognition pipeline overhaul — enforce task-routing, remove hardcoded provider fallbacks, bump to v0.4.29

#### v0.4.28 (2026-07-09) （git 历史补录）

> 实质提交 **44** 条：fix 31 · refactor 5 · chore 4 · feat 3 · ci 1

- runtime architecture hardening (4 optimizations)
- ChatManager模块拆分 Step 3-6 完成 + 安全网脚本
- ChatManager模块拆分 Step 1-2 + 图片URL固化
- CanvasTool — add element validation, enhance element structure docs, support custom export path
- remove non-existent configs/ COPY from Dockerfile runtime stage
- expand Docker build context to include shared/ for @shared/* path aliases
- …（另有 38 条实质提交，详见 `git log v0.4.27..v0.4.28`）

#### v0.4.27 (2026-07-06) （git 历史补录）

> 实质提交 **25** 条：fix 24 · feat 1

- 测试环境使用 :memory: 内存数据库，消除文件系统依赖
- build.rs 动态创建 externalBin 所需的精确文件名占位符
- Build sidecar 步骤添加调试输出，诊断 liri_coding 二进制是否产出
- 增强 sidecar 复制容错性，用通配符查找二进制 + 构建后归一化文件名
- sidecar 二进制路径从 app/dist 改回 dist，匹配构建脚本 --outfile
- 修复 sidecar 复制路径 ../dist 为 ../app/dist + build.rs 在 binaries/ 下放占位文件
- …（另有 19 条实质提交，详见 `git log v0.4.26..v0.4.27`）

#### v0.4.26 (2026-07-05) （git 历史补录）

> 实质提交 **5** 条：fix 3 · chore 2

- CI编译失败 — CommandEvent match 添加 #[non_exhaustive] 通配分支
- 后端 sidecar 崩溃诊断 — 捕获 stderr/退出码，前端展示错误信息
- GrokProvider 缺少 logger 导入 + BaseAIProvider dispatcher 类型断言
- pre-commit hook 添加 ESLint 检查 + ESLint auto-fix
- 版本号更新至 v0.4.26

#### v0.4.25 (2026-07-05) （git 历史补录）

> 实质提交 **9** 条：fix 3 · chore 3 · feat 2 · docs 1

- 聊天输入区增加图片上传与多模态发送（P1-2.1）
- 重构图像模块，新增 Canvas 编辑器 -- 画笔/橡皮擦/形状/文字/选区/油漆桶等工具, ImagePage 组件拆分, ErrorBoundary, 修复 ToolCallGroup 图片显示, 删除 ImagePasteReceiver
- 修复客户端测试 — Path2D/ImageData polyfill + services.test 断言适配
- Windows 新环境部署兼容性修复 -- .env 路径、BashTool 平台适配、Git SSL
- 图像生成 Provider 路由和 fallback 链修复 -- ProviderSyncService 移除 generateImage stub, getRouter 改为模型驱动精确匹配, Router generate 修复 break 后未 return 的 Bug, RegistryImageProvider 新增 providerId getter
- 图像模块与聊天模块集成方案（P1-P3 三阶段渐进式）
- …（另有 3 条实质提交，详见 `git log v0.4.20..v0.4.25`）

#### v0.4.20 (2026-07-03) （git 历史补录）

> 实质提交 **14** 条：feat 8 · fix 5 · chore 1

- 基础设施升级完善 — 日志系统整改、监测覆盖补齐、预存类型错误修复
- 图像模块全栈优化 — 多Provider架构、生图路由、Bug修复、ESLint格式化
- v1 P1-2 agent filter tab in sidebar + v1 doc status corrections
- v2 Phase 1-3 complete - http migration, compression events, blocks fix, race fix, knownFilePaths, i18n, cache, reentry
- session system v2 optimization Phase 1-3 - http migration, compression events, blocks consistency, race fix, i18n, cache
- session system v1 optimization - memory vectorization, REST API, pruning/compaction, frontend UX
- …（另有 8 条实质提交，详见 `git log v0.4.10..v0.4.20`）

#### v0.4.10 (2026-06-28) （git 历史补录）

> 实质提交 **1** 条：fix 1

- STT model path standardization, Tauri startup, and React Hook deps

#### v0.4.9 (2026-06-28) （git 历史补录）

> 实质提交 **8** 条：fix 3 · feat 2 · i18n 2 · tools 1

- 图像工具全栈优化 + 前端全量 i18n 国际化
- P0 StdIO bridge — Python vision_worker + process lifecycle + watchdog
- use findAllByRole (async) for e2e delete button queries
- e2e tests — i18n mock, aria-label, role-based queries
- i18n full coverage + install env compat + Vite proxy + ESLint zero
- settings config page fully translated — 71 hardcoded Chinese strings fixed
- …（另有 2 条实质提交，详见 `git log v0.4.8..v0.4.9`）

#### v0.4.8 (2026-06-27) （git 历史补录）

> 实质提交 **12** 条：fix 8 · feat 3 · chore 1

- 语音模块 P0 级优化 — STT/TTS 缓存、故障转移链、音频前处理、分片合成
- ESLint 格式修复 + 聊天/会话/工作区模块功能增强
- TTS 模块功能增强 — Edge TTS 修复、日志/错误归一化、Persona 管理及前端页面
- LSP 性能测试 CI 失败 — 放宽阈值 + 添加 getAllLanguages 缓存
- 修复新环境 C:\Users\Default 路径错误导致后端无法启动
- 修复 client 端 12 个 TypeScript 错误
- …（另有 6 条实质提交，详见 `git log v0.4.7..v0.4.8`）

#### v0.4.7 (2026-06-25) （git 历史补录）

> 实质提交 **3** 条：feat 2 · fix 1

- TTS 模块补充 OTel/Logger/HandlerError 全路径监控覆盖
- 语音服务模块重构 — TTS/STT 优化 Phase 0-2 方案落地
- 提交 bun.lock 文件并修复 workflow 中 lockfile 引用路径

#### V0.4.6 (2026-06-24) （git 历史补录）

> 实质提交 **6** 条：fix 3 · feat 1 · chore 1 · style 1

- 实现多 Agent 编排系统、AI 提问渲染修复及 Prettier 格式修正
- 将 console 调用迁移至 Logger，修复 CI Console usage gate 超标问题
- 修复 AI 提问面板选项显示异常及会话上下文断裂问题，扩展多 Agent 编排事件系统
- 修复 Tauri 编译错误及添加 question block 调试工具
- 移除 .trae/rules/project_rules.md
- 修复 SwarmCoordinator.ts Prettier 格式问题（多行字符串折叠为单行）

#### v0.4.5 (2026-06-23) （git 历史补录）

> 实质提交 **5** 条：fix 3 · feat 1 · style 1

- 新增安全审计日志系统与操作回滚模块
- 修复 AI 提问面板不显示、增加危险操作警示音与任务完成提示音
- PermissionPolicies.ts platform 变量使用 UnifiedRulePlatform 类型
- 修复删除规则 TC03 缺口、cmd 平台支持及循环依赖问题
- Prettier 格式化修复 PermissionPolicies.ts 第 10 行 import 换行

#### v0.4.4 (2026-06-23) （git 历史补录）

> 实质提交 **4** 条：fix 3 · feat 1

- 实现 Agent Council 理事会功能 + 专家角色数据库持久化管理
- 修复会话标题自动生成缺失及跨轮对话失忆问题
- 统一中文文件名处理逻辑，复用 fileNaming.ts 共享工具函数
- 修复 route-table.ts 中 ctx→handlerCtx 命名错误及 CouncilTypes.ts 缺少 agentId/agentName 字段

#### v0.4.3 (2026-06-23) （git 历史补录）

> 实质提交 **12** 条：fix 4 · chore 3 · feat 2 · style 2 · ci 1

- 工具执行块头部摘要"说人话"及间距优化
- 将工作空间切换从侧栏迁移至 Header 右上角
- 修复首次安装后后端启动失败(Windows error 267) + 移除本地注册登录
- 修复 BootPipelineIntegrator 编译错误，ESLint 格式化
- 已完成工具执行块在页面加载时应自动折叠
- 移除工具参数的 Unicode 清理，防止 NFKC 归一化破坏全角文件路径
- …（另有 6 条实质提交，详见 `git log v0.4.2..v0.4.3`）

#### v0.4.2 (2026-06-21) （git 历史补录）

> 实质提交 **84** 条：fix 52 · feat 14 · refactor 8 · other 4 · chore 2 · style 2 · docs 1 · ci 1

- 实现工作模块完整骨架（Phase 0 + Phase 1-A/B/C）
- 会话来源标签 + 欢迎页开始聊天按钮
- 方案C结构化进度管道 — ProgressEvent 类型定义 + ChatManager 8处进度注入 + channel-handlers onProgress 消费
- 新增 StatusFloatingBar 组件并修复 CI YAML 语法及多项细节
- 实现状态机引擎并完成全量迁移（阶段 1-5）
- 完成 Logger 迁移和 ESLint 治理 Phase 3 — console 门禁 + no-unused-vars 清零
- …（另有 78 条实质提交，详见 `git log v0.4.1..v0.4.2`）

#### v0.4.1 (2026-06-15) （git 历史补录）

> 实质提交 **1** 条：fix 1

- Provider fetch 层添加连接自动重试，提升网络瞬断稳定性

#### v0.4.0 (2026-06-15) （git 历史补录）

> 实质提交 **11** 条：fix 7 · refactor 2 · feat 1 · perf 1

- MarkdownRenderer react-markdown 重构 + 版本升级 0.4.0
- 恢复手写 MarkdownRenderer，移除 V2 版本
- 修复 310 个预存 TS 错误并优化对话响应性能
- 添加自定义模型时增加供应商选择下拉框
- EmbeddingManager 对接 ModelRouter 读取用户配置，不再硬编码 openai
- EmbeddingManager 无 OpenAI Key 时自动降级为本地提供者
- …（另有 5 条实质提交，详见 `git log v0.3.1..v0.4.0`）

#### v0.3.1 (2026-06-14) （git 历史补录）

> 实质提交 **1** 条：bump 1

- 版本升级至 v0.3.1 + 修复细节

#### v0.3.0 (2026-06-14) （git 历史补录）

> 实质提交 **27** 条：fix 9 · feat 8 · refactor 8 · docs 1 · bump 1

- 模型全链路排查整改 + FileRegistry 增强 + 前端文件管理重构
- 知识库升级 — Domain-First 架构 + many-to-many 编译 + 轻量搜索
- FileRegistry 文件注册中心 — 全模块文件入站统一注册与 MD5 去重（WebFetch/媒体生成/FileWrite/会话制品/知识编译/附件/上传 全覆盖）
- 非流式交互支持 + 工具调用参数显示优化 + AskUserQuestionTool 修复
- 工作空间信任机制完整实现 — P1基础能力+P2前端UI+P3权限分级
- 全量提交 - AI工作流文件管理系统升级
- …（另有 21 条实质提交，详见 `git log v0.2.0..v0.3.0`）

#### v0.2.0 (2026-06-05)

**新增核心能力**
- ✅ **知识库语义索引** - 支持文档向量化、语义检索
- ✅ **MCP 断线重连** - 流式传输 + 自动重连机制
- ✅ **Cron 定时任务调度** - 完整的计划任务系统
- ✅ **Agent 任务中心** - PDCA 长程编排、Kanban 看板
- ✅ **消息通道扩展** - QQ/飞书/微信等 26+ 平台接入
- ✅ **查询上下文引擎** - 智能上下文管理与修复工具

**架构升级**
- 路径管理架构重构，部署更安全
- 梦境引擎与守护进程分离

#### v0.1.1 (2026-05-28) （git 历史补录）

> 实质提交 **21** 条：fix 8 · refactor 5 · feat 4 · chore 2 · ci 2

- 会话整合方案B实施 + 模块系统注册 + 新功能模块落地
- macOS 独立二进制打包支持
- Docker 多阶段编译打包 + Windows 独立 exe 编译 + 架构修复
- 通道系统全面重构与基础设施升级
- 锁定 @tauri-apps/api 版本至 2.10.x 并提交 bun.lock
- 修复 GitHub Actions 多平台构建的路径和依赖问题
- …（另有 15 条实质提交，详见 `git log v0.1..v0.1.1`）

#### v0.1.0 (2026-05-30) （git 历史补录）

> 实质提交 **13** 条：fix 5 · feat 4 · ci 2 · refactor 1 · style 1

- 模块集成与预存错误修复
- MCP 市场/Skill 市场/语音服务全功能集成 + source 字段统一为 builtin/third_party
- 用户数据目录可配置及数据迁移功能
- 为所有源代码文件添加 MIT 开源协议头
- 补齐 UI 组件 & 修复语音模块类型错误
- 修复 SettingsPage httpClient 导入错误
- …（另有 7 条实质提交，详见 `git log v0.1.1..v0.1.0`）

#### v0.1 (2026-05-25) （git 历史补录）

> 实质提交 **100** 条：feat 39 · fix 19 · refactor 18 · other 9 · docs 7 · chore 6 · style 1 · update 1

- Ink REPL 图标优化 + 通道消息防重复 + Logger 路径改进
- 通道模块化重构 — 新增 accounts/config-schema/doctor/monitor/probe/runtime 子模块体系 + streaming-message 流式消息支持
- 入站消息接收架构 + 通道配置体系 + QQ Bot Access Token 鉴权升级
- 知识库模块化升级—桶导出+混合搜索+AI写删工具
- 大规模架构重构 — SessionGateway 集成、ChatManager 会话管理层重构、Task 系统模块重组
- 实现 gaps.md 全部 12 项差距分析改进
- …（另有 94 条实质提交，详见 `git log v0.1`）
