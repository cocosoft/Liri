import { useState, useRef, useEffect } from 'react';
import { useVoiceStore } from '../stores/voiceStore';

interface VoiceInputButtonProps {
  isDark: boolean;
}

function VoiceInputButton({ isDark }: VoiceInputButtonProps) {
  const {
    isRecording,
    isProcessing,
    audioLevel,
    startRecording,
    stopRecording,
  } = useVoiceStore();

  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const analyzerRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (analyzerRef.current) {
        analyzerRef.current.close();
      }
    };
  }, []);

  const startAudioAnalysis = async (stream: MediaStream) => {
    const audioContext = new AudioContext();
    analyzerRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);

    const dataArray = new Uint8Array(analyzer.frequencyBinCount);

    const updateLevel = () => {
      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const normalizedLevel = Math.min(100, (average / 128) * 100);
      useVoiceStore.setState({ audioLevel: normalizedLevel });
      animationRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  };

  const handleMouseDown = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      setMediaRecorder(recorder);

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());

        if (analyzerRef.current) {
          analyzerRef.current.close();
          analyzerRef.current = null;
        }
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        useVoiceStore.setState({ audioLevel: 0 });
      };

      recorder.start();
      await startRecording();
      await startAudioAnalysis(stream);
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
  };

  const handleMouseUp = async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      await stopRecording();
    }
  };

  const pulseScale = isRecording ? 1 + (audioLevel / 100) * 0.3 : 1;

  return (
    <button
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={isRecording ? handleMouseUp : undefined}
      disabled={isProcessing}
      className={`relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-150 ${
        isProcessing
          ? isDark
            ? 'bg-gray-700 cursor-not-allowed'
            : 'bg-gray-300 cursor-not-allowed'
          : isRecording
          ? 'bg-red-500 hover:bg-red-600'
          : isDark
          ? 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
      }`}
      style={{ transform: `scale(${pulseScale})` }}
      title={isRecording ? '松开发送' : '按住说话'}
    >
      {isProcessing ? (
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isRecording ? (
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}

      {isRecording && (
        <span
          className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30"
          style={{ animationDuration: '1s' }}
        />
      )}
    </button>
  );
}

export default VoiceInputButton;