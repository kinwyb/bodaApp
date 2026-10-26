/**
 * 一条助手回答的正文。
 *
 * 渲染顺序对齐后端的流式过程：
 *   reasoning_*（思考） → tool_start/completed（工具链） → message_delta（正文） → 媒体 / 引用
 */

import React from 'react';
import { Alert } from 'antd';
import { FileCard, Sources, Think } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type { AgentAssistantContent } from '../types';
import { AgentStepChain } from './AgentStepChain';

/** 后端 media 只给 url 时，从末段取个文件名 */
function fileNameOf(url?: string): string | undefined {
  if (!url) return undefined;
  const clean = url.split('?')[0];
  const name = clean.slice(clean.lastIndexOf('/') + 1);
  return name || undefined;
}

/** 后端 Media.Type（image/audio/document）→ FileCard 的类型 */
function fileCardType(type?: string): 'file' | 'image' | 'audio' | 'video' | undefined {
  switch (type) {
    case 'image':
    case 'audio':
    case 'video':
    case 'file':
      return type;
    case 'document':
      return 'file';
    default:
      return undefined;
  }
}

export const AgentAnswer: React.FC<{ content: AgentAssistantContent; streaming: boolean }> = ({
  content,
  streaming,
}) => {
  const hasText = content.text.length > 0;
  const reasoning = content.reasoning ?? '';

  return (
    <div className="agent-answer">
      {reasoning ? (
        <Think
          className="agent-think"
          title="思考过程"
          loading={streaming}
          blink={streaming}
          defaultExpanded={false}
        >
          <div className="agent-reasoning">{reasoning}</div>
        </Think>
      ) : null}

      {content.steps && content.steps.length > 0 ? <AgentStepChain steps={content.steps} /> : null}

      {/* 历史里以错误收尾的轮次：错误本身也是一条可读的回答 */}
      {content.error ? (
        <Alert className="agent-answer-error" type="error" showIcon message={content.error} />
      ) : null}

      {content.approval ? (
        <Alert
          className="agent-approval"
          type="warning"
          showIcon
          message="需要审批"
          description={
            <>
              {content.approval.content || 'Agent 请求执行一个需要确认的操作。'}
              <div className="agent-approval-hint">
                （审批回传的上行命令后端暂未提供，这里先只做展示）
              </div>
            </>
          }
        />
      ) : null}

      {hasText ? (
        <XMarkdown
          className="agent-markdown"
          content={content.text}
          openLinksInNewTab
          streaming={{ hasNextChunk: streaming, tail: streaming }}
        />
      ) : streaming ? (
        <span className="agent-thinking">正在思考</span>
      ) : null}

      {content.media && content.media.length > 0 ? (
        <FileCard.List
          className="agent-media"
          size="small"
          overflow="wrap"
          items={content.media.map((media, index) => ({
            key: `${media.url ?? media.name ?? 'media'}-${index}`,
            name: media.name || fileNameOf(media.url) || `附件 ${index + 1}`,
            type: fileCardType(media.type),
            src: media.url,
          }))}
        />
      ) : null}

      {content.sources && content.sources.length > 0 ? (
        <Sources
          className="agent-sources"
          title="引用来源"
          items={content.sources.map((source) => ({
            key: source.key,
            title: source.title,
            url: source.url,
            description: source.description,
          }))}
          onClick={(item) => {
            if (item.url) window.open(item.url, '_blank', 'noopener');
          }}
        />
      ) : null}
    </div>
  );
};
