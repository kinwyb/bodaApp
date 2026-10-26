/**
 * 一条助手消息下方的操作区：时间 + 复制 / 点赞 / 重新生成。
 */

import React, { useMemo, useState } from 'react';
import { ProfileOutlined, ReloadOutlined } from '@ant-design/icons';
import { Actions } from '@ant-design/x';
import dayjs from 'dayjs';

export const AgentMessageFooter: React.FC<{
  text: string;
  createdAt: number;
  onRetry: () => void;
  /** 这一轮的过程被服务端截断 */
  truncated?: boolean;
  /** 拉取未截断的完整过程（turn.replay） */
  onReplay?: () => void;
}> = ({ text, createdAt, onRetry, truncated, onReplay }) => {
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
        onItemClick: onRetry,
      },
      // 只有被截断的历史轮次才需要，实时回答不会走到这里
      ...(truncated && onReplay
        ? [
            {
              key: 'replay',
              icon: <ProfileOutlined />,
              label: '完整过程',
              onItemClick: onReplay,
            },
          ]
        : []),
    ],
    [text, feedback, onRetry, truncated, onReplay],
  );

  return (
    <div className="agent-msg-footer">
      <span className="agent-msg-time">{dayjs(createdAt).format('HH:mm')}</span>
      <Actions items={items} variant="borderless" fadeIn />
    </div>
  );
};
