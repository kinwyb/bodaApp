/**
 * 语音输入：点一下麦克风开始，再点一下才结束（说完停顿不会自己停）。
 *
 * 为什么不用 `Sender` 内置的 `allowSpeech={true}`：那条路是 @ant-design/x 自己
 * `new SpeechRecognition()`，只挂了 onstart/onend/onresult，没设 `continuous`。
 * 浏览器默认 `continuous = false`，语义是「识别完一句话就结束」—— 用户说几个字、
 * 换口气的停顿（约 0.5~1 秒静音）就被判成一整句说完，于是「才说几个字就自动停」。
 * 另外它也没设 `lang`（中文环境经常识别成乱码或干脆没有结果），`onresult` 只取
 * `results[0][0]`（连续说几句也只把第一句塞进输入框）。
 *
 * 所以这里改走 Sender 的**受控模式**（`allowSpeech={{ recording, onRecordingChange }}`），
 * 识别实例自己持有：
 * - `continuous = true`：一句话说完继续听，不等用户停；
 * - `lang = 'zh-CN'`：按中文识别；
 * - `onend` 里**用户没点停止就自动续上**：Chrome 即使在 continuous 模式下，
 *   长时间静音 / 网络抖动仍会自己 end，不续的话又变回「说几句就停」；
 * - 只把 `isFinal` 的分段追加进输入框：interim 结果会反复改写，塞进去会抖。
 *
 * 注意 Web Speech API 是浏览器自带的（Chrome / Edge 走云端识别，要联网），
 * 桌面壳 MyGo 用的是 WKWebView（Safari 内核），没有这个能力，`supported` 为 false。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Web Speech API 的最小类型定义：lib.dom 至今没收录 SpeechRecognition */
type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative };
type SpeechResultList = { length: number; [index: number]: SpeechResult };
type SpeechResultEvent = { resultIndex: number; results: SpeechResultList };
type SpeechErrorEvent = { error: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** 连续被判停几次就彻底停下：没权限时 start 会立刻 end，不设上限就是死循环 */
const MAX_RESTARTS = 3;

const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器地址栏放开麦克风权限',
  'service-not-allowed': '浏览器不允许使用语音识别服务',
  network: '语音识别服务连不上（Chrome 的识别要联网），请检查网络后重试',
  'audio-capture': '没有找到可用的麦克风',
  'language-not-supported': '当前浏览器不支持中文语音识别',
};

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const host = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}

export type VoiceInputHandle = {
  /** 正在听（受控状态，交给 Sender 点亮波形图标） */
  recording: boolean;
  /** 当前环境有没有浏览器语音识别（桌面壳没有） */
  supported: boolean;
  /** 直接摊给 `<Sender allowSpeech={...} />` */
  allowSpeech: false | { recording: boolean; onRecordingChange: (recording: boolean) => void };
};

export function useVoiceInput({
  onTranscript,
  onError,
  lang = 'zh-CN',
}: {
  /** 收到一段定稿文本（可能一次只说半句，分段回调） */
  onTranscript: (text: string) => void;
  /** 权限 / 网络 / 不支持之类的提示 */
  onError?: (message: string) => void;
  lang?: string;
}): VoiceInputHandle {
  const [recording, setRecording] = useState(false);
  const supported = useMemo(() => Boolean(getRecognitionCtor()), []);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** 用户主动点了停止：onend 据此区分「正常收尾」和「被浏览器判停，要续上」 */
  const manualStopRef = useRef(false);
  /** 连续被浏览器判停的次数（识别出内容就清零） */
  const restartsRef = useRef(0);
  /** 续听的定时器：卸载后不能再 start */
  const restartTimerRef = useRef<number | null>(null);

  // 回调放 ref：识别实例只建一次，不能因为回调换了引用就重建
  const transcriptRef = useRef(onTranscript);
  const errorRef = useRef(onError);
  useEffect(() => {
    transcriptRef.current = onTranscript;
    errorRef.current = onError;
  }, [onTranscript, onError]);

  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return null;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setRecording(true);

    recognition.onresult = (event) => {
      // 只取「已定稿」的分段：interim 结果每次都在改写，直接塞进输入框会来回跳
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;
        const text = result[0]?.transcript?.trim();
        if (!text) continue;
        restartsRef.current = 0;
        transcriptRef.current(text);
      }
    };

    recognition.onerror = (event) => {
      // 静音（no-speech）与主动中止交给 onend 收尾，不算错误
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // 权限、网络这类问题重启也没用，直接停
      manualStopRef.current = true;
      setRecording(false);
      errorRef.current?.(SPEECH_ERRORS[event.error] ?? `语音识别失败：${event.error}`);
    };

    recognition.onend = () => {
      if (manualStopRef.current) {
        manualStopRef.current = false;
        setRecording(false);
        return;
      }
      // 用户没点停止：浏览器自己结束了（长时间静音 / 短暂网络抖动），续上
      if (restartsRef.current >= MAX_RESTARTS) {
        setRecording(false);
        errorRef.current?.('语音识别反复中断，已停止，请重新点麦克风');
        return;
      }
      restartsRef.current += 1;
      // 隔一帧再 start：onend 回调里同步 start 有概率抛 InvalidStateError（识别还占着）
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        try {
          recognition.start();
        } catch {
          setRecording(false);
        }
      }, 0);
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [lang]);

  const start = useCallback(() => {
    const recognition = ensureRecognition();
    if (!recognition) {
      errorRef.current?.(
        '当前环境不支持浏览器语音识别（桌面壳用的是 Safari 内核），请在 Chrome / Edge 里使用',
      );
      return;
    }
    manualStopRef.current = false;
    restartsRef.current = 0;
    setRecording(true);
    // 已经有续听在排队的话先掐掉，交给下面这一次显式 start
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    try {
      recognition.start();
    } catch {
      // 已经在识别中：忽略
    }
  }, [ensureRecognition]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    setRecording(false);
    // 掐掉待执行的续听：点停止时恰好有个 restart 在排队的话，会被重新拉起来
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // 本来就没在跑
    }
  }, []);

  const handleRecordingChange = useCallback(
    (next: boolean) => {
      if (next) start();
      else stop();
    },
    [start, stop],
  );

  // 卸载时收尾：先把回调摘掉，否则 abort 触发的 onend 会往已卸载的组件里 setState
  useEffect(() => {
    return () => {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch {
        // 没在跑
      }
      recognitionRef.current = null;
    };
  }, []);

  const allowSpeech = useMemo<VoiceInputHandle['allowSpeech']>(
    () => (supported ? { recording, onRecordingChange: handleRecordingChange } : false),
    [supported, recording, handleRecordingChange],
  );

  return { recording, supported, allowSpeech };
}
