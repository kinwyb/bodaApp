/**
 * 会话管理面板：点顶栏的「对话记录」按钮弹出来 —— 上面新建对话，下面是历史会话。
 *
 * 历史来自服务端 `session.list`（一条对应一个 thread），打开浮层时刷新一次。
 * 本地新建的对话是草稿，排在列表最前面；还没落库（没有 threadID）时不会出现在服务端列表里。
 *
 * 本文件按项目约定只导出组件。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Empty, Popover, Tooltip } from 'antd';
import { LoadingOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { AgentConversation } from '../types';

/** 列表里的时间：今天只给时分，昨天给「昨天」，更早给日期（浮层只有 264px 宽） */
function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const time = dayjs(timestamp);
  if (!time.isValid()) return '';
  const now = dayjs();
  if (time.isSame(now, 'day')) return time.format('HH:mm');
  if (time.isSame(now.subtract(1, 'day'), 'day')) return '昨天';
  if (time.isSame(now, 'year')) return time.format('MM-DD');
  return time.format('YYYY-MM-DD');
}

export const AgentConversationPanel: React.FC<{
  conversations: AgentConversation[];
  activeKey: string;
  /** 会话列表加载中 */
  loading: boolean;
  /** 服务端还有更早的对话 */
  hasMore: boolean;
  /** 打开 / 关闭浮层（打开时外层去刷新列表） */
  onOpenChange?: (open: boolean) => void;
  onSwitch: (key: string) => void;
  onCreate: () => void;
  onLoadMore: () => void;
}> = ({
  conversations,
  activeKey,
  loading,
  hasMore,
  onOpenChange,
  onSwitch,
  onCreate,
  onLoadMore,
}) => {
  const [open, setOpen] = useState(false);

  /** 打开时刷新一次（别的端可能刚聊过）；关闭时不请求，避免每次点叉都打一次接口 */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const handleSwitch = useCallback(
    (key: string) => {
      if (key !== activeKey) onSwitch(key);
      // 选完就收起来：留着面板挡住对话没有意义
      handleOpenChange(false);
    },
    [activeKey, handleOpenChange, onSwitch],
  );

  const handleCreate = useCallback(() => {
    onCreate();
    handleOpenChange(false);
  }, [handleOpenChange, onCreate]);

  const items = useMemo(
    () => conversations.map((conversation) => ({ conversation, time: formatTime(conversation.updatedAt) })),
    [conversations],
  );

  const content = (
    <div className="agent-conv-panel">
      <Button block className="agent-conv-new" icon={<PlusOutlined />} onClick={handleCreate}>
        新建对话
      </Button>

      <div className="agent-conv-list">
        {items.length === 0 ? (
          <Empty className="agent-conv-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有会话" />
        ) : (
          items.map(({ conversation, time }) => (
            <div
              key={conversation.key}
              className={`agent-conv-item${
                conversation.key === activeKey ? ' agent-conv-item-active' : ''
              }`}
              onClick={() => handleSwitch(conversation.key)}
            >
              <MessageOutlined className="agent-conv-icon" />
              <div className="agent-conv-body">
                <div className="agent-conv-line">
                  <span className="agent-conv-label" title={conversation.label}>
                    {conversation.label}
                  </span>
                  <span className="agent-conv-time">{time}</span>
                </div>
                {/* 服务端给的末轮回答摘要（80 字），一眼能认出是哪次对话 */}
                {conversation.preview ? (
                  <div className="agent-conv-preview">{conversation.preview}</div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="agent-conv-footer">
        {loading ? (
          <span className="agent-conv-tip">
            <LoadingOutlined /> 加载中
          </span>
        ) : hasMore ? (
          <Button type="link" size="small" className="agent-conv-loadmore" onClick={onLoadMore}>
            加载更早的对话
          </Button>
        ) : (
          <span className="agent-conv-tip">共 {items.length} 个对话</span>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      content={content}
    >
      {/* 用「对话」图标而不是历史记录的回旋箭头：后者和断线重连的图标几乎一样 */}
      <Tooltip title="对话记录">
        <Button type="text" icon={<MessageOutlined />} aria-label="对话记录" />
      </Tooltip>
    </Popover>
  );
};
