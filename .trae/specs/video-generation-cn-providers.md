# 视频生成国内厂商支持统一化 Spec

> 版本: 0.1 | 创建: 2026-08-10 | 状态: **已完成（2026-08-10）**
> 关联: GR15 / GR16-002 / model-usage.md（DB 唯一事实源）/ 上承「能力键统一」spec（text_to_video/image_to_video/video_generation 能力键已统一）
> 决策背景: 国内视频生成 API 五家（可灵 Kling / 豆包 Seedance / MiniMax Video-01 / 通义万相 / Vidu）均为**异步任务模式**（提交 task → 轮询状态 → 取视频 URL），各家 API 格式不同。当前系统仅 FAL 聚合（覆盖可灵/MiniMax/万相/混元），**豆包 Seedance 与 Vidu 无任何支持**。

## 1. 现状（2026-08-10 调研）

- 视频链路完整：`VideoGenerateTool`（双路径 Router/兼容）→ `VideoGenerationRouter`（fallback 链）→ `RegistryVideoProvider.generate()` → `AIProvider.generateVideo()`；`video_tasks` 表持久化 + `/v1/video/tasks` API + 前端 MediaPage/useVideoTaskPolling。
- 唯一生成执行体：`FALProvider.generateVideo`（提交 `fal.run/{modelId}` → `request_id` → 指数退避轮询 → 下载，5 分钟超时）。
- `AIProvider.generateVideo?` 为可选方法，`VideoGenerationParams`/`VideoGenerationResult` 已定义。
- ProviderType 18 个（含媒体 `fal/stability/replicate/comfy`）；ProviderCategory 已含 `cn_official`（国内官方）。
- **缺失**：豆包 Seedance（volcengine）、Vidu 全库无命中；可灵/MiniMax/万相仅 FAL 聚合，无官方直连。

## 2. 决策（用户已确认 2026-08-10）

- **D1 统一抽象**：抽取 `AsyncVideoTaskProvider` 抽象基类（提交→taskId→轮询→URL 三步，指数退避/超时/错误分类复用 FAL 模式）；FALProvider 重构复用；新厂商 Provider 只实现 `submitVideoTask`/`queryVideoTask`/`extractVideoUrl` 三方法。
- **D2 适配范围**：全部 5 家（可灵 Kling / 豆包 Seedance / Vidu / MiniMax / 通义万相），官方 API 直连；**聚合平台（硅基流动等）暂不修改**。
- **D3 验证方式**：代码 + 单测先行（mock fetch 验证请求组装/轮询解析），各平台 API key 后续实机联调。
- **D4 模型注册**：各厂商模型走 `model_registry`（provider_id 指向对应 Provider），能力键用已统一的 `video_generation`/`text_to_video`/`image_to_video`。

## 3. 架构设计

### 3.1 AsyncVideoTaskProvider 基类

```
app/src/ai/providers/AsyncVideoTaskProvider.ts

abstract class AsyncVideoTaskProvider extends BaseAIProvider {
  // 子类实现（差异点收敛为三方法）
  protected abstract submitVideoTask(params, apiKey): Promise<{ taskId: string }>
  protected abstract queryVideoTask(taskId, apiKey): Promise<VideoTaskPollState>   // { state: 'pending'|'running'|'completed'|'failed'|'unknown', videoUrl?, error? }
  protected abstract extractVideoUrl(data): string

  // 基类提供（统一逻辑）
  async generateVideo(params): Promise<VideoGenerationResult>   // 校验 key → submit → 轮询 → URL → 下载 buffer
  protected buildPolling(interval=2000, max=5min, backoff=1.5)  // 指数退避轮询
}
```

### 3.2 Provider 扩展

- `ProviderType` 新增：`kling`、`volcengine`（豆包 Seedance）、`vidu`、`minimax`（视频）、`dashscope`（通义万相）。
- `ProviderFactory` 新增对应分支（延迟 require）。
- `providerPresetsData.ts`（后端）/ `providerPresets.ts`（前端）新增名称映射。
- `lint:models` 白名单登记新 provider 类型。

### 3.3 各厂商 API 要点（以官方文档为准，实施时逐一 WebSearch 核实）

