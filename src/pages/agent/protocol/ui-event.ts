/**
 * 页面 → agent 的界面事件批次。
 *
 * 事件对模型而言仍是普通用户输入；这个格式只负责把一批页面变化压缩成
 * 可被实时消息、历史回放和业务页面共同识别的稳定文本块。
 */

export type UIEventNotice = {
  /** 事件产生时间（毫秒） */
  ts: number;
  /** 产生事件的页面 */
  view: string;
  /** 稳定事件 ID，例如 selection.change */
  event: string;
  payload?: Record<string, unknown>;
};

export type UIEventBatch = {
  v: 1;
  events: UIEventNotice[];
};

const OPEN = '<ui_events>';
const CLOSE = '</ui_events>';

/** 序列化事件批次；把 JSON 中的尖括号转义，避免 payload 文本提前闭合标记 */
export function formatUIEventBatch(events: UIEventNotice[]): string {
  const batch: UIEventBatch = { v: 1, events };
  const json = JSON.stringify(batch).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `${OPEN}${json}${CLOSE}`;
}

/** 事件批次与用户正文拼成同一条 chat.send 内容 */
export function composeUIEventMessage(events: UIEventNotice[], userText = ''): string {
  if (events.length === 0) return userText;
  const batch = formatUIEventBatch(events);
  return userText ? `${batch}\n${userText}` : batch;
}

/**
 * 解析内容开头的事件批次。
 *
 * 返回 userText 是事件块之后的真实用户正文；纯事件消息的 userText 为空。
 * 格式不完整时返回 null，调用方按普通用户消息处理。
 */
export function parseUIEventMessage(
  content: string,
): { events: UIEventNotice[]; userText: string } | null {
  const text = content.trimStart();
  if (!text.startsWith(OPEN)) return null;
  const close = text.indexOf(CLOSE, OPEN.length);
  if (close < 0) return null;

  try {
    const raw = JSON.parse(text.slice(OPEN.length, close)) as UIEventBatch;
    if (raw?.v !== 1 || !Array.isArray(raw.events) || raw.events.length === 0) return null;
    const events = raw.events.filter(
      (item): item is UIEventNotice =>
        Boolean(item) &&
        typeof item.ts === 'number' &&
        typeof item.view === 'string' &&
        typeof item.event === 'string',
    );
    if (events.length === 0) return null;
    return { events, userText: text.slice(close + CLOSE.length).trim() };
  } catch {
    return null;
  }
}

/** 历史标题、用户气泡等只需要真实用户正文 */
export function userTextOf(content: string): string {
  return parseUIEventMessage(content)?.userText ?? content;
}
