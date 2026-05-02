/**
 * MCP组件
 * 提供模型控制协议相关的UI组件
 */

import React, { useState, useEffect } from 'react';

export interface MCPState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  model?: string;
  temperature?: number;
  maxTokens?: number;
  error?: string;
}

export interface MCPComponentProps {
  state?: MCPState;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onUpdateSettings?: (settings: Partial<MCPState>) => void;
}

export const MCPComponent: React.FC<MCPComponentProps> = ({
  state = { status: 'disconnected' },
  onConnect,
  onDisconnect,
  onUpdateSettings,
}) => {
  const [localSettings, setLocalSettings] = useState({
    temperature: state.temperature ?? 0.7,
    maxTokens: state.maxTokens ?? 4096,
  });

  useEffect(() => {
    setLocalSettings({
      temperature: state.temperature ?? 0.7,
      maxTokens: state.maxTokens ?? 4096,
    });
  }, [state]);

  const handleTemperatureChange = (value: number) => {
    setLocalSettings((prev) => ({ ...prev, temperature: value }));
    if (onUpdateSettings) {
      onUpdateSettings({ temperature: value });
    }
  };

  const handleMaxTokensChange = (value: number) => {
    setLocalSettings((prev) => ({ ...prev, maxTokens: value }));
    if (onUpdateSettings) {
      onUpdateSettings({ maxTokens: value });
    }
  };

  const getStatusColor = () => {
    switch (state.status) {
      case 'connected':
        return 'green';
      case 'connecting':
        return 'yellow';
      case 'error':
        return 'red';
      default:
        return 'gray';
    }
  };

  const getStatusText = () => {
    switch (state.status) {
      case 'connected':
        return '已连接';
      case 'connecting':
        return '连接中...';
      case 'error':
        return '连接失败';
      default:
        return '未连接';
    }
  };

  return (
    <div className="mcp-component">
      <div className="mcp-header">
        <h3>MCP 控制</h3>
        <div className={`status-badge ${getStatusColor()}`}>
          {getStatusText()}
        </div>
      </div>

      {state.error && (
        <div className="mcp-error">
          ⚠️ {state.error}
        </div>
      )}

      <div className="mcp-model-info">
        <span className="model-label">模型:</span>
        <span className="model-value">{state.model || '未选择'}</span>
      </div>

      <div className="mcp-controls">
        <div className="control-group">
          <label className="control-label">
            温度: {localSettings.temperature.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={localSettings.temperature}
            onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
            className="temperature-slider"
          />
        </div>

        <div className="control-group">
          <label className="control-label">
            最大Token数: {localSettings.maxTokens}
          </label>
          <input
            type="range"
            min="256"
            max="16384"
            step="256"
            value={localSettings.maxTokens}
            onChange={(e) => handleMaxTokensChange(parseInt(e.target.value))}
            className="tokens-slider"
          />
        </div>
      </div>

      <div className="mcp-actions">
        {state.status === 'disconnected' && (
          <button className="connect-btn" onClick={onConnect}>
            连接
          </button>
        )}
        {state.status === 'connected' && (
          <button className="disconnect-btn" onClick={onDisconnect}>
            断开连接
          </button>
        )}
        {state.status === 'connecting' && (
          <button className="connecting-btn" disabled>
            连接中...
          </button>
        )}
      </div>
    </div>
  );
};

export function createMCPComponent(props?: Partial<MCPComponentProps>): React.ReactElement {
  return <MCPComponent {...props} />;
}