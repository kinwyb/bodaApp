/**
 * 工具调用链：把 Agent 的每一步摊开，流式过程中能看到 loading 闪烁。
 *
 * 每一步默认**只显示工具名**：参数与输出都收进可折叠内容里，
 * 不加干预的话一屏全是 JSON 参数，正文反而被挤没了。
 * MCP 工具在名字前挂一个来源标记（服务名），和本地工具区分开。
 */

import React from 'react';
import { CheckCircleOutlined, CloseCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import type { ThoughtChainItemType } from '@ant-design/x';
import type { AgentToolStep } from '../types';

/** MCP 结果多是一整段 JSON（BI 查询），缩进后才看得下去；解析不出来就原样显示 */
function prettyContent(step: AgentToolStep): string | undefined {
  const text = step.content;
  if (!text || step.origin !== 'mcp') return text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    // 后端按体积上限截断过的结果不是合法 JSON，保持原文
    return text;
  }
}

/** 步骤标题：来源标记 + 工具名 */
const StepTitle: React.FC<{ step: AgentToolStep }> = ({ step }) => (
  <span className="agent-step-title">
    {step.origin === 'mcp' ? (
      <Tag className="agent-step-tag" color="geekblue" bordered={false}>
        {step.server ? `MCP · ${step.server}` : 'MCP'}
      </Tag>
    ) : null}
    <span className="agent-step-name">{step.title}</span>
  </span>
);

/** 展开后看到的东西：参数摘要（后端已截断）与工具输出 */
const StepDetail: React.FC<{ step: AgentToolStep }> = ({ step }) => {
  const content = prettyContent(step);
  if (!step.description && !content) return null;

  return (
    <div className="agent-step-detail">
      {step.description ? (
        <div className="agent-step-section">
          <div className="agent-step-label">参数</div>
          <div className="agent-step-code">{step.description}</div>
        </div>
      ) : null}
      {content ? (
        <div className="agent-step-section">
          <div className="agent-step-label">输出</div>
          <div className="agent-step-code">{content}</div>
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
      title: <StepTitle step={step} />,
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
