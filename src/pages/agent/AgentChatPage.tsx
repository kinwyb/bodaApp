/**
 * Agent 对话页面：只负责把各层拼起来。
 *
 *   chat/use-agent-chat   → 会话状态与流式更新（业务逻辑）
 *   transport/            → ws / 演示实现（协议对接）
 *   components/           → 各块界面
 *
 * 本文件按项目约定只导出组件 —— 内部子组件不导出，避免破坏 Vite Fast Refresh。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Avatar, Button, Input, Tag } from 'antd';
import { Bubble } from '@ant-design/x';
import type { BubbleItemType } from '@ant-design/x';
import { PaperClipOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import type { AgentAssistantContent } from './types';
import { assistantContentOf } from './types';
import { useAgentChat } from './chat/use-agent-chat';
import { AgentAnswer } from './components/AgentAnswer';
import { AgentComposer } from './components/AgentComposer';
import { AgentHeader } from './components/AgentHeader';
import { AgentMessageFooter } from './components/AgentMessageFooter';
import { AgentSettingsDrawer } from './components/AgentSettingsDrawer';
import { AgentSidebar } from './components/AgentSidebar';
import { AgentWelcome } from './components/AgentWelcome';
import './agent.css';

const ASSISTANT_AVATAR = (
  <Avatar className="agent-avatar agent-avatar-ai" icon={<RobotOutlined />} size={32} />
);
const USER_AVATAR = <Avatar className="agent-avatar agent-avatar-user" icon={<UserOutlined />} size={32} />;

/**
 * 气泡角色配置：放在模块级，保证引用稳定
 * （每次渲染重建会重置打字动画）。
 */
const BUBBLE_ROLES = {
  assistant: {
    placement: 'start' as const,
    variant: 'borderless' as const,
    typing: false as const,
    avatar: ASSISTANT_AVATAR,
    /*
     * 宽度：内容少时跟着内容走，内容多（表格/长文）最多到对话区 80%。
     * x 的结构是 root(flex) > body(按内容收缩) > content，
     * 必须先把 body 撑开（flex:1），80% 这个上限才有参照；
     * body 是 column flex，默认 stretch 会把 content 拉满，所以 content 要 alignSelf:flex-start。
     */
    styles: {
      root: { width: '100%' },
      body: { flex: 1, minWidth: 0 },
      content: { width: 'fit-content', maxWidth: '80%', alignSelf: 'flex-start' },
    },
    contentRender: (content: unknown, info: { status?: string }) => (
      <AgentAnswer content={content as AgentAssistantContent} streaming={info.status === 'loading'} />
    ),
  },
  user: {
    placement: 'end' as const,
    // 白底上用 filled（浅灰填充），和助手那块灰色内容卡区分得开
    variant: 'filled' as const,
    typing: false as const,
    avatar: USER_AVATAR,
    contentRender: (content: unknown) => <div className="agent-user-text">{String(content)}</div>,
  },
};

