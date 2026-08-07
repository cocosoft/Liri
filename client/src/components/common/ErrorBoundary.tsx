import { Component, type ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:errorBoundary");

/** 动态导入失败的最大连续自动重试次数（间隔 800ms） */
const MAX_DYNAMIC_IMPORT_RETRY = 3;

interface ErrorBoundaryProps extends WithTranslation {
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

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error("Caught error: " + String(error), errorInfo.componentStack);
    this.props.onError?.(error, errorInfo.componentStack ?? "");

    // 动态导入失败（vite dev 依赖重新优化 504 / 网络瞬时）时自动重试：
    // lazy 组件重新挂载会再次 fetch 模块，通常可自愈。此 ErrorBoundary 为单例包裹全部
    // lazy 路由（App.tsx），vite 每次新增依赖都会再次 re-optimize —— 因此用连续失败计数
    // 而非一次性标记，使后续 re-optimize 仍可自动重试；上限 3 次防止模块持续不可用时无限循环。
    const msg = String(error?.message ?? error);
    if (
      this.autoRetryCount < MAX_DYNAMIC_IMPORT_RETRY &&
      /failed to fetch dynamically imported module|failed to resolve module specifier/i.test(
        msg,
      )
    ) {
      this.autoRetryCount++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.setState({ hasError: false, error: null });
      }, 800);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** 动态导入失败连续自动重试计数 */
  private autoRetryCount = 0;
  /** 自动重试定时器（组件卸载时清理，避免 setState on unmounted） */
  private retryTimer: number | null = null;

  handleRefresh = (): void => {
    window.location.reload();
  };

  handleReset = (): void => {
    this.autoRetryCount = 0;
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="flex items-center justify-center min-h-[400px] p-8"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4" aria-hidden="true">
              ⚠️
            </div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
              {this.props.t("errorBoundary.title")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {this.state.error?.message ||
                this.props.t("errorBoundary.unknown")}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                aria-label={this.props.t("errorBoundary.retryAria")}
              >
                {this.props.t("errorBoundary.retry")}
              </button>
              <button
                onClick={this.handleRefresh}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                aria-label={this.props.t("errorBoundary.refreshAria")}
              >
                {this.props.t("errorBoundary.refresh")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const TranslatedErrorBoundary = withTranslation()(ErrorBoundary);
export { TranslatedErrorBoundary as ErrorBoundary };
export default TranslatedErrorBoundary;
