import React, { useState, useRef, useEffect } from 'react';

interface StatusBlockProps {
  content: string;
  isStreaming?: boolean;
}

function StatusBlock({ content, isStreaming }: StatusBlockProps) {
  const [collapsed, setCollapsed] = useState(!isStreaming);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setCollapsed(true);
    }
  }, [isStreaming]);

  const isRunning = content.includes('Running');
  const isToolStatus = content.includes('Running tool') || content.includes('Tool ') && (content.includes('completed') || content.includes('失败'));

  return (
    <div style={styles.container}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={styles.header}
      >
        <span style={styles.icon}>
          {isRunning ? (
            <span style={styles.dot}></span>
          ) : isToolStatus ? '📦' : '⚪'}
        </span>
        <span style={{ ...styles.text, color: isRunning ? '#e6c384' : '#7aa2f7', fontStyle: isRunning ? 'italic' : 'normal' }}>
          {content}
        </span>
        <span style={styles.toggle}>{collapsed ? '▶' : '▼'}</span>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: '4px',
    border: '1px solid rgba(122, 162, 247, 0.15)',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 12px',
    background: 'rgba(122, 162, 247, 0.06)',
    border: 'none',
    width: '100%',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    fontSize: '13px',
  },
  icon: {
    fontSize: '10px',
    color: '#565f89',
    flexShrink: 0,
  },
  dot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#e6c384',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  text: {
    flex: 1,
    textAlign: 'left',
  },
  toggle: {
    fontSize: '10px',
    color: '#565f89',
    flexShrink: 0,
  },
};

export default StatusBlock;
