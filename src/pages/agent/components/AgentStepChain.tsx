/**
 * 工具调用链：把 Agent 的每一步摊开，流式过程中能看到 loading 闪烁。
 */

import React from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';
import type { AgentToolStep } from '../types';

export const AgentStepChain: React.FC<{ steps: AgentToolStep[] }> = ({ steps }) => {
  const items: ThoughtChainItemType[] = steps.map((step) => ({
    key: step.key,
    title: step.title,
    description: step.description,
    content: step.content,
    status: step.status,
    collapsible: Boolean(step.content),
    blink: step.status === 'loading',
    icon:
      step.status === 'loading' ? (
        <ThunderboltOutlined />
      ) : step.status === 'error' ? (
        <CloseCircleOutlined />
      ) : (
        <CheckCircleOutlined />
      ),
  }));

  return <ThoughtChain className="agent-thought-chain" items={items} />;
};
