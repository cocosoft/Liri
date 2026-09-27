// canvas-editor/components/CanvasErrorBoundary.tsx — 画布编辑器错误边界

import { Component, ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";

interface State {
  hasError: boolean;
  errorMsg: string;
}

class CanvasErrorBoundary extends Component<
  { children: ReactNode } & WithTranslation,
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
          <span className="text-sm text-gray-400">
            {this.props.t("media.canvasErrorTitle")}
          </span>
          <span className="text-xs text-gray-600 max-w-md text-center">
            {this.state.errorMsg}
          </span>
          <button
            onClick={this.handleRecover}
            className="px-3 py-1 text-xs rounded bg-blue-700/40 hover:bg-blue-600/40 border-0 cursor-pointer text-blue-200"
          >
            {this.props.t("media.canvasErrorRecover")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TranslatedCanvasErrorBoundary = withTranslation()(CanvasErrorBoundary);
export { TranslatedCanvasErrorBoundary as CanvasErrorBoundary };
export default TranslatedCanvasErrorBoundary;
