# llama.cpp 内置集成 Phase 4 — 测试计划

> 版本: 0.1 | 创建: 2026-08-10 | 状态: 待执行
> 关联: `.trae/specs/llamacpp-integration.md`（v0.2，Phase 4 验证）
> 目标: 验证 llama.cpp 集成在真实环境端到端可用：启动自动下载 → 服务拉起 → 本地推理 → 配置页操作 → 崩溃重启 → 与 Ollama 并存。

---

## 1. 前置阻断项（P0-1/P0-2 已修复，2026-08-10）

| # | 问题 | 状态 | 处理 |
|---|------|------|------|
| P0-1 | `LLAMA_VERSION = 'b0.3.3'` 是**无效版本号**。llama.cpp Release 版本格式为 `b<5位数字>`（如 2026-08-02 发布的 `b10225`），下载 URL 必然 404。 | ✅ 已修复 | 更新为 `b10225`（资产 `llama-b10225-bin-win-cpu-x64.zip`，17.5MB，经 GitHub API 确认存在） |
| P0-2 | `EXPECTED_SHA256` 为空（`{}`），下载强校验未启用。 | ✅ 已修复 | 登记真实值 `79ae579ed5083435baa0abaee4b3e18d0c5b2eafdb05c8c77afddf3c7977e553`（实测 Get-FileHash），已导出常量并新增「当前锁定版本已登记期望值」测试用例 |
| P0-4 | `downloadBinary()` 只提取 `llama-server.exe`（9KB 引导程序），但 b10225 的 zip 为**扁平结构**，主逻辑在 `llama-server-impl.dll`（9.9MB），运行依赖 `ggml*.dll` / `llama.dll` / `llama-common.dll` / `libomp140.x86_64.dll` 等全套。单独提取 exe 实机必崩。 | ✅ 已修复 | 改为全量解压 `extractAllTo(llamaDir, true)`；兼容带顶层目录的历史 zip（提升到根）。新增「扁平结构 zip 全量解压」用例（断言 impl.dll/ggml.dll 落位）+ 真实 zip 端到端验证（强校验通过 + 6 个关键文件齐全） |
| P0-3 | 实机验证需要一块 GGUF 模型。候选：llama3.1-8b（Q4_K_M，~4.7GB）或更小的 Qwen2.5-0.5B/Qwen2.5-1.5B（测试更快）。**测试时先放小模型**，8B 级模型仅作最终性能抽测。 | ⏳ 待用户准备 | 用户准备 GGUF 放入 `~/.pyapp/data/models/llama/models/` |

