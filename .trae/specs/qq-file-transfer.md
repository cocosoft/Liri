# QQ 通道文件传输（双向）

> 状态：待评审 | 创建：2026-08-20 | 版本：**v6（2026-10-17：写入回执给绝对路径 + 提取器认 `~/`）**
> 范围：QQ c2c 私聊（群消息当前 BYPASS，本 spec 不启用群，仅预留字段兼容）
>
> ⚠️ **v2 订正的由来（真机事故）**：2026-10-17 真机出现 `QQ 媒体上传失败
> {fileType:4,status:400,apiMessage:"请求参数错误"}` ⇒ 文件**永远发不出去**。取证 QQ 官方
> 「富媒体消息」（最后更新 2026-06-26）后确认：**v1 的 §3.2-①/② 两处口径与文档不符**
> （v1 写 multipart + `srv_send_msg`；实为 JSON + `url`/`file_data`），且发送用 `media.file_uuid`
> 而文档要求 **`media.file_info`** ⇒ v2 订正，并加「捕获真实请求体」的单测钉住。

## 1. 背景与目标

QQ 通道当前仅支持纯文本交互：
- **入站**：`handleC2cMessageCreate` 将所有消息视为 `text`，QQ 媒体事件携带的 `attachments[]`（CDN 下载 URL）被丢弃——用户发文件/图片 bot 无感知。
- **出站**：`QQChannel.sendFileMessage`/`sendImageMessage` 已存在但三处断链：① 本地文件用 data URI 塞 JSON `url` 字段（QQ files API 仅接受公网 URL，无效）；② `sendQQMediaMessage` 用 `msg_id: Date.now()` 假 ID（被服务端拒绝或误耗主动配额）；③ `messageRouter` 出站仅 `sendText`，文件无路由。

**目标**：
1. 入站：QQ 发文件/图片 → 下载 → FileRegistry 注册 → AI 可感知处理
2. 出站：AI 最终回复中的本地文件路径 → multipart 上传 QQ 媒体库 → 发送文件消息

## 2. 现有基础设施（复用，不新造）

| 设施 | 位置 | 说明 |
|------|------|------|
| `handleInboundFile()` | BaseChannelPlugin L466 | 入站文件注册 FileRegistry（MD5 去重/存储统一） |
| `MessageAttachment` | IChannel.ts L86 | 入站附件类型（已存在） |
| 飞书参照实现 | FeishuChannel L738-824 | 下载→注册→文本回退提示 AI 的完整模式 |
| `consumePassiveReplyFields()` | QQChannel | 被动回复 msg_id/msg_seq 配额管理（文件消息同样占用 5 条配额，需接入） |
| `sendFileMessage()` 框架 | QQChannel L836 | 上传+发送骨架（保留，重写上传实现） |

## 3. 设计

### 3.1 入站（QQ → Liri）

**payload 类型补充**（QQChannel L2035）：

```typescript
interface QQAttachment {
  content_type: number;   // 0=文本 1=图片 2=视频 3=语音 4=文件（富媒体 subtype）
  filename?: string;
  height?: number;
  width?: number;
  size?: number;
  url?: string;           // QQ CDN 临时 URL（有时效，需立即下载）
}
interface QQC2cMessageCreatePayload {
  // ...现有字段
  attachments?: QQAttachment[];
}
```

**处理流程**（`handleC2cMessageCreate`）：
1. `attachments?.length` 且含 url → 按飞书模式**立即异步下载**（CDN 时效）：
   `fetch(url)` → `handleInboundFile({ originalName: filename, content: buffer, sourceId: messageId, mimeType })`
2. content 置为提示文本（AI 可感知并可 file_read 该路径）：
   - 图片：`[用户发送了图片: ${filename}]`
   - 文件：`[用户发送了文件: ${filename} (${size}字节)，已保存，可用 file_read 读取]`
3. `messageType` 按附件类型映射 `'image' | 'file'`；无附件维持 `'text'` 原路径（零回归）

**下载失败**：content 回退 `[用户发送了附件 ${filename}，但下载失败]`，AI 可告知用户重发。不静默（CS03）。

### 3.2 出站（Liri → QQ）

**① 重写 `uploadQQFile`：按官方文档口径（**JSON**，不是 multipart）**：

