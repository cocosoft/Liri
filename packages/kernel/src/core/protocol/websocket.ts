/**
 * WebSocket 握手协议常量 · **唯一事实源**（RFC 6455）
 *
 * 来源（硬编码治理 B5-2㉘）：`MAGIC_GUID` 曾在 **4 处**各自定义 ——
 * `acp/websocket.ts`（核心层，曾 `export` 但**零消费者**）· `voice/upgrade.ts` ·
 * `voice/WakeWebSocketServer.ts` · `services/voice/services/edgeTTSTransport.ts`（名为 `WS_GUID`），
 * 另有测试字面量 ⇒ **同事实多副本**。前次 B2 已登记解锁条件：
 * **须先在 core 层立真源**才能合一 —— 理由：`acp` 归 **core** 层，**不能**引用 infra 的 `constants`
 * （R00-001），且 `@modules/acp/websocket` 并非 acp 的规范出口（R03-002）。
 *
 * 分层纪律（与 `core/endpoints.ts` 同）：本文件**零 import、不读 config**（core 只允许依赖 core）。
 *
 * 迁移口径：本片迁移 `WEBSOCKET_MAGIC_GUID` 的 4 个 src 站点；其余同族常量（版本号 / 三个握手头名）
 * 为**同一协议真源**的一部分，供后续分批迁移（已登记 `reopenWhen`）。
 */

/** RFC 6455 §1.3：`Sec-WebSocket-Accept = base64(SHA-1(key + 本 GUID))` 的固定魔数 */
export const WEBSOCKET_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** RFC 6455 §4.1/§4.2.1：`Sec-WebSocket-Version` 的当前取值（本仓仅支持 13） */
export const SEC_WEBSOCKET_VERSION = '13';

/** RFC 6455 §11.3.1：握手**请求**头名（客户端随机 16 字节 base64） */
export const SEC_WEBSOCKET_KEY_HEADER = 'Sec-WebSocket-Key';

/** RFC 6455 §4.2.2/§11.3.2：握手**响应**头名（服务端 Accept 值） */
export const SEC_WEBSOCKET_ACCEPT_HEADER = 'Sec-WebSocket-Accept';

/** RFC 6455 §11.3.4：子协议协商头名（本仓用于 WS 握手鉴权传递） */
export const SEC_WEBSOCKET_PROTOCOL_HEADER = 'Sec-WebSocket-Protocol';
