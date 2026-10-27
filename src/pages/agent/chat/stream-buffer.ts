/**
 * 流式文字合并器（纯逻辑，无 React 依赖）。
 *
 * 为什么需要它：WebSocket 是异步推送，一条帧就是一个独立任务，
 * 后端 token 帧可以一秒上百条，而每条都要走一遍
 * 「reducer 复制 → 解析整段 Markdown → 重排 → 自动滚动到底」。
 * 渲染成本高于帧间隔时，帧就在主线程外排队：服务端早就发完了，界面还在慢慢追。
 *
 * 做法是**只推迟、不拼接**：帧按原顺序排队，攒到下一帧（rAF）一次性 dispatch。
 * React 18/19 会把同一个任务里的多次 dispatch 合成一次渲染，
 * 于是「上百次渲染」变成「每帧一次渲染」，而 reducer 收到的 action 序列与逐帧直发**完全相同**。
 *
 * 为什么不把增量拼成一条再落地：reducer 的 mergeText 靠「已有文本的尾部」判断重复帧与累积快照，
 * 拼接会改变它的判断依据（实测会把重复帧少去重一次，多写出一个字）。
 * 唯一安全的丢弃是同一批内被全量快照作废的旧帧：delta=false 的语义就是「整段替换」，
 * 它前面那些本批还没落地过的增量，在逐帧路径里也一样会被它覆盖掉。
 */

import type { AgentStreamEvent } from '../protocol';
import type { AgentChatAction } from './actions';

type TextAction = Extract<AgentChatAction, { type: 'appendText' | 'appendReasoning' }>;

/** 页签不可见时 rAF 不执行，降级成定时刷新，避免后台生成的内容一直不落屏 */
const HIDDEN_FLUSH_MS = 250;

export type StreamBuffer = {
  /**
   * 收一条语义事件。
   * 返回 true 表示已进缓冲（调用方不要再立即落地）；
   * 返回 false 表示这不是文字增量，调用方应先 flush() 再按原顺序处理。
   */
  push: (event: AgentStreamEvent) => boolean;
  /** 立刻把缓冲落成 action：非文字事件、一轮结束前都要先 flush，保证与文字帧的先后顺序 */
  flush: () => void;
  /** 丢弃缓冲并取消定时（卸载 / 断开连接时） */
  cancel: () => void;
};

/** 队列里的一项：action + 它属于哪个「会话 + 片段」（用于识别被快照作废的旧帧） */
type QueueItem = { key: string; action: TextAction };

export function createStreamBuffer(emit: (action: TextAction) => void): StreamBuffer {
  /** 待落地队列，顺序 = 到达顺序；Map 只用来快速找出同片段的旧帧下标 */
  const queue: (QueueItem | null)[] = [];
  const slotIndex = new Map<string, number[]>();
  /** 没有 eventID 的帧不共享片段身份，各自独立排队 */
  let anonymousSeed = 0;
  let rafId: number | undefined;
  let timerId: number | undefined;

  const unschedule = () => {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    if (timerId !== undefined) {
      clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const flush = () => {
    unschedule();
    if (queue.length === 0) return;
    // 被快照作废的帧留的是空位（不能 splice：slotIndex 记的是下标）
    const pending = queue.splice(0, queue.length).filter((item): item is QueueItem => item !== null);
    slotIndex.clear();
    // 同一个任务里多次 dispatch：React 自动批处理成一次渲染
    pending.forEach((item) => emit(item.action));
  };

  const schedule = () => {
    if (rafId !== undefined || timerId !== undefined) return;
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        flush();
      });
      return;
    }
    timerId = window.setTimeout(() => {
      timerId = undefined;
      flush();
    }, HIDDEN_FLUSH_MS);
  };

  return {
    push(event) {
      if (event.type !== 'text' && event.type !== 'reasoning') return false;

      const action: TextAction =
        event.type === 'text'
          ? {
              type: 'appendText',
              conversationKey: event.conversationId,
              text: event.text,
              replace: event.replace,
              eventId: event.eventId,
              done: event.done,
            }
          : {
              type: 'appendReasoning',
              conversationKey: event.conversationId,
              text: event.text,
              replace: event.replace,
              eventId: event.eventId,
              done: event.done,
            };

      // 无 eventID：reducer 只能按「同类型最后一段」定位，不能与任何帧互相作废
      const key = event.eventId
        ? `${event.conversationId}|${action.type}|${event.eventId}`
        : `#${(anonymousSeed += 1)}`;

      const listed = slotIndex.get(key);
      if (event.replace && event.text && listed?.length) {
        // 全量快照到来说明前面那些增量都会被它覆盖，直接从队列里剔除
        listed.forEach((index) => {
          queue[index] = null;
        });
        slotIndex.set(key, []);
      }

      queue.push({ key, action });
      if (listed) listed.push(queue.length - 1);
      else slotIndex.set(key, [queue.length - 1]);

      schedule();
      return true;
    },

    flush,

    cancel() {
      unschedule();
      queue.length = 0;
      slotIndex.clear();
    },
  };
}
