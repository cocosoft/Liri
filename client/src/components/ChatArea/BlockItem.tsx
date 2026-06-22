/**
 * 工具执行块渲染组件
 *
 * 根据 MessageBlock 类型分发到不同子组件：
 * - status → GroupStatusLine 行内状态
 * - tool_call → ToolCallBlock 卡片
 * - text/其他 → MarkdownRenderer 渲染
 */
import type { MessageBlock } from "../../types";
import ToolCallGroup from "./ToolCallGroup";
import MarkdownRenderer from "./MarkdownRenderer";
import GroupStatusLine from "./GroupStatusLine";

function BlockItem({
  block,
  onPreviewFile,
}: {
  block: MessageBlock;
  onPreviewFile?: (path: string) => void;
}) {
  switch (block.type) {
    case "status":
      return (
        <GroupStatusLine
          content={block.content}
          isStreaming={block.isStreaming ?? false}
        />
      );
    case "tool_call":
      return block.toolCall ? (
        <ToolCallGroup
          toolCall={block.toolCall}
          isStreaming={block.isStreaming ?? false}
          variant="card"
        />
      ) : null;
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming ?? false}
          onPreviewFile={onPreviewFile}
        />
      );
  }
}

export default BlockItem;