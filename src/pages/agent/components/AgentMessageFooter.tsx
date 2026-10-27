/**
 * 一条助手消息下方的操作区：时间 + 复制 / 点赞 / 重新生成。
 *
 * props 全部是原值 + 稳定回调（onRetry / onReplay 来自状态层的 useCallback），
 * 因此可以 memo：流式每帧都会重算气泡列表，历史气泡的这一块必须整棵跳过。
 */

import React, { useMemo, useState } from 'react';
import { ProfileOutlined, ReloadOutlined } from '@ant-design/icons';
import { Actions } from '@ant-design/x';
import dayjs from 'dayjs';

type AgentMessageFooterProps = {
  text: string;
  createdAt: number;
  /** 本条消息标识：点击时回传给 onRetry，避免每次渲染新建闭包 */
  messageKey: string;
  onRetry: (messageKey: string) => void;
  /** 这一轮的过程被服务端截断 */
  truncated?: boolean;
  /** 轮次标识：有它才能拉未截断的完整过程（turn.replay） */
  turnId?: string;
  onReplay?: (turnId: string) => void;
};

export const AgentMessageFooter = React.memo(function AgentMessageFooter({
  text,
  createdAt,
  messageKey,
  onRetry,
  truncated,
  turnId,
  onReplay,
}: AgentMessageFooterProps) {
  const [feedback, setFeedback] = useState<'like' | 'dislike' | 'default'>('default');

  const items = useMemo(
    () => [
      { key: 'copy', actionRender: () => <Actions.Copy text={text} /> },
      {
        key: 'feedback',
        actionRender: () => <Actions.Feedback value={feedback} onChange={setFeedback} />,
      },
      {
        key: 'retry',
        icon: <ReloadOutlined />,
        label: '重新生成',
        onItemClick: () => onRetry(messageKey),
      },
      // 只有被截断的历史轮次才需要，实时回答不会走到这里
      ...(truncated && turnId && onReplay
        ? [
            {
              key: 'replay',
              icon: <ProfileOutlined />,
              label: '完整过程',
              onItemClick: () => onReplay(turnId),
            },
          ]
        : []),
    ],
    [text, feedback, onRetry, messageKey, truncated, turnId, onReplay],
  );

  return (
    <div className="agent-msg-footer">
      <span className="agent-msg-time">{dayjs(createdAt).format('HH:mm')}</span>
      <Actions items={items} variant="borderless" fadeIn />
    </div>
  );
});
