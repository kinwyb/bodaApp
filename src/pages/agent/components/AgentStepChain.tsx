/**
 * 工具调用链：把 Agent 的每一步摊开，流式过程中能看到 loading 闪烁。
 *
 * 每一步默认**只显示工具名**：参数与输出都收进可折叠内容里，
 * 不加干预的话一屏全是 JSON 参数，正文反而被挤没了。
 */

import React from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';
import type { AgentToolStep } from '../types';

/** 展开后看到的东西：参数摘要（后端已截断）与工具输出 */
const StepDetail: React.FC<{ step: AgentToolStep }> = ({ step }) => {
  if (!step.description && !step.content) return null;

  return (
    <div className="agent-step-detail">
      {step.description ? (
        <div className="agent-step-section">
          <div className="agent-step-label">参数</div>
          <div className="agent-step-code">{step.description}</div>
        </div>
      ) : null}
      {step.content ? (
        <div className="agent-step-section">
          <div className="agent-step-label">输出</div>
          <div className="agent-step-code">{step.content}</div>
        </div>
      ) : null}
    </div>
  );
};

export const AgentStepChain: React.FC<{ steps: AgentToolStep[] }> = ({ steps }) => {
  const items: ThoughtChainItemType[] = steps.map((step) => {
    const hasDetail = Boolean(step.description || step.content);
    return {
      key: step.key,
      title: step.title,
      status: step.status,
      // 有参数/输出才可折叠；ThoughtChain 默认不展开任何节点，所以默认是收起的
      collapsible: hasDetail,
      content: hasDetail ? <StepDetail step={step} /> : undefined,
      blink: step.status === 'loading',
      icon:
        step.status === 'loading' ? (
          <ThunderboltOutlined />
        ) : step.status === 'error' ? (
          <CloseCircleOutlined />
        ) : (
          <CheckCircleOutlined />
        ),
    };
  });

  return <ThoughtChain className="agent-thought-chain" items={items} />;
};
