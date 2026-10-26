/**
 * Agent 对话界面出口。
 *
 * 目录分层：
 *   protocol/   与后端 ws 协议的对接（信封、载荷、上行命令、下行事件）
 *   transport/  连接实现（websocket / mock），把协议翻成语义事件
 *   chat/       会话状态机与 hook（业务逻辑，不 import 任何 antd/x）
 *   components/ 各块界面（只关心 props）
 *   mock/       演示数据（脚本、历史、初始会话）
 */

export { default } from './AgentChatPage';
export { default as AgentChatPage } from './AgentChatPage';
export type { AgentChatApi } from './chat/use-agent-chat';
