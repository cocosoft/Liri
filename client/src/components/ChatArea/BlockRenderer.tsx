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
import { useTranslation } from "react-i18next";
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
import { DocWorkflowProgress } from "./DocWorkflowProgress";
import PdcaWorkflowCard from "./PdcaWorkflowCard";
import CodeRunCard from "./CodeRunCard";
import { useChatStore } from "../../stores/chat";
import { createLogger } from "@/utils/logger";

const logger = createLogger("BlockRenderer");

/** P3-8：各 block 类型数据缺失时的统一兜底文案（键映射；未登记类型回退原 type） */
const MISSING_DATA_LABEL_KEYS: Record<string, string> = {
  tool_call: "chat.toolCall",
  question: "chat.blockTypeQuestion",
  task: "chat.blockTypeTask",
  progress: "chat.blockTypeProgress",
  deliverable: "chat.blockTypeDeliverable",
  diff: "chat.blockTypeDiff",
  inbox: "chat.blockTypeInbox",
  doc_workflow: "chat.blockTypeDocWorkflow",
};

/** P3-8：数据缺失兜底（8 处重复模式抽组件）：DEV 记录日志 + 统一样式展示 */
function MissingDataFallback({
  type,
  block,
}: {
  type: string;
  block: MessageBlock;
}) {
  const { t } = useTranslation();
  if (import.meta.env.DEV) {
    logger.warn(`[BlockRenderer] ${type} block 数据缺失`, block);
  }
  const labelKey = MISSING_DATA_LABEL_KEYS[type];
  const label = labelKey ? t(labelKey) : type;
  return (
    <div className="text-xs text-gray-400 italic px-2 py-1">
      {t("chat.blockDataMissing", { type: label })}
    </div>
  );
}

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
          phase={block.phase}
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
      return <MissingDataFallback type="tool_call" block={block} />;
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
      return <MissingDataFallback type="question" block={block} />;
    case "task_decomposition":
    case "todo":
      if (block.taskCard) {
        return <TaskCard data={block.taskCard} />;
      }
      return <MissingDataFallback type="task" block={block} />;
    case "progress":
      if (block.progressData) {
        return <ProgressCard data={block.progressData} />;
      }
      return <MissingDataFallback type="progress" block={block} />;
    case "deliverable":
      if (block.deliverableData) {
        return <DeliverableCard data={block.deliverableData} />;
      }
      return <MissingDataFallback type="deliverable" block={block} />;
    case "diff":
      if (block.diffData) {
        return <DiffBlock data={block.diffData} />;
      }
      return <MissingDataFallback type="diff" block={block} />;
    case "inbox":
      if (block.inboxData) {
        return <InboxBlock data={block.inboxData} sessionId={sessionId} />;
      }
      return <MissingDataFallback type="inbox" block={block} />;
    case "doc_workflow":
      if (block.docWorkflowData) {
        return (
          <DocWorkflowProgress
            data={block.docWorkflowData}
            isStreaming={block.isStreaming}
          />
        );
      }
      return <MissingDataFallback type="doc_workflow" block={block} />;
    case "pdca_workflow":
      if (block.pdcaWorkflowData) {
        return (
          <PdcaWorkflowCard
            sessionId={sessionId}
            data={block.pdcaWorkflowData}
          />
        );
      }
      return <MissingDataFallback type="pdca_workflow" block={block} />;
    case "code_run":
      if (block.codeRunData) {
        return <CodeRunCard data={block.codeRunData} />;
      }
      return <MissingDataFallback type="code_run" block={block} />;
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
