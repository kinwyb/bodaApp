/**
 * 一条助手回答的正文。
 *
 * **按时间线渲染**：后端的思考与正文是交错的（思考 → 工具 → 回答 → 思考 → 回答 …），
 * 所以这里遍历 `timeline`，按到达顺序依次输出思考块 / 工具链 / 正文块，
 * 而不是「思考在最上、工具在中、正文在下」那样按类型堆。
 * 旧消息没有 timeline 时由 timelineOf 合成一份，退回改造前的顺序。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined, FileImageOutlined } from '@ant-design/icons';
import { FileCard, Sources, Think } from '@ant-design/x';
import XMarkdown from '@ant-design/x-markdown';
import type {
  AgentAssistantContent,
  AgentTimelineItem,
} from '../types';
import { timelineOf } from '../types';
import { blocksOf, splitAnswerBlocks } from '../timeline';
import type { AnswerSplit, TimelineBlock } from '../timeline';
import { resolveAgentFileUrl, useAgentFilePreview, workspaceFileUrl } from '../files';
import type { AgentFilePreviewApi } from '../files';
import { mediaKeyOf } from '../protocol';
import { AgentApprovalCard } from './AgentApproval';
import { AgentStepChain } from './AgentStepChain';
import { AgentUserInputCard } from './AgentUserInput';

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

const IMAGE_NAME = /\.(png|jpe?g|gif|bmp|webp|svg|ico|heic)$/i;

/*
 * XMarkdown 是 React.memo 的，但 streaming 每次渲染新建对象就会让 memo 失效：
 * 流式中每个已结束的正文段都要跟着重新解析一遍整段 Markdown，
 * 一段长回答里片段越多、每帧越贵。这里换成两个常量对象，只有「当前这段」会重解析。
 */
const MARKDOWN_STREAMING = { hasNextChunk: true, tail: true };
const MARKDOWN_IDLE = { hasNextChunk: false, tail: false };

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

/**
 * 轮次结束后的「执行过程」折叠。
 *
 * 流式中过程照旧摊开；这一轮结束（streaming 翻 false）才挂载本组件，默认收起，
 * 把版面让给最终回答。展开态是本地状态：挂载后完全跟随用户点击，父级因别的消息
 * 流式而重渲染不会把它顶回去；历史消息（streaming=false）同样默认收起。
 * 复用 Think 的壳（图标 + 标题 + 箭头 + 折叠动画），视觉与思考块一致；
 * 收起时内容不挂载（Think 默认 destroyOnHidden），长历史不用白养一堆 Markdown。
 */