```
POST https://api.sgroup.qq.com/v2/users/{openid}/files      # 群：/v2/groups/{group_openid}/files
Content-Type: application/json
  file_type: 1(图片)/2(视频)/3(语音)/4(文件)      # 必填
  url:      <公网 http(s) 地址>                    # 远程资源走这条
  file_data: <本地文件内容的 base64>                # 本地文件走这条
  file_name: <文件名>                              # ★ 二进制上传**必填**（v4）
→ { file_uuid, file_info, ttl }                    # 发消息用的是 file_info
```
- **本地文件** ⇒ 读为 **base64** 放进 `file_data`（v1 的 multipart + 字段 `file` **不是**文档参数 ⇒ 真机 400），**并带 `file_name` = 路径末段**（v4；官方 autogen 文档写明二进制上传必填 —— 不传则 QQ 客户端把附件显示成**「未命名」**，2026-10-17 真机截图已见）。
- **公网 URL** ⇒ 走 `url`。
- **不得**再带 v1 里那个文档没有的 `srv_send_msg`。
- `file_type` 依据扩展名推断（png/jpg→1，mp4→2，mp3/wav→3，其余→4）。
- 上传返回**必须**含 `file_info`（发消息要用）；缺失 ⇒ **不臆造**，如实报错并**不**发消息。

**② 修复 `sendQQMediaMessage`：假 msg_id + `media` 字段口径**：
- 删除 `msg_id: Date.now()`，改为 `...this.consumePassiveReplyFields(target)`（与 sendTextMessage 一致：窗口内被动回复不耗主动配额，超窗降级不带 msg_id）；被动失败降级主动重试一次
- **`media` 用 `file_info`**（v1 用的 `file_uuid` 与文档不符 ⇒ 上传修好后发送仍会失败）：`{ msg_type: 7, media: { file_info } }`
  依据：官方「富媒体消息」返回参数说明（「file_info：文件信息，**用于发消息接口的 media 字段**」）与「发送单聊消息」示例

**③ messageRouter 出站文件路由**（流结束后追加发送）：
- 最终回复 `content` 提取本地文件路径：正则匹配 Windows 绝对路径（反引号包裹或裸路径）
- **可外发资格（v3 修订，2026-10-17 —— 修「频繁误触发」）**：满足其一才投递 ——
  ① **在交付面内** = `~/.pyapp/{output,downloads,attachments}`（`resolveOutputDir`/`resolveDownloadsDir`/`resolveAttachmentsDir`），
     判定用 **realpath**（面内符号链接指向面外 ⇒ **不**放行，防绕过）；
  ② **本轮新产出** = `mtime ≥ 本轮起点（`llmStartMs`）− 2s`（覆盖「工具刚写出来的文件」）。
  两者都不满足 ⇒ **静默忽略**（按「叙述性路径」处理）：正文里**回显**一个既有路径**不**构成投递意图，
  且**不得**产生用户可见的「未能发送」噪音（v1 只按「存在 + 非禁区」判定 ⇒ 真机连续两条消息各误触发一次）。
- 大小 ≤30MB、单条 ≤2 个；**这两类仍如实告知**（`skipped` ⇒ 追加「⚠️ 以下文件未能发送」文本）——
  它们属「用户本该拿到却没发出去」，必须不静默（守 CS03）
- 文本回复先发（现有 sendText 路径不变），随后逐个 `onOutbound` 发文件
- 配额感知：文件消息占用被动 seq（consumePassiveReplyFields 天然管理），文本+文件总条数 ≤5 内安全（文本1 + 文件≤2 截断）

**④ AttachmentDownloadDebouncer 不引入**：下载立即触发，无需新组件。

**⑤ 模型侧投递契约（v5，2026-10-17）**：
- 通道入站调用 `chatStream` 时注入 `runtimeSystemNote = CHANNEL_DELIVERY_CONTRACT`（`channels/routing/messageRouterContract.ts`），按请求追加在系统提示末尾、**不进会话历史**。
- 契约内容：① 本轮回复由通道侧**自动投递**，发文件只需在正文写出路径（交付面内或本轮新建）；② 模型**没有**发送/广播类工具，**不得**断言「已发送 / 发送失败 / 没收到」；③ 不确定时如实说明无法观测、以客户端为准，**不猜测原因**。
- 缘由：真机两次臆断投递结果（「附件还没实际发出」；编造 `broadcast send channel=qq` 返回 `{sent:false}` —— 该动作在 `ChannelTool` 中不存在），而两次文件都在 1 秒后成功送达。属**跨通道**契约（不只 QQ）。

