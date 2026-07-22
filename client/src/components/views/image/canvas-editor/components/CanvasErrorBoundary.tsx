// canvas-editor/components/CanvasErrorBoundary.tsx — 画布编辑器错误边界

import { Component, ReactNode } from "react";

interface State {
  hasError: boolean;
  errorMsg: string;
}

export class CanvasErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { hasError: false, errorMsg: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error.message };
  }

  handleRecover = () => {
    this.setState({ hasError: false, errorMsg: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-gray-900 gap-3">
          <span className="text-sm text-gray-400">画布编辑器遇到异常</span>
          <span className="text-xs text-gray-600 max-w-md text-center">
            {this.state.errorMsg}
          </span>
          <button
            onClick={this.handleRecover}
            className="px-3 py-1 text-xs rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
          >
            尝试恢复
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
