import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** 自定义 fallback UI，默认显示通用错误页 */
  fallback?: ReactNode;
  /** 错误回调（如上报） */
  onError?: (error: Error, errorInfo: string) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo.componentStack ?? "");
  }

  handleRefresh = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8" role="alert" aria-live="assertive">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4" aria-hidden="true">⚠️</div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              页面发生错误
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {this.state.error?.message || "未知错误"}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                aria-label="重试加载"
              >
                重试
              </button>
              <button
                onClick={this.handleRefresh}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                aria-label="刷新页面"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