**⑥ 写入回执与主目录简写（v6，2026-10-17）**：
- `FileWriteTool` 回执改为**实际写入的绝对路径**（此前原样回显相对入参 ⇒ 模型以为落在 `~/.pyapp/output`，在正文里写该路径；文件实际在会话工作目录 ⇒ 出站路由候选为 0、用户什么也收不到）。工具描述同步订正：相对路径解析到**会话 cwd**，无 cwd 才回退 `outputDir`。
- 出站路径提取新增 `~/…` / `~\…`（展开为主目录绝对路径）；裸路径匹配前**剔除反引号片段**，避免 `~/a b.md` 被截成 `~/a`。

### 3.3 不做（明确排除）

- 群消息文件（群事件当前 BYPASS，仅类型层兼容）
- 频道（guild）文件发送（官方不支持，QQChannel L844 已有守卫）
- DeliverableBlockData 出站集成（死类型无生产者，不依赖）
- 视频/语音生成类工具的主动推送

## 4. 外部约束（代码无法解决，需用户侧确认）

| 约束 | 影响 | 缓解 |
|------|------|------|
| QQ 开放平台**富媒体权限**：正式环境需申请，沙箱一般可用 | 上传 API 可能 403 | 失败时回复明确原因（API 返回 message），提示用户在 QQ 开放平台申请 |
| 文件 ≤30MB / 图片 ≤10MB / 视频 ≤100MB | 超限文件无法发送 | 超限跳过并在文本中说明 |
| `file_data` 是 **base64**（体积 ≈ 原文 ×4/3） | 30MB 文件的请求体 ≈ 40MB（平台对请求体大小的上限**未获权威文档**） | 现状按「路径提取层 ≤30MB」守卫；若真机出现体积相关的 4xx/超时，改走官方**推荐的分片上传**（`reopenWhen` 已记） |
| **二进制直传上限 5MB**（官方文档明确） | 5MB~30MB 的本地文件走 `file_data` 会失败 | v4 只补 `file_name`；>5MB 需改**分片上传**（`upload_prepare` → PUT → `part_finish` → 合并），失败时如实上报、不静默 |
| QQ CDN 入站 URL 时效（分钟级） | 延迟下载失败 | 立即异步下载（飞书同模式） |

## 5. 合规检查清单

- [x] CS01 归一化：复用 handleInboundFile/FileRegistry/consumePassiveReplyFields/飞书模式，无重复造轮子
- [x] CS02：无字符串状态判断（messageType 用枚举；文件路径提取是内容提取非状态判断）
- [x] CS03：下载失败/发送失败均有日志+用户可见反馈，无静默回退
- [x] CS04：零 Mock
- [x] R02：类型统一（复用 MessageAttachment；QQAttachment 仅协议层私有类型）
- [x] R03：改动收敛在 channels/qq + channels/routing，无跨层新依赖（fs/path 动态 import 与现有 uploadQQFile 一致）
- [x] R04：QQChannel.ts 现 ~2050 行（已超限预存，FSZ 例外沿用；本次净增 ~150 行登记例外更新）；messageRouter 现 1028 行（FSZ-138 已登记，净增 ~60 行内）
- [x] api-spec.md：无新 HTTP 端点（纯通道内部能力）

## 6. 验收标准

1. QQ 发图片 → AI 回复确认看到图片（FileRegistry 有记录，jsonl content 含提示文本）
2. QQ 发文档 → AI 能 file_read 并总结内容
3. client 中让 AI"把某个本地文档发给我" → QQ 收到文件消息（**v2 口径**：`application/json` 上传 + `media.file_info` 发送）
4. 无富媒体权限环境 → QQ 收到含原因的失败提示（而非静默）
5. 纯文本消息行为零回归（messageType=text 原路径）
6. typecheck + lint:arch（例外更新后）通过
7. **请求体口径单测**（`app/tests/channels/qqFileTransferPayload.test.ts`，5 例，**捕获真实请求体**）：上传 `Content-Type: application/json` + `file_data`(base64)/`url`，且**无** `file` / **无** `srv_send_msg`；发送 `media.file_info` 且**无** `file_uuid`；上传 400 与「上传成功但缺 `file_info`」⇒ 如实报错且**不**发消息
8. **可外发资格单测**（`app/tests/channels/outboundFileEligibility.test.ts`，10 例）：交付面内旧文件 ⇒ 可发；面外**本轮新产出** ⇒ 可发；**面外 + 非本轮产出 ⇒ 既不投递也不产生噪音**（事故场景）；超 30MB / 超 2 个 ⇒ 仍如实告知；面内符号链接指向面外 ⇒ 不放行