| Provider | 厂商 | 提交 | 轮询 | 视频 URL 位置 |
|---------|------|------|------|--------------|
| KlingProvider | 快手 | `POST api.klingai.com/v1/videos/text2video`（/image2video）| `GET .../videos/{task_id}` | `data.task_result.videos[0].url` |
| VolcengineProvider | 火山引擎 | 视觉任务 `POST .../contents/generates/tasks` | `GET .../contents/generates/tasks/{id}` | `data.output` 或 `.files` |
| ViduProvider | 生数科技 | `POST api.vidu.com/...` | 轮询 task | `data.videoUrl` |
| MiniMaxVideoProvider | MiniMax | `POST api.minimaxi.com/v1/video_generation` | `GET .../query/{task_id}` | `data.file_id`/`data.video_url` |
| DashScopeVideoProvider | 阿里云 | `POST dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis` | `GET .../tasks/{task_id}` | `output.video_url` |

> 注：以上 API 细节为方向性要点，**实施前必须经 WebSearch 官方文档核实**，禁止编造（CS06）。各厂商鉴权方式不同（Bearer / API-Key Header / 火山签名）。

## 4. 数据模型

- 无新表。厂商模型经 `model_registry` 注册（provider_id → 对应 Provider），capabilities 含 `text_to_video`/`image_to_video`/`video_generation`。
- `video_tasks` 表不变（工具层统一持久化）。

## 5. 实施步骤

### Phase 1 — 基类 + 骨架 ✅
- [x] 新增 `AsyncVideoTaskProvider.ts`（基类：generateVideo 统一流程 + 指数退避轮询/超时/错误分类；chat/chatStream 抛 VIDEO_ONLY_PROVIDER）
- [x] `ProviderType` 新增 5 类型（kling/volcengine/vidu/minimax/dashscope）；`ProviderFactory` 5 分支；后端 presets + 前端 PROVIDER_TYPE_LABELS 映射
- [x] FALProvider 保留原实现（含图片上传/参数规范化特殊逻辑，按 CS03 不无收益重构）

### Phase 2 — 可灵 Kling Provider ✅
- [x] `KlingProvider.ts` + 单测（10 pass）：`api.klingai.com`，AK/SK 生成 JWT HS256（`"accessKey:secretKey"` 格式）或直用 Bearer；`/v1/videos/text2video|image2video` 提交、`GET /v1/videos/{type}/{id}` 查询；参数映射 model→model_name、负向/时长/宽高比/种子

### Phase 3 — 豆包 Seedance（火山引擎）Provider ✅
- [x] `VolcengineProvider.ts` + 单测（8 pass）：`ark.cn-beijing.volces.com/api/v3`，`POST /api/v3/contents/generations/tasks`（复数 generations，content[] 数组）、`GET .../tasks/{id}` 查询；status succeeded→completed + content.video_url；imagePath 转 base64 Data URL

### Phase 4 — Vidu Provider ✅
- [x] `ViduProvider.ts` + 单测（10 pass）：`api.vidu.cn/ent/v2/text2video|img2video`、`GET .../tasks/{id}/creations` 查询；鉴权 `Authorization: Token <key>`；success→completed；extractVideoUrl 多重路径防御

### Phase 5 — MiniMax + 通义万相 Provider ✅
- [x] `MiniMaxVideoProvider.ts` + 单测（14 pass）：`api.minimaxi.com/v1`，`POST /video_generation`、`GET /query/video_generation`；Success→completed；查询返回 file_id 时经 `/files/retrieve` 换 download_url；GroupId 头仅配置 `MINIMAX_GROUP_ID` 时附带
- [x] `DashScopeVideoProvider.ts` + 单测（10 pass）：`dashscope.aliyuncs.com`，`POST /api/v1/services/aigc/video-generation/video-synthesis`（`X-DashScope-Async: enable`）、`GET /api/v1/tasks/{id}`；SUCCEEDED→completed + output.video_url；size 按分辨率×宽高比映射宽*高

### Phase 6 — 验证 ✅
- [x] typecheck（前后端）/ lint 0 error / lint:arch 0 error / 全量测试 **2383 pass / 0 fail**（+52 新用例）
- [x] lint:models 硬编码违规 0；能力断链 7 项均为「无 enabled 模型」数据问题（需用户启用对应能力模型）
- [x] 各厂商 API 细节均来自官方文档（WebSearch 核实，CS06），不确定字段已如实标注

