/**
 * 通用 Error Boundary 组件
 * 包裹渲染器、面板等，确保单个组件崩溃不影响其他部分
 */

import { Component, type ReactNode } from "react";
import { createLogger } from "../../../../utils/logger";

const logger = createLogger("components:office:ErrorBoundary");

interface ErrorBoundaryProps {
  /** 自定义错误回退 UI */
  fallback?: ReactNode;
  /** 默认错误回退文案（无 fallback 时使用） */
  message?: string;
  /** 子组件 */
  children: ReactNode;
  /** 错误回调（埋点上报等） */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error("ErrorBoundary caught", { error, errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  /** 重置错误状态，重新尝试渲染 */
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center p-6 text-center"
        >
          <p className="text-gray-500 dark:text-gray-400 mb-2">
            {this.props.message ?? "组件加载失败"}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
