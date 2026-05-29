import React, { useState, useRef, useEffect } from 'react';
import type { ToolCall } from '../../types';

interface ToolCallBlockProps {
  toolCall: ToolCall;
  isStreaming?: boolean;
}

function ToolCallBlock({ toolCall, isStreaming }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setExpanded(false);
    }
  }, [isStreaming]);

  const statusIcon = isStreaming ? '⏳' :
    toolCall.status === 'completed' ? '✅' :
    toolCall.status === 'failed' ? '❌' : '🔧';

  const statusColor = isStreaming ? '#e6c384' :
    toolCall.status === 'completed' ? '#9ece6a' :
    toolCall.status === 'failed' ? '#f7768e' : '#7aa2f7';

  return (
    <div style={styles.container}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.header}
      >
        <span>{statusIcon}</span>
        <span style={styles.name}>{toolCall.name}</span>
        <span style={{ ...styles.badge, background: statusColor }}>
          {isStreaming ? 'running' : (toolCall.status || 'completed')}
        </span>
        <span style={styles.toggle}>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div style={styles.body}>
          {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Arguments:</div>
              <pre style={styles.pre}>
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Result:</div>
              <pre style={styles.pre}>
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '1px solid rgba(122, 162, 247, 0.25)',
    borderRadius: '8px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: 'rgba(122, 162, 247, 0.06)',
    border: 'none',
    width: '100%',
    cursor: 'pointer',
    color: '#a9b1d6',
    fontSize: '13px',
    textAlign: 'left',
    fontFamily: 'inherit',
  },
  name: {
    flex: 1,
    fontWeight: 500,
    color: '#e0e0e0',
  },
  badge: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '10px',
    color: '#1a1b26',
    fontWeight: 600,
  },
  toggle: {
    fontSize: '10px',
    flexShrink: 0,
  },
  body: {
    padding: '8px 12px',
    borderTop: '1px solid rgba(122, 162, 247, 0.12)',
  },
  section: {
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#565f89',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  pre: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#a9b1d6',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    background: 'rgba(0,0,0,0.15)',
    padding: '8px',
    borderRadius: '4px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
};

export default ToolCallBlock;
