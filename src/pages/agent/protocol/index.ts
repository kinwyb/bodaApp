/**
 * 协议层出口：信封、载荷、语义事件、上下行映射。
 *
 * 与后端的对应关系：
 * - envelope.ts       → protocol/envelope.go
 * - payloads.ts       → protocol/payload.go
 * - uplink/*.ts       → command/*.go（一条上行命令一个文件）
 * - downlink/*.ts     → bridge/*.go（一类下行事件一个文件）
 */

export type { AgentEnvelope } from './envelope';
export {
  AGENT_EVENT,
  CLIENT_TYPE,
  ERROR_CODE,
  KIND,
  PROTOCOL_VERSION,
  SYSTEM_TYPE,
  UI_TYPE,
  clip,
  conversationIdOf,
  newEnvelope,
  uid,
} from './envelope';

export { buildUIResponse, parseUIRequest, UI_SNAPSHOT_VERSION } from './ui';
export type {
  UIAction,
  UIActionParam,
  UIColumn,
  UIDataSummary,
  UIField,
  UIFieldType,
  UIForm,
  UIGuide,
  UINavItem,
  UIRequestOp,
  UIRequestPayload,
  UIResponsePayload,
  UISelection,
  UISnapshot,
  UISnapshotData,
} from './ui';

export type {
  AckData,
  AgentEventData,
  AgentToolCall,
  ChatCancelData,
  ChatSendData,
  ErrorBody,
  FileErrorData,
  FileInfoData,
  FileListData,
  HelloData,
  PongData,
  SessionHistoryData,
  SessionListData,
  SessionListItem,
  SessionListResult,
  SessionHistoryResult,
  TurnReplayData,
  TurnReplayResult,
} from './payloads';

export type { AgentEventHandler, AgentStreamEvent } from './events';

export * from './uplink';
export {
  mapAgentEnvelope,
  mapEnvelopeAttachments,
  parseAck,
  parseError,
  parseHello,
  parsePong,
  parseSessionList,
  readSources,
  toHistoryEvent,
  toReplayEvent,
  toToolStep,
} from './downlink';
export type { AgentSessionPage, HelloInfo, HistoryMode } from './downlink';
