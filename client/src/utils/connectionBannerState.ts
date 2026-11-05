/**
 * 连接横幅的状态映射（C7，2026-11-05）。
 *
 * 单独成文件而非放在组件里：组件文件只导出组件（`react-refresh/only-export-components`），
 * 纯判定放这里便于单测直接引用，无需渲染。
 */
import { ConnectionState } from "../services/connectionMonitor";

/** 横幅类型：CONNECTED / RECONNECTING 不需要提示 */
export function connectionBannerKind(
  state: ConnectionState,
): "offline" | "disconnected" | null {
  if (state === ConnectionState.OFFLINE) return "offline";
  if (state === ConnectionState.DISCONNECTED) return "disconnected";
  return null;
}