const AgentProcessFold: React.FC<{ split: AnswerSplit; children: React.ReactNode }> = ({
  split,
  children,
}) => {
  const [expanded, setExpanded] = useState(false);
  const stats = [
    split.reasoningCount > 0 ? `思考 ${split.reasoningCount} 段` : '',
    split.toolCount > 0 ? `工具 ${split.toolCount} 次` : '',
    split.noteCount > 0 ? `说明 ${split.noteCount} 段` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Think
      className={`agent-think agent-process-fold${split.failed ? ' agent-process-fold-failed' : ''}`}
      title={
        <span className="agent-process-fold-title">
          执行过程
          {stats ? <span className="agent-process-fold-stats">{stats}</span> : null}
        </span>
      }
      icon={split.failed ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
      expanded={expanded}
      onExpand={setExpanded}
    >
      <div className="agent-process-fold-body">{children}</div>
    </Think>
  );
};

/**
 * 图片 media 的展示卡片。
 *
 * FileCard 的 image 分支只渲染图片本身，不渲染 name/description，也不会接 onClick，
 * 用户看不出这是文件。这里保留图片预览，同时固定显示文件名与“预览”入口。
 */
const AgentMediaImage: React.FC<{
  href?: string;
  openUrl?: string;
  name: string;
  mediaKey: string;
  preview: AgentFilePreviewApi | null;
}> = ({ href, openUrl, name, mediaKey, preview }) => {
  const [failed, setFailed] = useState(false);

  const open = () => {
    if (preview && openUrl) {
      preview.openFile({ url: openUrl, name, key: mediaKey });
      return;
    }
    const target = href ?? openUrl;
    if (target) window.open(target, '_blank', 'noopener,noreferrer');
  };

  if (!href || failed) {
    return (
      <div className="agent-media-image agent-media-image-fallback">
        <FileImageOutlined className="agent-media-image-fallback-icon" />
        <span className="agent-media-image-name" title={name}>
          {name}
        </span>
        {href || openUrl ? (
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={open}>
            打开
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <figure className="agent-media-image">
      <button
        type="button"
        className="agent-media-image-preview"
        aria-label={`预览 ${name}`}
        onClick={open}
      >
        <img src={href} alt={name} loading="lazy" onError={() => setFailed(true)} />
      </button>
      <figcaption className="agent-media-image-meta">
        <span className="agent-media-image-name" title={name}>
          {name}
        </span>
        <Button size="small" type="text" icon={<EyeOutlined />} onClick={open}>
          预览
        </Button>
      </figcaption>
    </figure>
  );
};

export const AgentAnswer: React.FC<{
  content: AgentAssistantContent;
  streaming: boolean;
  /** 审批表态（允许 / 拒绝）；不传则审批只读（历史渲染） */
  onApproval?: (approvalId: string, decision: 'accept' | 'decline') => void;
  /** 打开审批详情弹窗 */
  onShowApproval?: (approvalId: string) => void;
  /** 提问作答；不传则提问只读（历史渲染） */
  onUserInput?: (requestId: string, answers: Record<string, string[]>) => void;
}> = ({ content, streaming, onApproval, onShowApproval, onUserInput }) => {
  const blocks = blocksOf(timelineOf(content));
  // 流式中不分区，过程照旧摊开；轮次结束后才折过程、露最终回答
  const split = streaming ? null : splitAnswerBlocks(blocks);
  // 工作台挂了文件面板时附件在面板里预览；独立 /agent 路由没有 Provider，保持新窗口
  const preview = useAgentFilePreview();
  const mediaItems = (content.media ?? []).map((media, index) => {
    const filePath = typeof media.metadata?.filePath === 'string' ? media.metadata.filePath : '';
    const fileAgent = typeof media.metadata?.agent === 'string' ? media.metadata.agent : '';
    const href =
      resolveAgentFileUrl(media.url) ??
      (filePath && fileAgent ? workspaceFileUrl(fileAgent, filePath) : undefined);
    // 交给面板的地址：实时用原始相对地址（面板负责补 token / download），
    // 历史没有相对地址，直接用解析好的工作区 URL
    const openUrl = media.url ?? href;
    const name =
      media.name || fileNameOf(media.url) || fileNameOf(filePath) || `附件 ${index + 1}`;
    const type = href
      ? (fileCardType(media.type) ?? (IMAGE_NAME.test(name) ? 'image' : 'file'))
      : 'file';
    const mediaKey = mediaKeyOf(media);
    return {
      key: `${mediaKey}-${index}`,
      mediaKey,
      href,
      openUrl,
      name,
      type,
      byte: media.size,
      onClick:
        preview && openUrl
          ? () => preview.openFile({ url: openUrl, name, key: mediaKey })
          : href
            ? () => window.open(href, '_blank', 'noopener,noreferrer')
            : undefined,
      style: href ? ({ cursor: 'pointer' } as React.CSSProperties) : undefined,
    };
  });
  const imageMedia = mediaItems.filter((item) => item.type === 'image');
  const fileMedia = mediaItems.filter((item) => item.type !== 'image');

  /** 一块时间线一个元素，过程区与回答区共用同一套渲染 */
  const renderBlock = (block: TimelineBlock) => {
    if (block.kind === 'tools') {
      return <AgentStepChain key={block.key} steps={block.steps} />;
    }

    if (block.kind === 'approval') {
      return (
        <AgentApprovalCard
          key={block.key}
          approval={block.approval}
          onRespond={onApproval}
          onShow={onShowApproval}
        />
      );
    }

    if (block.kind === 'user-input') {
      return <AgentUserInputCard key={block.key} userInput={block.userInput} onRespond={onUserInput} />;
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
  };

  return (
    <div className="agent-answer">
      {blocks.length === 0 && streaming ? <span className="agent-thinking">正在思考</span> : null}

      {split?.foldable ? (
        <>
          <AgentProcessFold key="process-fold" split={split}>
            {split.process.map(renderBlock)}
          </AgentProcessFold>
          {split.answer.map(renderBlock)}
        </>
      ) : (
        blocks.map(renderBlock)
      )}

      {imageMedia.length > 0 ? (
        <div className="agent-media-images">
          {imageMedia.map((item) => (
            <AgentMediaImage
              key={item.key}
              href={item.href}
              openUrl={item.openUrl}
              name={item.name}
              mediaKey={item.mediaKey}
              preview={preview}
            />
          ))}
        </div>
      ) : null}

      {fileMedia.length > 0 ? (
        <FileCard.List
          className="agent-media"
          size="small"
          overflow="wrap"
          items={fileMedia.map((item) => ({
            key: item.key,
            name: item.name,
            type: item.type,
            byte: item.byte,
            src: item.href,
            onClick: item.onClick,
            style: item.style,
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