const AgentChatPage: React.FC = () => {
  const chat = useAgentChat();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();

  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { messages } = chat.activeConversation;
  const isEmpty = messages.length === 0;
  /** 抽出来单独持有：下面的 useMemo 只依赖它，不必依赖整个 chat 对象 */
  const { retry, clearError, replayTurn } = chat;

  // 连接级错误（投不到具体会话的那种）用全局提示，避免悄悄失败
  useEffect(() => {
    if (!chat.lastError) return;
    message.error(chat.lastError);
    clearError();
  }, [chat.lastError, clearError, message]);

  /** 组装 Bubble.List 的数据，content / status 都由消息状态派生 */
  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      messages.map((item) => {
        const streaming = item.status === 'streaming';
        const answer = item.role === 'assistant' ? assistantContentOf(item) : null;

        const base: BubbleItemType = {
          key: item.key,
          role: item.role,
          content: answer ?? item.content,
          status: streaming ? 'loading' : item.status === 'error' ? 'error' : 'success',
          streaming,
          footerPlacement: 'outer-start',
        };

        // 用户消息带上附件时，放在气泡上方
        if (item.role === 'user' && item.attachments && item.attachments.length > 0) {
          base.header = (
            <div className="agent-user-files">
              {item.attachments.map((file) => (
                <Tag key={file.uid} icon={<PaperClipOutlined />} className="agent-file-tag">
                  {file.name}
                </Tag>
              ))}
            </div>
          );
        }

        // 等待首个 chunk 时给骨架，避免「一个空气泡」
        if (answer && streaming && !answer.text && !(answer.steps?.length)) {
          base.loading = true;
        }

        if (answer && !streaming) {
          const turnId = item.turnId;
          base.footer = (
            <AgentMessageFooter
              text={answer.text}
              createdAt={item.createdAt}
              truncated={item.truncated}
              onReplay={turnId ? () => replayTurn(turnId) : undefined}
              onRetry={() => retry(item.key)}
            />
          );
        }

        return base;
      }),
    [messages, retry, replayTurn],
  );

  const openRename = useCallback(
    (conversationKey: string) => {
      const target = chat.conversations.find((conversation) => conversation.key === conversationKey);
      if (!target) return;

      let nextLabel = target.label;
      modal.confirm({
        title: '重命名会话',
        icon: null,
        content: (
          <Input
            defaultValue={target.label}
            maxLength={30}
            placeholder="会话名称"
            onChange={(event) => {
              nextLabel = event.target.value;
            }}
          />
        ),
        okText: '保存',
        cancelText: '取消',
        onOk: () => {
          const label = nextLabel.trim();
          if (label) chat.renameConversation(conversationKey, label);
        },
      });
    },
    [chat, modal],
  );

  const confirmDelete = useCallback(
    (conversationKey: string) => {
      modal.confirm({
        title: '删除会话',
        content: '会话中的消息会一起删除，且不可恢复。',
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => chat.deleteConversation(conversationKey),
      });
    },
    [chat, modal],
  );

  const confirmClear = useCallback(() => {
    if (isEmpty) {
      message.info('当前会话还没有消息');
      return;
    }
    modal.confirm({
      title: '清空当前对话',
      content: '只清空消息，会话本身会保留。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => chat.clearMessages(),
    });
  }, [chat, isEmpty, message, modal]);

  return (
    <div className="agent-page">
      <AgentSidebar
        conversations={chat.conversations}
        activeKey={chat.activeKey}
        collapsed={collapsed}
        userId={chat.userId}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onSwitch={chat.switchConversation}
        onCreate={chat.createConversation}
        onRename={openRename}
        onDelete={confirmDelete}
        onOpenLegacy={() => navigate('/app')}
      />

      <section className="agent-main">
        <AgentHeader
          title={chat.activeConversation.label}
          messageCount={messages.length}
          agent={chat.agent}
          agents={chat.agents}
          onAgentChange={chat.setAgent}
          connection={chat.connection}
          mode={chat.mode}
          latency={chat.latency}
          collapsed={collapsed}
          onExpandSidebar={() => setCollapsed(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onClear={confirmClear}
          onCreate={chat.createConversation}
          onReconnect={chat.reconnect}
        />

        <div className="agent-body">
          <div className="agent-chat-surface">
            {chat.hasMore || chat.historyLoading ? (
              <div className="agent-history-bar">
                <Button size="small" type="text" loading={chat.historyLoading} onClick={chat.loadMore}>
                  加载更早的消息
                </Button>
              </div>
            ) : null}

            <div className="agent-messages">
              {isEmpty ? (
                <AgentWelcome onPick={(text) => chat.send(text)} />
              ) : (
                <Bubble.List
                  className="agent-bubble-list"
                  items={bubbleItems}
                  role={BUBBLE_ROLES}
                  autoScroll
                  style={{ height: '100%' }}
                />
              )}
            </div>
          </div>
        </div>

        <AgentComposer
          streaming={chat.streaming}
          mode={chat.mode}
          connection={chat.connection}
          latency={chat.latency}
          onSend={chat.send}
          onAbort={chat.abort}
        />
      </section>

      <AgentSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        agent={chat.agent}
        agents={chat.agents}
        onAgentChange={chat.setAgent}
      />
    </div>
  );
};

export default AgentChatPage;
