/**
 * 会话状态机（纯 reducer，无副作用，方便单测与复用）。
 */

import type { AgentChatAction, AgentChatState } from './actions';
import type { AgentConversation } from '../types';
import { timelineOf } from '../types';
import { DEFAULT_LABEL, createConversation } from './actions';
import { contentFromFrames, groupFramesByReq, historyMessagesOf, isTruncatedContent } from './frames';
import {
  appendTimelineText,
  finishStreamingReply,
  mapStreamingReply,
  upsertTimelineApproval,
  upsertTimelineError,
  upsertTimelineTool,
  withConversation,
  withTimeline,
} from './helpers';

/** 还没落库的会话（本地新建、或刚发出第一轮还没拿到 sessionID） */
function isDraft(conversation: AgentConversation): boolean {
  return !conversation.threadId;
}

export function chatReducer(state: AgentChatState, action: AgentChatAction): AgentChatState {
  switch (action.type) {
    case 'switch':
      return { ...state, activeKey: action.key };

    case 'create': {
      // 新建时清掉别的「还没落库、也没说过话」的草稿，避免列表里堆一串「新对话」
      const kept = state.conversations.filter(
        (conversation) => !isDraft(conversation) || conversation.messages.length > 0,
      );
      return { conversations: [action.conversation, ...kept], activeKey: action.conversation.key };
    }

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

    case 'bind': {
      const { conversationKey, sessionId, threadId } = action;
      return withConversation(state, conversationKey, (conversation) => {
        const nextSessionId = sessionId || conversation.sessionId;
        const nextThreadId = threadId || conversation.threadId;
        if (nextSessionId === conversation.sessionId && nextThreadId === conversation.threadId) {
          return conversation;
        }
        return { ...conversation, sessionId: nextSessionId, threadId: nextThreadId };
      });
    }

    /*
     * 合并服务端会话列表。
     *
     * 三种情况要区分开，否则列表会出现重复或丢会话：
     * 1. 本地已有的服务端会话（有 threadId）→ 按 threadId 对齐，只更新标题/预览/时间；
     * 2. 本地草稿刚聊过（有 sessionId、没有 threadId）→ 靠 sessionId 认领列表里的那一项
     *    （同会话可能有多个 thread，列表按 lastUpdate 倒序，第一条就是刚产生的那一轮）；
     * 3. 认领不上的草稿 = 还没落库的新对话 → 留在最前面，进入工作台默认就是它。
     */
    case 'sessions': {
      const { items, mode = 'replace' } = action;

      const drafts = state.conversations.filter(isDraft);
      const knownServer = state.conversations.filter((conversation) => !isDraft(conversation));
      const knownByThread = new Map(knownServer.map((item) => [item.threadId as string, item]));

      const draftBySession = new Map<string, AgentConversation>();
      drafts.forEach((draft) => {
        if (draft.sessionId && !draftBySession.has(draft.sessionId)) {
          draftBySession.set(draft.sessionId, draft);
        }
      });
      const claimed = new Set<string>();

      const fromServer = items.map((item) => {
        let existing = knownByThread.get(item.threadId);
        if (!existing && item.sessionId) {
          const draft = draftBySession.get(item.sessionId);
          if (draft && !claimed.has(draft.key)) {
            existing = draft;
            claimed.add(draft.key);
          }
        }
        const key = existing?.key ?? item.threadId;
        const base: AgentConversation = existing ?? {
          key,
          label: DEFAULT_LABEL,
          group: '',
          updatedAt: 0,
          messages: [],
        };
        return {
          ...base,
          key,
          threadId: item.threadId,
          sessionId: item.sessionId || base.sessionId,
          label: item.title || base.label,
          preview: item.preview || undefined,
          turns: item.turns,
          updatedAt: Math.max(base.updatedAt, item.updatedAt),
        };
      });

      // 翻页（append）时保留上一页拿到的服务端条目；replace 以本次结果为准
      const fromServerKeys = new Set(fromServer.map((item) => item.key));
      const previous =
        mode === 'append' ? knownServer.filter((item) => !fromServerKeys.has(item.key)) : [];
      const leftoverDrafts = drafts.filter((draft) => !claimed.has(draft.key));

      const merged = [...leftoverDrafts, ...fromServer, ...previous];
      if (merged.length === 0) return state;
      const activeKey = merged.some((item) => item.key === state.activeKey)
        ? state.activeKey
        : merged[0].key;
      return { conversations: merged, activeKey };
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
              content: { text: '', timeline: [] },
              createdAt: Date.now(),
              status: 'streaming',
            },
          ],
          updatedAt: Date.now(),
        };
      });

    case 'appendText':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) =>
          withTimeline(
            content,
            appendTimelineText(
              timelineOf(content),
              'text',
              action.eventId,
              action.text,
              action.replace,
              action.done,
            ),
          ),
        ),
      );

    case 'appendReasoning':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) =>
          withTimeline(
            content,
            appendTimelineText(
              timelineOf(content),
              'reasoning',
              action.eventId,
              action.text,
              action.replace,
              action.done,
            ),
          ),
        ),
      );

    case 'upsertStep':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) =>
          withTimeline(content, upsertTimelineTool(timelineOf(content), action.step)),
        ),
      );

    case 'setApproval':
      return withConversation(state, action.conversationKey, (conversation) =>
        mapStreamingReply(conversation, (content) => {
          if (!action.approval) return content;
          return {
            ...withTimeline(content, upsertTimelineApproval(timelineOf(content), action.approval)),
            // 保留汇总字段：历史预览也读它
            approval: action.approval,
          };
        }),
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
      return withConversation(state, action.conversationKey, (conversation) => {
        // 错误也进时间线，位置就是它发生的地方（不总是排最后）
        const withError = mapStreamingReply(conversation, (content) => ({
          ...withTimeline(content, upsertTimelineError(timelineOf(content), action.message)),
          error: action.message,
        }));
        return finishStreamingReply(withError, 'error', action.message);
      });

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
