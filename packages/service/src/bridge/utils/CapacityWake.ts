/**
 * 桥接轮询循环的共享容量唤醒原语
 * replBridge和bridgeMain都需要在"满容量"时休眠
 * 但在以下情况下提前唤醒：(a)外部循环信号中止（关闭），或(b)容量释放（会话完成/传输丢失）
 */

export type CapacitySignal = { signal: AbortSignal; cleanup: () => void };

export type CapacityWake = {
  signal(): CapacitySignal;
  wake(): void;
};

export function createCapacityWake(outerSignal: AbortSignal): CapacityWake {
  let wakeController = new AbortController();

  function wake(): void {
    wakeController.abort();
    wakeController = new AbortController();
  }

  function signal(): CapacitySignal {
    const merged = new AbortController();
    const abort = (): void => merged.abort();

    if (outerSignal.aborted || wakeController.signal.aborted) {
      merged.abort();
      return { signal: merged.signal, cleanup: () => {} };
    }

    outerSignal.addEventListener('abort', abort, { once: true });
    const capSig = wakeController.signal;
    capSig.addEventListener('abort', abort, { once: true });

    return {
      signal: merged.signal,
      cleanup: () => {
        outerSignal.removeEventListener('abort', abort);
        capSig.removeEventListener('abort', abort);
      },
    };
  }

  return { signal, wake };
}
