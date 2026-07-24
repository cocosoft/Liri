/**
 * ErrorBoundary
 * 轻量级错误边界 — 捕获子组件渲染错误，防止白屏
 */
import { Component, type ReactNode } from "react";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("components:image:ErrorBoundary");

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    logger.error("ErrorBoundary caught", {
      error,
      componentStack: info.componentStack,
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
