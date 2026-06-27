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
import { useNavigate } from "react-router-dom";
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
import { useChatStore } from "../../stores/chatStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface BlockRendererProps {
  block: MessageBlock;
  sessionId?: string;
  onQuestionResponse?: (content: string) => void;
}

function BlockRenderer({ block, sessionId, onQuestionResponse }: BlockRendererProps) {
  const readFileToPreview = useChatStore((s) => s.readFileToPreview);
  const navigate = useNavigate();
  const backendReady = useWorkspaceStore((s) => s.backendReady);

  /** 功能开关：VITE_FEATURE_WORK_MODULE=disabled 时隐藏工作模块入口 */
  const workModuleEnabled = import.meta.env.VITE_FEATURE_WORK_MODULE !== "disabled";

  /**
   * 进入工作模式：从聊天界面跳转到工作界面
   */
  const handleEnterWorkMode = () => {
    if (sessionId) {
      navigate(`/workspace/${sessionId}/work`);
    }
  };

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
      return block.toolCall ? (
        <ToolCallGroup
          toolCall={block.toolCall}
          isStreaming={block.isStreaming ?? false}
          variant="card"
        />
      ) : null;
    case "question":
      return block.questionData ? (
        <QuestionBlock
          questionData={block.questionData}
          sessionId={sessionId}
          onResponse={onQuestionResponse}
        />
      ) : null;
    case "task_decomposition":
      return block.taskCard ? <TaskCard data={block.taskCard} /> : null;
    case "todo":
      return block.taskCard ? <TaskCard data={block.taskCard} /> : null;
    case "progress":
      return block.progressData ? <ProgressCard data={block.progressData} /> : null;
    case "deliverable":
      return block.deliverableData ? (
        <DeliverableCard
          data={block.deliverableData}
          onEnterWorkMode={workModuleEnabled ? handleEnterWorkMode : undefined}
          workModeReady={backendReady}
        />
      ) : null;
    case "diff":
      return block.diffData ? <DiffBlock data={block.diffData} /> : null;
    case "text":
    default:
      return (
        <MarkdownRenderer
          content={block.content}
          isStreaming={block.isStreaming ?? false}
          onPreviewFile={readFileToPreview}
        />
      );
  }
}

export default BlockRenderer;