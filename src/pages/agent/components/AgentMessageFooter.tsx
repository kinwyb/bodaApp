/**
 * 一条助手消息下方的操作区：时间 + 复制（截断的历史轮再多一个「完整过程」）。
 *
 * 点赞 / 点踩 / 重新生成按需求去掉：这里只留真正用得上的动作。
 * props 全部是原值 + 稳定回调（onReplay 来自状态层的 useCallback），
 * 因此可以 memo：流式每帧都会重算气泡列表，历史气泡的这一块必须整棵跳过。
 */

import React, { useMemo } from 'react';
import { ProfileOutlined } from '@ant-design/icons';
import { Actions } from '@ant-design/x';
import dayjs from 'dayjs';

type AgentMessageFooterProps = {
  text: string;
  createdAt: number;
  /** 这一轮的过程被服务端截断 */
  truncated?: boolean;
  /** 轮次标识：有它才能拉未截断的完整过程（turn.replay） */
  turnId?: string;
  onReplay?: (turnId: string) => void;
};

export const AgentMessageFooter = React.memo(function AgentMessageFooter({
  text,
  createdAt,
  truncated,
  turnId,
  onReplay,
}: AgentMessageFooterProps) {
  const items = useMemo(
    () => [
      { key: 'copy', actionRender: () => <Actions.Copy text={text} /> },
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
    [text, truncated, turnId, onReplay],
  );

  return (
    <div className="agent-msg-footer">
      <span className="agent-msg-time">{dayjs(createdAt).format('HH:mm')}</span>
      <Actions items={items} variant="borderless" fadeIn />
    </div>
  );
});
