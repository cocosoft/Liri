//
/**
 * FPS指标上下文（参考CC源码 cc_code/context/fpsMetrics.tsx）
 * 跟踪应用帧率性能指标
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from 'react';

export interface FPSMetrics {
  fps: number;
  minFps: number;
  maxFps: number;
  avgFps: number;
  frameTime: number;
  droppedFrames: number;
  isSmooth: boolean;
}

export interface FPSMetricsContextType {
  metrics: FPSMetrics;
  startTracking: () => void;
  stopTracking: () => void;
  isTracking: boolean;
}

const initialMetrics: FPSMetrics = {
  fps: 60,
  minFps: 60,
  maxFps: 60,
  avgFps: 60,
  frameTime: 16.67,
  droppedFrames: 0,
  isSmooth: true,
};

const FPSMetricsContext = createContext<FPSMetricsContextType | undefined>(
  undefined
);

export const FPSMetricsProvider = ({ children }: { children: ReactNode }) => {
  const [metrics, setMetrics] = useState<FPSMetrics>(initialMetrics);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const animationFrameIdRef = useRef<number | null>(null);
  const isTrackingRef = useRef<boolean>(false);
  const droppedFramesRef = useRef<number>(0);

  const calculateMetrics = useCallback((currentTime: number) => {
    const frameTime = currentTime - lastFrameTimeRef.current;
    lastFrameTimeRef.current = currentTime;

    // 计算FPS
    const fps = frameTime > 0 ? 1000 / frameTime : 0;

    // 存储最近60帧的时间用于计算平均值
    frameTimesRef.current.push(frameTime);
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }

    // 检查是否丢帧（超过16.67ms * 1.5 = 25ms视为丢帧）
    if (frameTime > 25) {
      droppedFramesRef.current++;
    }

    // 计算统计数据
    const avgFrameTime =
      frameTimesRef.current.reduce((a, b) => a + b, 0) /
      frameTimesRef.current.length;
    const avgFps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    const minFps = Math.min(
      ...frameTimesRef.current.map((t) => (t > 0 ? 1000 / t : 0))
    );
    const maxFps = Math.max(
      ...frameTimesRef.current.map((t) => (t > 0 ? 1000 / t : 0))
    );

    setMetrics({
      fps: Math.round(fps),
      minFps: Math.round(minFps),
      maxFps: Math.round(maxFps),
      avgFps: Math.round(avgFps),
      frameTime: Math.round(frameTime * 100) / 100,
      droppedFrames: droppedFramesRef.current,
      isSmooth: avgFps >= 55,
    });
  }, []);

  const trackFrame = useCallback(() => {
    if (!isTrackingRef.current) return;

    calculateMetrics(performance.now());
    animationFrameIdRef.current = requestAnimationFrame(trackFrame);
  }, [calculateMetrics]);

  const startTracking = useCallback(() => {
    if (isTrackingRef.current) return;

    isTrackingRef.current = true;
    lastFrameTimeRef.current = performance.now();
    frameTimesRef.current = [];
    droppedFramesRef.current = 0;

    animationFrameIdRef.current = requestAnimationFrame(trackFrame);
  }, [trackFrame]);

  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopTracking();
    };
  }, [stopTracking]);

  return (
    <FPSMetricsContext.Provider
      value={{
        metrics,
        startTracking,
        stopTracking,
        isTracking: isTrackingRef.current,
      }}
    >
      {children}
    </FPSMetricsContext.Provider>
  );
};

export const useFPSMetrics = (): FPSMetricsContextType => {
  const context = useContext(FPSMetricsContext);
  if (context === undefined) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useFPSMetrics', provider: 'FPSMetricsProvider' }
    );
  }
  return context;
};
