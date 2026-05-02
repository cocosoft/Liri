/**
 * 开发工具栏组件
 * 显示开发模式下的调试信息
 */

import React from 'react';

export interface DevBarProps {
  visible?: boolean;
  cpuUsage?: number;
  memoryUsage?: number;
  requestCount?: number;
  latency?: number;
  onClose?: () => void;
}

export const DevBar: React.FC<DevBarProps> = ({
  visible = true,
  cpuUsage = 0,
  memoryUsage = 0,
  requestCount = 0,
  latency = 0,
  onClose,
}) => {
  if (!visible) return null;

  const getStatusColor = (value: number): string => {
    if (value < 50) return 'green';
    if (value < 80) return 'yellow';
    return 'red';
  };

  return (
    <div className="dev-bar">
      <div className="dev-bar-left">
        <div className="dev-item">
          <span className="dev-label">CPU</span>
          <span className={`dev-value ${getStatusColor(cpuUsage)}`}>
            {cpuUsage.toFixed(1)}%
          </span>
        </div>
        
        <div className="dev-item">
          <span className="dev-label">MEM</span>
          <span className={`dev-value ${getStatusColor(memoryUsage)}`}>
            {memoryUsage.toFixed(1)}%
          </span>
        </div>
        
        <div className="dev-item">
          <span className="dev-label">REQ</span>
          <span className="dev-value">{requestCount}</span>
        </div>
        
        <div className="dev-item">
          <span className="dev-label">LAT</span>
          <span className={`dev-value ${latency > 500 ? 'yellow' : latency > 1000 ? 'red' : 'green'}`}>
            {latency}ms
          </span>
        </div>
      </div>
      
      <div className="dev-bar-right">
        <button className="dev-close-btn" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  );
};

export function createDevBar(props?: Partial<DevBarProps>): React.ReactElement {
  return <DevBar {...props} />;
}