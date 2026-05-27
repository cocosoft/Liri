/**
 * 请求取消管理
 * 提供AbortController封装用于取消请求
 */

export interface CancelRequestHandle {
  cancel: () => void;
  renew: () => AbortController;
  get signal(): AbortSignal;
}

let currentController: AbortController | null = null;

export function createCancelRequestStore(): CancelRequestHandle {
  const renew = (): AbortController => {
    if (currentController) {
      currentController.abort();
    }
    currentController = new AbortController();
    return currentController;
  };

  const cancel = (): void => {
    currentController?.abort();
  };

  renew();

  return {
    cancel,
    renew,
    get signal(): AbortSignal {
      return currentController!.signal;
    },
  };
}

let defaultCancelRequestInstance: CancelRequestHandle | null = null;

export function getDefaultCancelRequest(): CancelRequestHandle {
  if (!defaultCancelRequestInstance) {
    defaultCancelRequestInstance = createCancelRequestStore();
  }
  return defaultCancelRequestInstance;
}

export function resetCancelRequestCache(): void {
  defaultCancelRequestInstance = null;
  currentController = null;
}