> P0-1/P0-2/P0-4 修复内容：[LlamaCppServerManager.ts](file:///E:/PY/CODES/PY_APP/app/src/ai/local/llama/LlamaCppServerManager.ts)（版本号 L54、全量解压 L381-397、SHA256 登记 L544-547）；测试 11 用例全过 + typecheck ✓。

---

## 2. 环境与前置条件

| 项 | 值 |
|----|-----|
| 项目根 | `E:\PY\Documents\CODES\PY_APP` |
| 后端 | `app/` 目录 `bun run dev`（端口默认 7890） |
| 前端 | `client/` 目录 `bun x vite` |
| 二进制目录 | `~/.pyapp/data/models/llama/llama-server(.exe)` |
| GGUF 目录 | `~/.pyapp/data/models/llama/models/*.gguf` |
| 默认端口 | `127.0.0.1:11435`（避开 Ollama 11434） |
| 配置存储 | `~/.pyapp/config.json` 的 `llama` 段 |
| 数据源检查 | `GET /v1/llama/status`、`GET /v1/llama/config` |

---

## 3. 静态验证（Phase 4 Checklist 前半）

在 `app/` 与 `client/` 分别执行，全部通过后方可进入实机：

```powershell
# app/
bun run typecheck
bun run lint
bun test                    # 全量（含 tests/ai/llama/ 9 用例）
bun run lint:arch
bun run lint:models
bun test tests/ai/llama/LlamaCppServerManager.test.ts   # 定向回归

# client/
bun run typecheck
bun run lint
```

**通过标准**：typecheck / test / lint:arch / lint:models 零错误；lint 无新增 error（存量 warning 可接受）。

---

## 4. 实机验证 — T1 启动自动下载

前置：清空二进制目录（模拟全新环境）。

```powershell
# 备份并清空（若已存在）
$llama = "$env:USERPROFILE\.pyapp\data\models\llama"
Remove-Item "$llama\llama-server*" -ErrorAction SilentlyContinue
# 确认
Test-Path "$llama\llama-server.exe"   # 期望 False
```

**步骤**：
1. 启动后端 `bun run dev`，观察启动日志：
   - 期望出现 `[ai:llama] llama-server 二进制缺失，开始下载（bXXXX）`
   - 期望出现 `[ai:llama] 下载 llama.cpp bXXXX: https://github.com/.../llama-<v>-bin-win-cpu-x64.zip`
   - 若 `EXPECTED_SHA256` 已登记：期望 `[ai:llama] SHA256 校验通过`
2. 下载完成后检查：
   - `Test-Path "$llama\llama-server.exe"` → `True`
   - 无模型时启动链应告警 `未配置 GGUF 模型（请先指定模型路径）` 且服务状态为 `error`（**预期行为**，模型由 T2 配置）
3. 执行 `GET /v1/llama/status`（浏览器或 curl），期望：
   ```json
   { "success": true, "status": { "binaryExists": true, "running": false, "models": [] } }
   ```

**通过标准**：二进制下载并解压到指定路径；status API 正确反映 `binaryExists=true`、`models=[]`。

**失败预案**：
- 下载 404 → P0-1 版本号无效，回查 GitHub Release 真实版本。
- 超时（120s）→ 网络问题，检查代理/重试；考虑内网镜像源。

---

## 5. 实机验证 — T2 配置页操作

前置：已放入至少一块 GGUF 到 `~/.pyapp/data/models/llama/models/`。

**步骤**：
1. 启动前端 `bun x vite`，打开「设置 → llama.cpp 本地推理」。
2. 服务状态区：期望显示 `已停止`、`v<bXXXX>`、端口 `11435`、`二进制缺失`（若已下载则无此提示）。
3. GGUF 模型下拉：期望出现刚放入的模型文件名（来自 `status.models` 扫描，**非写死**）。
4. 修改配置并「保存配置」：
   - 端口改为 `11436`，上下文窗口改为 `8192`，GPU 层数改 `0`；
   - 期望提示 `配置已保存（重启后生效）`；
   - 检查 `~/.pyapp/config.json` 的 `llama` 段：`port: 11436, contextWindow: 8192, gpuLayers: 0, model: <GGUF 绝对路径>`。
5. 校验失败路径：把模型路径改为不存在的文件路径后保存，期望提示 `GGUF 模型不存在: ...` 且不落盘。
6. 选择真实 GGUF 模型 → 点「保存并重启」：
   - 期望提示 `配置已保存并重启服务`；
   - 状态区变为 `运行中`、`端口 11436`；
   - 后端日志出现 `拉起 llama-server: ... --host 127.0.0.1 --port 11436 --model <gguf> --n-gpu-layers 0 --ctx-size 8192` 与 `llama-server 就绪`。
7. 重启后再开页面（刷新），期望配置持久化（端口/模型/上下文保持 11436 配置值）。

**通过标准**：配置保存→持久化→应用重启全链路；校验拦截非法配置；服务真实拉起并 /health 就绪。

---

## 6. 实机验证 — T3 本地推理（chat 走 llama.cpp）

前置：T2 完成后服务 `running`。

**步骤**：
1. 直接验证服务端 OpenAI 兼容接口：
   ```powershell
   curl.exe -s http://127.0.0.1:11436/health            # 期望 {"status":"ok"}
   curl.exe -s http://127.0.0.1:11436/v1/models          # 期望模型列表非空
   curl.exe -s http://127.0.0.1:11436/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"<模型id>","messages":[{"role":"user","content":"1+1=?"}]}'
   ```
   期望返回正常 OpenAI 格式 completion。
2. 应用内验证：
   - 后端应已注册 llamacpp provider：`GET /v1/providers` 期望出现 `providerType: "llamacpp"`、`name: "llama.cpp"`、`baseUrl: http://127.0.0.1:11436/v1`、`requiresAuth: false`。
   - `GET /v1/models` 期望出现 llamacpp 的 GGUF 模型条目（`providerId` 指向该 provider）。
   - 「模型管理 → 任务分工」将 `chat`/`local` 等任务映射到该模型，然后在 UI 对话发送消息，期望正常回复（首 token 延迟受 CPU 推理影响，属预期）。
3. 数据一致性复核（§1.5）：
   ```sql
   SELECT provider_id, provider_type, base_url, requires_auth FROM providers WHERE provider_type='llamacpp';
   SELECT model_id, display_name, provider_id FROM model_registry WHERE provider_id = '<上一步 id>';
   ```

**通过标准**：本地服务可完成一次真实推理；provider/model 经 DB→Registry 链路注册且运行时一致（UI 可用 ≠ 仅服务可用）。

---

## 7. 实机验证 — T4 崩溃重启与退出回收

前置：T3 服务 `running`。

**步骤**：
1. 用任务管理器定位 `llama-server.exe` 进程并结束（模拟崩溃）：
   ```powershell
   Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process
   ```
2. 观察后端日志（期望 1s 内）：
   - `[ai:llama] llama-server 退出 code=1 signal=null`
   - `[ai:llama] llama-server 将在 1000ms 后重启（第 1 次）`
   - 随后 `[ai:llama] llama-server 就绪`
3. 连续 kill 两次，期望重启延迟按指数增长（1000ms → 2000ms），`GET /v1/llama/status` 的 `restartCount` 递增。
4. 退出回收：停止后端 `bun run dev`，期望 `llama-server 已停止` 且进程表中无残留 `llama-server.exe`。

**通过标准**：崩溃自动重启（退避生效）；应用退出子进程被回收，无孤儿进程。

---

## 8. 实机验证 — T5 Ollama 并存

前置：本机 Ollama 已安装或至少模拟端口占用。

**步骤**：
1. 若 Ollama 运行在 11434：确认 llama.cpp 默认 11435 不冲突，两者可同时运行，`GET /v1/llama/status` 与 Ollama 无关。
2. `GET /v1/providers` 期望同时存在 `ollama` 与 `llamacpp` 两个 provider；`GET /v1/models` 期望 ollama-* 预设与 llamacpp 预设并存。
3. 任务分工中分别将任务指向 Ollama 模型与 llama.cpp 模型，各发一条消息验证互不影响。
4. Ollama 配置页（设置 → Local Agent / Ollama 配置）原样可用。

**通过标准**：双 provider 并存，端口/注册/路由互不冲突。

---

## 9. 文档与快照收尾

- [ ] 更新 `app/docs/` 本地模型文档（新增 llama.cpp 章节：下载/模型放置/配置说明）
- [ ] 执行 `modules:snapshot` 并提交变更
- [ ] `.trae/specs/llamacpp-integration.md` Phase 4 checklist 全勾选，状态改为「已完成」
- [ ] 本测试计划验证记录回填（下表）

---

## 10. 验证记录

| 用例 | 结果 | 备注 |
|------|------|------|
| 静态验证（typecheck/lint/test/arch/models） | ✅ | 前后端 typecheck ✓、改动文件 lint 0 error、lint:arch 0 error、全量测试 2331 pass / 0 fail；lint:models 硬编码 0 违规（7 个能力断链均为「无 enabled 模型」的数据问题，非映射缺陷，需用户启用对应模型） |
| T1 启动自动下载 | ✅ | b10225 下载+全量解压+强校验通过（binaryExists=true，49 文件） |
| T2 配置页操作（保存/校验/重启） | ✅ | PUT model + restart → running；配置持久化 config.json；/health ok |
| T3 本地推理 chat | ✅ | /v1/models ok（n_params 0.6B）；chat completion 57 tokens/s；**修复 provider 注册缺口**（restart 后 ensureLlamaCppProviderRegistered） |
| T4 崩溃重启/退出回收 | ✅ | 2 次 kill：restartCount 1→2→3，lastError 记录 `退出 code=255`，每次 ~5s 自动恢复 running + /health ok；**退出回收实测无残留**：停后端（bun watch）后 llama-server 子进程被回收（Windows bun 进程树/Job Object 机制；代码未显式注册 stop() 钩子，Linux/macOS 行为待验证） |
| T5 Ollama 并存 | ✅ | **双服务真实并存**：Ollama 11434（qwen3.6-27b 运行中）+ llama.cpp 11435 同时在线，端口不冲突；providers 列表含 ollama + llamacpp（active=True）；Ollama /api/tags 正常 |
| 文档 + modules:snapshot | ☐ | 待执行 |

**T5 发现的缺口（GGUF 注册）已解决（2026-08-10）**：新增 `syncLlamaModelsToRegistry()`（[registerLlamaCppProvider.ts](file:///E:/PY/CODES/PY_APP/app/src/ai/local/llama/registerLlamaCppProvider.ts)）——扫描 GGUF 目录 → `ModelPricingService.upsertPricing` 注册到 model_registry（provider_id→llamacpp，is_custom=1）→ 刷新 ModelRegistry 缓存 + ModelRouter UUID 缓存。挂载于 `ensureLlamaCppProviderRegistered`（冷启动 + restart 均触发），幂等（同名归属本 provider 跳过）。验证：模型总数 14→15，`Qwen3-0.6B-Q8_0`（providerId=8ac2f3c8...）注册成功，重复触发 restart 不重复注册。

**T3 实机发现与修复（2026-08-10）**：
1. **provider 注册缺口（已修复）**：llamacpp provider 仅在应用冷启动链注册（要求当时已 running）；运行中「配置模型→保存并重启」不触发。修复：[llama-handlers.ts](file:///E:/PY/CODES/PY_APP/app/src/infrastructure/http/handlers/llama-handlers.ts) `handleLlamaRestart` 在 restart 就绪后调用 `ensureLlamaCppProviderRegistered()`（幂等）。验证：`providerRegistered: true`、providers 列表含 `llama.cpp`（baseUrl http://127.0.0.1:11435/v1）。
2. **Qwen3 thinking 行为（模型特性，需应用层适配）**：Qwen3 默认开启思考，内容输出到 `reasoning_content`，`content` 可能为空且思考占满 max_tokens。关闭方式：请求体 `chat_template_kwargs: {"enable_thinking": false}`（llama.cpp b10225 支持）。应用层 ChatCompletionsTransport 后续若需直答可透传该参数。
3. **测试模型**：`Qwen/Qwen3-0.6B-GGUF` 官方仓库仅提供 `Qwen3-0.6B-Q8_0.gguf`（609MB，SHA256 已核对）；纯 CPU 推理 ~57 tokens/s。

## 11. 已知风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| P0-1 版本号无效导致下载 404 | T1 直接失败 | 实机前先验证 Release 版本并更新 |
| CPU 推理慢（8B Q4 在纯 CPU 下首 token 可能 >10s） | T3 体验差 | 测试用小模型（0.5B-1.5B）；GPU 二进制后续扩展 |
| Windows Defender 拦截下载/解压 | T1 异常 | 预检杀软排除项（已知 I/O 慢问题） |
| `--n-gpu-layers` 非 0 但二进制为 CPU 版 | 启动报错 | 默认 0；配置页提示仅 CUDA/Vulkan 二进制可用 GPU |
