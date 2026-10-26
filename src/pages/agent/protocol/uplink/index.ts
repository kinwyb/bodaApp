/**
 * 上行命令出口。
 *
 * 新增一条上行命令（比如审批回传）时：
 * 1. 在这里旁边加一个 `xxx.ts`，导出 `buildXxx(...)`；
 * 2. 在 `CLIENT_TYPE` 里登记 type；
 * 3. 传输层调用即可 —— 解析侧不用动。
 */

export type { ChatSendInput } from './chat-send';
export { buildChatSend } from './chat-send';
export type { ChatCancelInput } from './chat-cancel';
export { buildChatCancel } from './chat-cancel';
export type { SessionListInput } from './session-list';
export { buildSessionList } from './session-list';
export type { SessionHistoryInput } from './session-history';
export { buildSessionHistory } from './session-history';
export type { TurnReplayInput } from './turn-replay';
export { buildTurnReplay } from './turn-replay';
export { buildPing } from './ping';