> 注：各 Provider 待配置平台 API Key 后实机联调（D3）。

## 5.1 补充 — ComfyUI 本地视频生成（2026-08-10）

云端 API 之外，补齐**本地路径**（ComfyUIProvider 原仅图像）：
- `generateVideo` 新增：复用图像管线（检查服务 → 加载视频工作流 → 参数化 → 提交 `/prompt` → 轮询 `/history`）
- `waitForCompletion` 泛化 `kind: 'images' | 'videos'`（videos 提取 `videos`/`gifs` 字段，VHS_VideoCombine 输出；images 帧兜底）
- 新增 `parameterizeVideoWorkflow`（prompt/seed/尺寸/帧数=duration×fps）、`uploadImage`（本地首帧上传 `/upload/image`）、`resolveVideoSize`（分辨率×宽高比 → 宽*高）
- 新增预设工作流 `comfy-workflows/text2video.json` / `image2video.json`（Wan 节点结构：Checkpoint→CLIP→EmptyLatentVideo→KSampler→VAEDecode→VHS_VideoCombine）；`loadWorkflow` 兼容 `{type}.json` 与 `{type}_flux.json` 两种命名
- 单测 `ComfyUIProvider.video.test.ts`（5 用例：全流程/服务不可用/图片帧兜底/参数化/图生视频上传）
- 验证：typecheck ✓、lint 0 error、全量测试 2388 pass

> 注：预设工作流 ckpt_name 为 Wan 占位名，用户需按本机 ComfyUI 实际模型名调整。

## 5.2 补充 — 视频生成核心分支日志增强（2026-08-10）

用户要求「核心分支加详细 logger.info 打印，方便排查报错」，覆盖全部视频生成执行路径：
- **基类 `AsyncVideoTaskProvider`**：新增 `protected readonly logger`（module `ai:provider:<id>` 按实例区分，5 家厂商自动继承）。`generateVideo` 全流程埋点：API Key 未配置(error) → 开始提交(info，含 model/isImageToVideo/prompt 前 80) → 提交成功(info，含 taskId/elapsedMs) → **状态变化去重日志**（`state !== lastState` 避免每轮刷屏）→ failed/unknown 耗尽/超时/成功/异常 6 类分支全覆盖；catch 走 `logger.error + handleError`（§1.9）
- **`ComfyUIProvider.generateVideo`**：同风格补齐——开始生成(info，含 isImageToVideo/分辨率/时长)、服务不可用(error)、工作流加载成功/失败(info/error)、提交成功/失败(info/error)、视频输出缺失时回退图片帧(info)、全部无输出(error)、生成成功(含 outputCount/outputType)、异常 catch（`logger.error + handleError`）
- 验证：typecheck ✓、ComfyUI 视频测试 5 pass、5 家 Provider 测试 52 pass、全量测试 2388 pass（日志实测：状态变化/失败/超时各分支均含 taskId/elapsedMs 上下文）

## 6. 合规检查表

- [x] CS01 归一化：基类复用 FAL 轮询模式；模型注册走 model_registry（DB 唯一事实源，lint:models 硬编码违规 0）
- [x] CS06 证据驱动：各厂商 API 格式均来自官方文档（WebSearch 核实），不确定字段如实标注，无编造
- [x] CS04 Mock 零容忍：单测 mock fetch 仅测试隔离，无生产假数据
- [x] model-usage.md：模型名/供应商名不硬编码，走 DB 注册；白名单同步（lint:models 白名单覆盖 5 家新 Provider 类型）
- [x] §1.8/§1.9：Logger（module `ai:provider:<name>`）/ handleError（§5.2 日志增强已落地，catch 统一走 handleError）
- [x] R04-001：文件 < 800 行（实测：AsyncVideoTaskProvider 316 / ComfyUIProvider 636 / 5 家 Provider 206-297 行）

> 剩余待办：各平台 API Key 实机联调（D3）；7 项能力断链为「无 enabled 模型」数据问题（需用户配置并启用对应能力的视频/语音/视觉模型）
