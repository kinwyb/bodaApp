/**
 * 会话状态机（纯 reducer，无副作用，方便单测与复用）。
 */

import type { AgentChatAction, AgentChatState } from './actions';
import { DEFAULT_LABEL, createConversation } from './actions';
import { contentFromFrames, groupFramesByReq, historyMessagesOf, isTruncatedContent } from './frames';
import { finishStreamingReply, joinSegments, mapStreamingReply, upsertSegment, withConversation } from './helpers';

export function chatReducer(state: AgentChatState, action: AgentChatAction): AgentChatState {
  switch (action.type) {
    case 'switch':
      return { ...state, activeKey: action.key };

    case 'create':
      return {
        conversations: [action.conversation, ...state.conversations],
        activeKey: action.conversation.key,
      };

    case 'rename':
      return withConversation(state, action.key, (conversation) => ({
        ...conversation,
        label: action.label.trim() || conversation.label,
      }));

    case 'remove': {
      const rest = state.conversations.filter((conversation) => conversation.key !== action.key);
      if (rest.length === state.conversations.length) return state;
      // 至少留一个会话，否则界面会没有可渲染的活动会话
      if (rest.length === 0) {
        const fallback = createConversation();
        return { conversations: [fallback], activeKey: fallback.key };
      }
      const activeKey = state.activeKey === action.key ? rest[0].key : state.activeKey;
      return { conversations: rest, activeKey };
    }

    case 'clear':
      return withConversation(state, action.key, (conversation) => ({
        ...conversation,
        messages: [],
        updatedAt: Date.now(),
      }));

    case 'rebindConversation': {
      const { fromKey, toKey } = action;
      if (fromKey === toKey) return state;
      return {
        activeKey: state.activeKey === fromKey ? toKey : state.activeKey,
        conversations: state.conversations.map((conversation) =>
          conversation.key === fromKey
            ? // historyLoaded 置回 false：新 chatID 的历史要重新拉一遍
              { ...conversation, key: toKey, historyLoaded: false, hasMore: false, oldestSeq: undefined }
            : conversation,
        ),
      };
    }

    case 'append': {
      const { conversationKey, messages, autoLabel } = action;
      return withConversation(state, conversationKey, (conversation) => ({
        ...conversation,
        messages: [...conversation.messages, ...messages],
        updatedAt: Date.now(),
        // 首次提问时用问题前 20 字当标题，省得用户再手动改名
        label:
          autoLabel && conversation.label === DEFAULT_LABEL ? autoLabel.slice(0, 20) : conversation.label,
      }));
    }

    case 'replyStart':
      return withConversation(state, action.conversationKey, (conversation) => {
        const hasStreaming = conversation.messages.some(
          (message) => message.role === 'assistant' && message.status === 'streaming',
        );
        if (hasStreaming) return conversation;
        // 极端情况：前端还没插入占位消息（例如重连后收到首帧），补一条
        return {
          ...conversation,
          messages: [
            ...conversation.messages,
            {
              key: action.messageKey,
              role: 'assistant',
              content: { text: '' },
              createdAt: Date.now(),
              status: 'streaming',
            },
          ],
          updatedAt: Date.now(),
        };
      });

    case 'appendText':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => {
          const textSegments = upsertSegment(
            content.textSegments,
            action.eventId,
            action.text,
            action.replace,
          );
          return { ...content, textSegments, text: joinSegments(textSegments) };
        }),
      );

    case 'appendReasoning':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => {
          const reasoningSegments = upsertSegment(
            content.reasoningSegments,
            action.eventId,
            action.text,
            action.replace,
          );
          return {
            ...content,
            reasoningSegments,
            reasoning: joinSegments(reasoningSegments),
          };
        }),
      );

    case 'upsertStep':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => {
          const steps = content.steps ?? [];
          const index = steps.findIndex((step) => step.key === action.step.key);
          const nextSteps =
            index < 0
              ? [...steps, action.step]
              : steps.map((step) => (step.key === action.step.key ? action.step : step));
          return { ...content, steps: nextSteps };
        }),
      );

    case 'setApproval':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => ({ ...content, approval: action.approval })),
      );

    case 'setMedia':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => ({ ...content, media: action.media })),
      );

    case 'setSources':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => ({ ...content, sources: action.sources })),
      );

    case 'historyStart':
      return withConversation(state, action.conversationKey, (conversation) => ({
        ...conversation,
        historyLoading: true,
      }));

    case 'history': {
      const { conversationKey, threads, frames, framesTruncated, mode } = action;
      return withConversation(state, conversationKey, (conversation) => {
        const turns = threads
          .flatMap((thread) => thread.turns ?? [])
          .slice()
          .sort((a, b) => a.seq - b.seq);
        const hasMore = threads.some((thread) => thread.hasMore);

        // 后端没有更多数据：保持本地内容不动，但要把「还有更早」关掉，
        // 否则「加载更早」按钮会一直挂在那里，点了没反应
        if (turns.length === 0) {
          return { ...conversation, historyLoaded: true, historyLoading: false, hasMore: false };
        }

        // 增量补发的游标：服务端按 turn 的 CreateTime 过滤
        const newestTurnAt = turns.reduce((max, turn) => Math.max(max, turn.createdAt || 0), 0);
        const lastTurnAt = Math.max(conversation.lastTurnAt ?? 0, newestTurnAt) || undefined;

        // 帧与轮次靠 reqID 关联：同轮的帧共享同一个 reqID
        const framesByReq = groupFramesByReq(frames);
        const incoming = turns.flatMap((turn) => historyMessagesOf(turn, framesByReq.get(turn.reqID)));
        if (mode === 'prepend') {
          return {
            ...conversation,
            messages: [...incoming, ...conversation.messages],
            historyLoaded: true,
            historyLoading: false,
            hasMore,
            oldestSeq: turns[0].seq,
            lastTurnAt,
            framesTruncated,
          };
        }
        if (mode === 'append') {
          // 增量补发：可能带回已有的轮次，按 key 去重后再接在后面
          const known = new Set(conversation.messages.map((message) => message.key));
          return {
            ...conversation,
            messages: [
              ...conversation.messages,
              ...incoming.filter((message) => !known.has(message.key)),
            ],
            historyLoaded: true,
            historyLoading: false,
            lastTurnAt,
            framesTruncated: conversation.framesTruncated || framesTruncated,
          };
        }
        // 首次打开：用服务端历史整体替换，但保留正在生成的那条（不能被历史抹掉）
        const streaming = conversation.messages.filter((message) => message.status === 'streaming');
        return {
          ...conversation,
          messages: [...incoming, ...streaming],
          historyLoaded: true,
          historyLoading: false,
          hasMore,
          oldestSeq: turns[0].seq,
          lastTurnAt,
          framesTruncated,
        };
      });
    }

    case 'replayTurn': {
      const { conversationKey, turnId, frames, truncated } = action;
      return withConversation(state, conversationKey, (conversation) => {
        const content = contentFromFrames(frames);
        if (!content.text && !content.steps?.length && !content.error) return conversation;

        return {
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.role === 'assistant' && message.turnId === turnId
              ? {
                  ...message,
                  content,
                  truncated: truncated || isTruncatedContent(content),
                }
              : message,
          ),
        };
      });
    }

    case 'finish':
      return withConversation(state, action.conversationKey, (conversation) =>
        finishStreamingReply(conversation, 'done'),
      );

    case 'stop':
      return withConversation(state, action.conversationKey, (conversation) =>
        finishStreamingReply(conversation, 'aborted'),
      );

    case 'fail':
      return withConversation(state, action.conversationKey, (conversation) =>
        finishStreamingReply(conversation, 'error', action.message),
      );

    case 'resetReply':
      return withConversation(state, action.conversationKey, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.key === action.messageKey
            ? { ...message, status: 'streaming', content: { text: '' } }
            : message,
        ),
        updatedAt: Date.now(),
      }));

    default:
      return state;
  }
}
