/**
 * 一条助手回答的正文。
 *
 * **按时间线渲染**：后端的思考与正文是交错的（思考 → 工具 → 回答 → 思考 → 回答 …），
 * 所以这里遍历 `timeline`，按到达顺序依次输出思考块 / 工具链 / 正文块，
 * 而不是「思考在最上、工具在中、正文在下」那样按类型堆。
 * 旧消息没有 timeline 时由 timelineOf 合成一份，退回改造前的顺序。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert } from 'antd';
import { FileCard, Sources, Think } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type {
  AgentApproval,
  AgentAssistantContent,
  AgentTimelineItem,
  AgentToolStep,
} from '../types';
import { timelineOf } from '../types';
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

/*
 * XMarkdown 是 React.memo 的，但 streaming 每次渲染新建对象就会让 memo 失效：
 * 流式中每个已结束的正文段都要跟着重新解析一遍整段 Markdown，
 * 一段长回答里片段越多、每帧越贵。这里换成两个常量对象，只有「当前这段」会重解析。
 */
const MARKDOWN_STREAMING = { hasNextChunk: true, tail: true };
const MARKDOWN_IDLE = { hasNextChunk: false, tail: false };

/** 渲染单元：相邻的工具步合成一个链，其余一项一块 */
type TimelineBlock =
  | { kind: 'reasoning'; key: string; item: Extract<AgentTimelineItem, { kind: 'reasoning' }> }
  | { kind: 'text'; key: string; item: Extract<AgentTimelineItem, { kind: 'text' }> }
  | { kind: 'tools'; key: string; steps: AgentToolStep[] }
  | { kind: 'approval'; key: string; approval: AgentApproval }
  | { kind: 'error'; key: string; message: string };

function blocksOf(items: AgentTimelineItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];

  items.forEach((item) => {
    switch (item.kind) {
      case 'tool': {
        // 连续的工具调用归到一个链里，避免一步一个卡片太碎
        const last = blocks[blocks.length - 1];
        if (last && last.kind === 'tools') {
          last.steps.push(item.step);
          return;
        }
        blocks.push({ kind: 'tools', key: item.key, steps: [item.step] });
        return;
      }
      case 'reasoning':
        blocks.push({ kind: 'reasoning', key: item.key, item });
        return;
      case 'text':
        blocks.push({ kind: 'text', key: item.key, item });
        return;
      case 'approval':
        blocks.push({ kind: 'approval', key: item.key, approval: item.approval });
        return;
      case 'error':
        blocks.push({ kind: 'error', key: item.key, message: item.message });
        return;
      default:
        return;
    }
  });

  return blocks;
}

/**
 * 一段思考过程。
 *
 * 展开状态是受控的：**正在想的时候自动展开**（能看着字一个个冒出来），
 * `reasoning_completed` 之后自动收起，把版面让给正文。
 * 只在「思考中 → 想完了」这个翻转点接管状态，其余时间跟随用户点击，
 * 否则用户刚手动折叠又会被下一帧的 delta 顶开。
 */
const AgentReasoning: React.FC<{
  item: Extract<AgentTimelineItem, { kind: 'reasoning' }>;
  streaming: boolean;
}> = ({ item, streaming }) => {
  const active = streaming && !item.done;
  const [expanded, setExpanded] = useState(active);
  const lastActive = useRef(active);

  useEffect(() => {
    if (lastActive.current === active) return;
    lastActive.current = active;
    setExpanded(active);
  }, [active]);

  return (
    <Think
      className="agent-think"
      title="思考过程"
      loading={active}
      blink={active}
      expanded={expanded}
      onExpand={setExpanded}
    >
      <div className="agent-reasoning">{item.text}</div>
    </Think>
  );
};

export const AgentAnswer: React.FC<{ content: AgentAssistantContent; streaming: boolean }> = ({
  content,
  streaming,
}) => {
  const blocks = blocksOf(timelineOf(content));

  return (
    <div className="agent-answer">
      {blocks.length === 0 && streaming ? <span className="agent-thinking">正在思考</span> : null}

      {blocks.map((block) => {
        if (block.kind === 'tools') {
          return <AgentStepChain key={block.key} steps={block.steps} />;
        }

        if (block.kind === 'approval') {
          return (
            <Alert
              key={block.key}
              className="agent-approval"
              type="warning"
              showIcon
              message="需要审批"
              description={
                <>
                  {block.approval.content || 'Agent 请求执行一个需要确认的操作。'}
                  <div className="agent-approval-hint">
                    （审批回传的上行命令后端暂未提供，这里先只做展示）
                  </div>
                </>
              }
            />
          );
        }

        if (block.kind === 'error') {
          return (
            <Alert key={block.key} className="agent-answer-error" type="error" showIcon message={block.message} />
          );
        }

        if (block.kind === 'reasoning') {
          return <AgentReasoning key={block.key} item={block.item} streaming={streaming} />;
        }

        // 正文：一段回答一块，流式中只有「当前这段」显示打字光标
        const active = streaming && !block.item.done;
        return (
          <XMarkdown
            key={block.key}
            className="agent-markdown"
            content={block.item.text}
            openLinksInNewTab
            streaming={active ? MARKDOWN_STREAMING : MARKDOWN_IDLE}
          />
        );
      })}

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
