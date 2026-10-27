/**
 * 开发期下行帧诊断（生产构建里整段被摇掉）。
 *
 * 要回答的问题是：「界面不流式」到底卡在哪一段——
 * 1. 服务端根本没按 token 发（帧的到达时间就是稀疏的）；
 * 2. 帧正常逐条到达，但浏览器主线程被长任务占住，帧在事件队列里排队，
 *    等服务端静默后一次性清空 —— 现象就是内容突然整段出现。
 *
 * 所以在三个时刻打点：**到达 → 同步处理完 → 下一次绘制**。
 * 「到达→绘制」的差值就是这一帧在浏览器里被压了多久。
 *
 * 用法：浏览器控制台执行 `__AGENT_DIAG__.summary()`，或直接看 `__AGENT_DIAG__.frames`。
 */

import { AGENT_EVENT, KIND, UI_TYPE, type AgentEnvelope } from '../protocol';

type FrameEntry = {
  /** performance.now() 到达时刻 */
  t: number;
  /** 墙上时间，便于和服务端日志对齐 */
  wall: number;
  kind: string;
  type: string;
  seq?: number;
  eventID?: string;
  bytes: number;
  /** 同步处理（解析后的路由 + dispatch）耗时 */
  syncMs?: number;
  /** 到达后到下一次绘制的间隔：这一帧被主线程压了多久 */
  paintMs?: number;
};

type LongTaskEntry = { t: number; ms: number; name: string };
type UIWaitEntry = { id: string; t: number; waitMs: number };

const FRAME_LIMIT = 3000;
const LONG_TASK_LIMIT = 200;

const frames: FrameEntry[] = [];
const longTasks: LongTaskEntry[] = [];
const uiWaits: UIWaitEntry[] = [];

/** 等待中的帧：rAF 触发时统一盖「绘制时刻」，一帧一个回调太贵 */
let waiting: FrameEntry[] = [];
let paintScheduled = false;
/** ui.request 的到达时刻，回执时算浏览器答了多久（服务端这段时间在同步等） */
const uiArrival = new Map<string, number>();

/** token 级增量帧：与后端 protocol.IsDelta 一致，只有这两类会被发送队列丢弃 */
const DELTA_TYPES = new Set<string>([AGENT_EVENT.messageDelta, AGENT_EVENT.reasoningDelta]);

function push<T>(list: T[], item: T, limit: number) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function startLongTaskWatch() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const owner = (entry as PerformanceEntry & { attribution?: { name: string }[] }).attribution?.[0];
        push(longTasks, { t: Math.round(entry.startTime), ms: Math.round(entry.duration), name: owner?.name ?? '' }, LONG_TASK_LIMIT);
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // 浏览器不支持 longtask：其余打点照常
  }
}

function watchPaint(entry: FrameEntry) {
  waiting.push(entry);
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(() => {
    const at = performance.now();
    paintScheduled = false;
    const list = waiting;
    waiting = [];
    list.forEach((item) => {
      item.paintMs = Math.round(at - item.t);
    });
  });
}

/** 记录一条下行帧，并把真正的处理动作包进来测量同步耗时 */
export function traceIncoming(envelope: AgentEnvelope, bytes: number, handle: () => void): void {
  if (frames.length === 0) startLongTaskWatch();

  const entry: FrameEntry = {
    t: Math.round(performance.now()),
    wall: Date.now(),
    kind: envelope.kind,
    type: (envelope.data as { event?: string } | undefined)?.event || envelope.type,
    seq: envelope.seq,
    eventID: envelope.eventID,
    bytes,
  };
  push(frames, entry, FRAME_LIMIT);
  if (envelope.kind === KIND.ui && envelope.type === UI_TYPE.request) uiArrival.set(envelope.id, entry.t);

  const start = performance.now();
  handle();
  entry.syncMs = Math.round(performance.now() - start);
  watchPaint(entry);
}

/** 记录一条上行回执；ui.response 特别关心——服务端正卡在同步等待里 */
export function traceUplink(envelope: AgentEnvelope): void {
  if (envelope.kind !== KIND.client || envelope.type !== UI_TYPE.response) return;
  const sentAt = envelope.replyTo ? uiArrival.get(envelope.replyTo) : undefined;
  if (!sentAt) return;
  if (envelope.replyTo) uiArrival.delete(envelope.replyTo);
  const waitMs = Math.round(performance.now() - sentAt);
  push(uiWaits, { id: envelope.replyTo ?? '', t: Math.round(performance.now()), waitMs }, 50);
  if (waitMs > 200) {
    console.info(`[agent] ui.request 浏览器答了 ${waitMs}ms（服务端这段时间在同步等，工具不会继续产出）`);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 控制台里直接调用的汇总 */
export function summarize() {
  const deltas = frames.filter((frame) => DELTA_TYPES.has(frame.type));
  const paints = frames.map((frame) => frame.paintMs).filter((ms): ms is number => ms !== undefined);
  const gaps = deltas.slice(1).map((frame, index) => frame.t - deltas[index].t);
  const blocked = longTasks.reduce((sum, task) => sum + Math.max(0, task.ms - 50), 0);

  const report = {
    /** 下行帧总数，以及其中 token 级增量帧的数量 */
    frames: frames.length,
    deltaFrames: deltas.length,
    /** 增量帧到达的最大间隔：大 = 服务端发得慢或有停顿；小 = 服务端一直在发 */
    deltaMaxGapMs: gaps.length ? Math.max(...gaps) : 0,
    deltaMedianGapMs: median(gaps),
    /** 增量帧第一帧到最后一帧的跨度：服务端真正的产出窗口 */
    deltaSpanMs: deltas.length > 1 ? deltas[deltas.length - 1].t - deltas[0].t : 0,
    /** 到达 → 下一次绘制：浏览器把这一帧压了多久，积压的直接证据 */
    paintMedianMs: median(paints),
    paintMaxMs: paints.length ? Math.max(...paints) : 0,
    /** 单帧同步处理耗时（协议路由 + dispatch，不含 React 渲染） */
    syncMedianMs: median(frames.map((frame) => frame.syncMs ?? 0)),
    /** 主线程长任务（>50ms）：阻塞的来源 */
    longTasks: longTasks.length,
    blockingMs: blocked,
    /** 浏览器回答 ui.request 的耗时；服务端在同步等，工具期间不产出任何帧 */
    uiReplyMedianMs: median(uiWaits.map((item) => item.waitMs)),
    uiReplyMaxMs: uiWaits.length ? Math.max(...uiWaits.map((item) => item.waitMs)) : 0,
  };
  console.table(report);
  console.info('[agent] 明细：__AGENT_DIAG__.frames / .longTasks / .uiWaits');
  return report;
}

/** 清空调到的样本（新一轮提问前调一次，避免新旧混在一起） */
export function resetTrace() {
  frames.length = 0;
  longTasks.length = 0;
  uiWaits.length = 0;
  waiting = [];
  uiArrival.clear();
}

/** 挂到 window 供控制台查看；只在开发环境执行 */
export function installFrameTrace() {
  const target = window as unknown as Record<string, unknown>;
  target.__AGENT_DIAG__ = { frames, longTasks, uiWaits, summary: summarize, reset: resetTrace };
}
