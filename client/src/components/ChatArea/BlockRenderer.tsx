/**
 * BlockRenderer 组件
 *
 * 根据 MessageBlock 的 type 分发渲染：
 * - thinking → ThinkingBlock
 * - status → StatusBlock
 * - tool_call → ToolCallBlock
 * - question → QuestionBlock
 * - task_decomposition / todo → TaskCard
 * - progress → ProgressCard
 * - deliverable → DeliverableCard
 * - diff → DiffBlock
 * - text / default → MarkdownRenderer
 */
import type { MessageBlock } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";
import ThinkingBlock from "./ThinkingBlock";
import StatusBlock from "./StatusBlock";
import ToolCallGroup from "./ToolCallGroup";
import QuestionBlock from "./QuestionBlock";
import TaskCard from "./TaskCard";
import ProgressCard from "./ProgressCard";
import DeliverableCard from "./DeliverableCard";
import DiffBlock from "./DiffBlock";
import InboxBlock from "./InboxBlock";
import { useChatStore } from "../../stores/chat";
import { createLogger } from "@/utils/logger";

const logger = createLogger("BlockRenderer");

interface BlockRendererProps {
  block: MessageBlock;
  sessionId?: string;
  knownFilePaths?: string[];
  onQuestionResponse?: (content: string) => void;
}

function BlockRenderer({
  block,
  sessionId,
  knownFilePaths,
  onQuestionResponse,
}: BlockRendererProps) {
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);

switch (block.type) {
    case "thinking":
      return (
        <ThinkingBlock
          content={block.content}
          isStreaming={block.isStreaming ?? false}
        />
      );
    case "status":
      return (
        <StatusBlock
          content={block.content}
          isStreaming={block.isStreaming ?? false}
          status={block.status}
        />
      );
    case "tool_call":
      if (block.toolCall) {
        return (
          <ToolCallGroup
            toolCall={block.toolCall}
            isStreaming={block.isStreaming ?? false}
            variant="card"
          />
        );
      }
      if (import.meta.env.DEV)
        logger.warn(
          "[BlockRenderer] tool_call block 缺少 toolCall 数据",
          block,
        );
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          工具调用数据缺失
        </div>
      );
    case "question":
      if (block.questionData) {
        return (
          <QuestionBlock
            questionData={block.questionData}
            sessionId={sessionId}
            onResponse={onQuestionResponse}
          />
        );
      }
      if (import.meta.env.DEV)
        logger.warn("[BlockRenderer] question block 缺少 questionData", block);
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          问题数据缺失
        </div>
      );
    case "task_decomposition":
    case "todo":
      if (block.taskCard) {
        return <TaskCard data={block.taskCard} />;
      }
      if (import.meta.env.DEV)
        logger.warn("[BlockRenderer] task block 缺少 taskCard 数据", block);
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          任务数据缺失
        </div>
      );
    case "progress":
      if (block.progressData) {
        return <ProgressCard data={block.progressData} />;
      }
      if (import.meta.env.DEV)
        logger.warn("[BlockRenderer] progress block 缺少 progressData", block);
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          进度数据缺失
        </div>
      );
    case "deliverable":
      if (block.deliverableData) {
        return (
          <DeliverableCard
            data={block.deliverableData}
          />
        );
      }
      if (import.meta.env.DEV)
        logger.warn(
          "[BlockRenderer] deliverable block 缺少 deliverableData",
          block,
        );
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          交付物数据缺失
        </div>
      );
    case "diff":
      if (block.diffData) {
        return <DiffBlock data={block.diffData} />;
      }
      if (import.meta.env.DEV)
        logger.warn("[BlockRenderer] diff block 缺少 diffData", block);
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          差异数据缺失
        </div>
      );
    case "inbox":
      if (block.inboxData) {
        return <InboxBlock data={block.inboxData} sessionId={sessionId} />;
      }
      if (import.meta.env.DEV)
        logger.warn("[BlockRenderer] inbox block 缺少 inboxData", block);
      return (
        <div className="text-xs text-gray-400 italic px-2 py-1">
          收件箱数据缺失
        </div>
      );
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming ?? false}
          onPreviewFile={readFileToPreview}
          knownFilePaths={knownFilePaths}
        />
      );
  }
}

export default BlockRenderer;