> **v2 复测状态（如实）**：第 3 条（真机文件外发）**已真机复测通过**（2026-10-17 08:33）——
> 同一条消息（让机器人 `file_read` 并把路径回显到回复里）再走一遍该链路，日志出现
> **`outbound_files 单文件发送成功`**（此前为 `单文件发送失败{reason:"请求参数错误"}`）且**无** `QQ 媒体上传失败`、**无**「未能发送」反馈文本。
> 判据验真：`setupChannels.onOutboundFile` 仅在 `sendFile` 返回 `success:false` 时 `throw`，`outboundFileRouter` 只有不抛才记「成功」；
> `success` 来自 `sendQQMediaMessage` 的 `resp.ok` ⇒ 该条「成功」**同时**覆盖「上传 200」与「发送 200」两段。
> 样本为 **12KB 小文件**（`app/package.json`）⇒ 大文件（base64 体积）与群路径仍未验证（见 §4 与台账 `reopenWhen` ②③）。
>
> ⚠️ **v3 后该复测场景不再触发**（这是**预期**）：v3 把资格收窄为「交付面内 或 本轮新产出」，而上述样本
> （`E:\…\app\package.json`，既不在交付面、也非本轮产出）现按**叙述性路径静默忽略** ⇒ 不会再发文件、也不会有噪音。
> 要复测**外发能力**本身，请用**合规样本**：在 QQ 里让机器人「在本轮生成一个文件（或把文件放进 `output/`）后发给我」——
> 判据仍为 `outbound_files 单文件发送成功`。

## 7. 实施步骤

1. QQChannel：QQAttachment 类型 + 入站 attachments 处理（下载/注册/提示文本）
2. QQChannel：uploadQQFile **JSON 口径**重写（`file_data`/`url`）+ sendQQMediaMessage 被动字段与 `media.file_info` 修复
3. messageRouter：出站文件路径提取 + 追加发送 + 失败反馈
4. layer-exceptions.json：QQChannel 行数例外更新
5. typecheck + lint:arch + QQ 实测（用户配合发文件）

## 8. 变更记录

| 版本 | 日期 | 变更 | 依据 |
|---|---|---|---|
| **v6** | 2026-10-17 | ① `FileWriteTool` 回执给**实际绝对路径**（描述同步：相对路径 → 会话 cwd）；② 出站提取器认 `~/…` / `~\…`，裸匹配先剔除反引号片段 | 真机：模型把文件写到工作区根却在正文写 `~/.pyapp/output/…` ⇒ 出站候选为 0、用户收不到；`file_write` 回执只有相对路径是根因 |
| **v5** | 2026-10-17 | 新增 §3.2-⑤ **模型侧投递契约**：`runtimeSystemNote` 注入（按请求、不进历史），禁止模型臆断发送状态；`composeSystemPrompt` 收敛流式/非流式两处拼装 | 真机两次臆断（「附件还没实际发出」/ 编造 `broadcast send{sent:false}`），文件均随后成功送达 |
| **v4** | 2026-10-17 | ① 二进制上传补 **`file_name`**（官方 autogen 文档：二进制/分片上传必填）⇒ 修 QQ 附件显示**「未命名」**；② 记录「二进制直传 ≤5MB」限制（>5MB 需分片上传） | 真机截图：报告 9,444 字节已收到，但气泡标题为「未命名」（日志 `02:35:11 outbound_files 单文件发送成功`） |
| **v3** | 2026-10-17 | **可外发资格收窄**（§3.2-③）：由「存在 + 非禁区」改为「**交付面内**（`~/.pyapp/{output,downloads,attachments}`，realpath 判定）**或本轮新产出**（`mtime ≥ 本轮起点 − 2s`）」；**面外 + 非本轮产出 ⇒ 静默忽略**（不再产生「未能发送」噪音）；新增资格单测 10 例 | 真机实证「连续两条消息各误触发一次」（回复回显既有路径即被当投递意图）；spec §3.2-③ 原文已写明「限定 output/downloads/attachments」——**是实现做宽了** |
| **v2** | 2026-10-17 | ① 上传改 **JSON 口径**（本地 → `file_data` base64；远程 → `url`；**删** multipart 的 `file` 与文档没有的 `srv_send_msg`）；② 发送改 **`media.file_info`**；③ 上传缺 `file_info` ⇒ 报错且不发；④ 新增请求体口径单测 5 例 | 真机事故 `{status:400,apiMessage:"请求参数错误"}` + QQ 官方「富媒体消息」「发送单聊消息」两篇 |
| v1 | 2026-08-20 | 初版（入站附件下载/注册 + 出站路径提取与发送；上传按 multipart 假设） | 用户裁定 |
