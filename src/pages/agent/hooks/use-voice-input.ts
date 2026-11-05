/**
 * 语音输入：点一下开始录，再点一下结束 → 上传到本地 ASR 服务 → 文本回填。
 *
 * 为什么不用 `Sender` 内置的 `allowSpeech={true}`：那条路是 @ant-design/x 自己
 * `new SpeechRecognition()`（浏览器自带的 Web Speech），三个硬伤：
 * 1. 没设 `continuous`，默认识别完一句话就结束 —— 说几个字、换口气就被判停；
 * 2. 不能注入词表，`缝制`→`放置`、`辅料`→`佛疗`、`316180001`→`316-1801` 这类错救不回来；
 * 3. 桌面壳（WKWebView）根本没有这个 API，按钮点了没反应。
 *
 * 所以这里改走 `MediaRecorder` + 仓库 `asr/` 目录里的 SenseVoice 服务：
 * 录音整段上传（15 秒音频约 0.3 秒出结果，不必做流式），换来中文术语和
 * 9 位物料号的识别质量，以及浏览器与桌面壳统一可用。
 *
 * 交互上仍是「点开始、点停止才停」，不依赖任何语音活动检测。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribeVoice, voiceErrorMessage } from '../voice/client';

/** 录音格式候选：Chrome/Edge 是 webm/opus，Safari 只有 mp4。服务端 ffmpeg 都能解 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** 忘了点停止时的硬上限，避免一直在录 */
const MAX_RECORD_MS = 120_000;

/** 小于这个字节数基本是没录到东西（200ms 的 opus 只有几百字节） */
const MIN_BLOB_BYTES = 800;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '麦克风权限被拒绝，请在地址栏放开麦克风权限';
    if (error.name === 'NotFoundError') return '没找到可用的麦克风';
    if (error.name === 'NotReadableError') return '麦克风被其他程序占用了';
  }
  return '打不开麦克风，请检查系统权限';
}

export type VoiceInputHandle = {
  /** 正在录音（受控状态，交给 Sender 点亮波形图标） */
  recording: boolean;
  /** 录音已结束、正在等服务端识别 */
  transcribing: boolean;
  /** 当前环境能不能录音（决定语音按钮出不出来） */
  supported: boolean;
  /** 直接摊给 `<Sender allowSpeech={...} />` */
  allowSpeech: false | { recording: boolean; onRecordingChange: (recording: boolean) => void };
};

export function useVoiceInput({
  onTranscript,
  onError,
}: {
  /** 识别出的一段文本 */
  onTranscript: (text: string) => void;
  /** 权限 / 服务未启动之类的提示 */
  onError?: (message: string) => void;
}): VoiceInputHandle {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const supported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    [],
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** 还在等麦克风授权时用户就点了停止 */
  const pendingStopRef = useRef(false);
  /** 取流进行中：避免连点两次开两条录音 */
  const busyRef = useRef(false);
  /** 识别进行中：这期间不接受新的录音 */
  const transcribingRef = useRef(false);
  const maxTimerRef = useRef<number | null>(null);

  // 回调放 ref：录音流程是异步的，不能因为它换了引用就中断
  const transcriptRef = useRef(onTranscript);
  const errorRef = useRef(onError);
  useEffect(() => {
    transcriptRef.current = onTranscript;
    errorRef.current = onError;
  }, [onTranscript, onError]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** 录音结束：拼 Blob → 上传 → 回填 */
  const submit = useCallback(async (mimeType: string) => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const blob = new Blob(chunks, { type: mimeType });

    if (blob.size < MIN_BLOB_BYTES) {
      errorRef.current?.('没录到声音，检查一下麦克风');
      return;
    }

    transcribingRef.current = true;
    setTranscribing(true);
    try {
      // 纠错与格式规整都在服务端做（asr/business_terms.txt 是数据，不是代码）
      const text = await transcribeVoice(blob);
      if (text) transcriptRef.current(text);
      else errorRef.current?.('没听清，再说一次？');
    } catch (error) {
      errorRef.current?.(voiceErrorMessage(error));
    } finally {
      transcribingRef.current = false;
      setTranscribing(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported || busyRef.current || transcribingRef.current || recorderRef.current) return;

    busyRef.current = true;
    pendingStopRef.current = false;
    // 乐观置位：首次要弹授权框，等拿到流再亮图标会让人觉得点了没反应
    setRecording(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        return;
      }

      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const type = recorder.mimeType || mimeType || 'audio/webm';

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        recorderRef.current = null;
        releaseStream();
        // onstop 不是 async 上下文，这里不能 await
        void submit(type);
      };

      recorder.start(200);
      recorderRef.current = recorder;

      maxTimerRef.current = window.setTimeout(() => {
        maxTimerRef.current = null;
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
          setRecording(false);
        }
      }, MAX_RECORD_MS);
    } catch (error) {
      setRecording(false);
      errorRef.current?.(microphoneError(error));
    } finally {
      busyRef.current = false;
    }
  }, [supported, submit, releaseStream]);

  const stop = useCallback(() => {
    setRecording(false);
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      // 还在等授权：标记一下，流到手后立刻收尾
      pendingStopRef.current = true;
      return;
    }
    if (recorder.state !== 'inactive') recorder.stop();
  }, []);

  const handleRecordingChange = useCallback(
    (next: boolean) => {
      if (next) void start();
      else stop();
    },
    [start, stop],
  );

  // 卸载时收尾：先把 onstop 摘掉，否则会把半段录音传上去
  useEffect(
    () => () => {
      if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      recorderRef.current = null;
      releaseStream();
    },
    [releaseStream],
  );

  const allowSpeech = useMemo<VoiceInputHandle['allowSpeech']>(
    () => (supported ? { recording, onRecordingChange: handleRecordingChange } : false),
    [supported, recording, handleRecordingChange],
  );

  return { recording, transcribing, supported, allowSpeech };
}
