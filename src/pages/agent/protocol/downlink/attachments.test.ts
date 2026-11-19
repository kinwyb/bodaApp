import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapEnvelopeAttachments,
  mediaKeyOf,
  SEND_FILE_TOOL,
  sendFileMediaOf,
} from './attachments.ts';

const localParams = JSON.stringify({
  file_path: '/tmp/报价分析报告_2026年7月.md',
  caption: '2026年7月报价汇总分析报告 - 完整详细版',
});

describe('sendFileMediaOf', () => {
  it('本地容器路径：还原文件名/类型，记录 filePath，不带 url', () => {
    const media = sendFileMediaOf({
      name: SEND_FILE_TOOL,
      params: localParams,
      result: '✅ 文件已发送: 报价分析报告_2026年7月.md',
    });
    assert.ok(media);
    assert.equal(media.name, '报价分析报告_2026年7月.md');
    assert.equal(media.type, 'file');
    assert.equal(media.url, undefined);
    assert.equal(media.metadata?.filePath, '/tmp/报价分析报告_2026年7月.md');
    assert.equal(media.metadata?.caption, '2026年7月报价汇总分析报告 - 完整详细版');
  });

  it('图片后缀识别为 image', () => {
    const media = sendFileMediaOf({
      name: SEND_FILE_TOOL,
      params: JSON.stringify({ file_path: '/workspace/chart.png' }),
    });
    assert.equal(media?.type, 'image');
    assert.equal(media?.name, 'chart.png');
  });

  it('远程 URL：直接给 url，可打开，不记 filePath', () => {
    const media = sendFileMediaOf({
      name: SEND_FILE_TOOL,
      params: JSON.stringify({ file_path: 'https://example.com/a.png' }),
    });
    assert.equal(media?.url, 'https://example.com/a.png');
    assert.equal(media?.name, 'a.png');
    assert.equal(media?.type, 'image');
    assert.equal(media?.metadata?.filePath, undefined);
  });

  it('非 send_file 工具返回 undefined', () => {
    assert.equal(sendFileMediaOf({ name: 'read_file', params: '{}' }), undefined);
  });

  it('失败的调用返回 undefined（仍按工具步骤展示错误）', () => {
    assert.equal(
      sendFileMediaOf({ name: SEND_FILE_TOOL, params: localParams, extra: { success: false } }),
      undefined,
    );
    assert.equal(
      sendFileMediaOf({ name: SEND_FILE_TOOL, params: localParams, extra: { status: 'error' } }),
      undefined,
    );
  });

  it('params 损坏时退回结果文本取文件名', () => {
    const media = sendFileMediaOf({
      name: SEND_FILE_TOOL,
      params: '{bad json',
      result: '✅ 文件已发送: 报告.md',
    });
    assert.equal(media?.name, '报告.md');
    assert.equal(media?.metadata?.filePath, undefined);
  });

  it('无 file_path 也无结果时返回 undefined', () => {
    assert.equal(sendFileMediaOf({ name: SEND_FILE_TOOL, params: '{}' }), undefined);
  });
});

describe('mediaKeyOf', () => {
  it('优先使用 fileID，其次 URL，再其次工作区路径', () => {
    assert.equal(mediaKeyOf({ type: 'file', fileId: 'f1', url: '/ws/files/f1' }), 'file:f1');
    assert.equal(mediaKeyOf({ type: 'file', url: '/ws/files/f1' }), 'url:/ws/files/f1');
    assert.equal(
      mediaKeyOf({
        type: 'file',
        metadata: { agent: 'coder', filePath: '/workspace/a.md' },
      }),
      'path:coder:/workspace/a.md',
    );
  });
});

describe('mapEnvelopeAttachments', () => {
  const toolCompleted = {
    v: 1,
    id: 'env-1',
    kind: 'agent',
    type: 'tool_completed',
    ts: 1,
    data: {
      event: 'tool_completed',
      role: 'tool',
      toolCalls: [
        {
          id: 'call-1',
          name: SEND_FILE_TOOL,
          params: JSON.stringify({ file_path: '/workspace/chart.png' }),
          result: '✅ 文件已发送: chart.png',
          extra: { status: 'completed', success: true },
        },
      ],
    },
  };

  it('实时 send_file 成功时归一成 live media，并带 agent 工作区归属', () => {
    const events = mapEnvelopeAttachments(toolCompleted, 'conv-1', {
      origin: 'live',
      includeSendFile: true,
      agent: 'coder',
    });
    const mediaEvent = events.find((event) => event.type === 'media');
    assert.ok(mediaEvent && mediaEvent.type === 'media');
    assert.equal(mediaEvent.origin, 'live');
    assert.equal(mediaEvent.media.length, 1);
    assert.equal(mediaEvent.media[0].name, 'chart.png');
    assert.equal(mediaEvent.media[0].metadata?.agent, 'coder');
  });

  it('data.media 与 send_file 同名时只保留更完整的 data.media', () => {
    const envelope = {
      ...toolCompleted,
      data: {
        ...toolCompleted.data,
        media: [
          {
            type: 'image',
            url: '/ws/files/f1',
            metadata: { filename: 'chart.png', fileID: 'f1' },
          },
        ],
      },
    };
    const events = mapEnvelopeAttachments(envelope, 'conv-1', {
      origin: 'live',
      includeSendFile: true,
      agent: 'coder',
    });
    const mediaEvent = events.find((event) => event.type === 'media');
    assert.ok(mediaEvent && mediaEvent.type === 'media');
    assert.equal(mediaEvent.media.length, 1);
    assert.equal(mediaEvent.media[0].url, '/ws/files/f1');
    assert.equal(mediaEvent.media[0].fileId, 'f1');
  });

  it('历史重建默认标记为 history', () => {
    const envelope = {
      v: 1,
      id: 'env-2',
      kind: 'agent',
      type: 'message_completed',
      ts: 1,
      data: {
        event: 'message_completed',
        role: 'assistant',
        media: [{ type: 'image', url: '/ws/files/f2', metadata: { filename: 'b.png' } }],
      },
    };
    const mediaEvent = mapEnvelopeAttachments(envelope, 'conv-1').find(
      (event) => event.type === 'media',
    );
    assert.ok(mediaEvent && mediaEvent.type === 'media');
    assert.equal(mediaEvent.origin, 'history');
  });

  it('历史用户帧默认保留 media，供 userAttachmentsOf 还原', () => {
    const envelope = {
      v: 1,
      id: 'env-3',
      kind: 'agent',
      type: 'user_message_completed',
      ts: 1,
      data: {
        event: 'user_message_completed',
        role: 'user',
        media: [{ type: 'file', url: '/workspace/upload.pdf', metadata: { filename: 'upload.pdf' } }],
      },
    };
    const mediaEvent = mapEnvelopeAttachments(envelope, 'conv-1').find(
      (event) => event.type === 'media',
    );
    assert.ok(mediaEvent && mediaEvent.type === 'media');
    assert.equal(mediaEvent.media.length, 1);
  });

  it('实时链路传 includeUserMedia=false 时忽略用户帧媒体', () => {
    const envelope = {
      v: 1,
      id: 'env-4',
      kind: 'agent',
      type: 'user_message_completed',
      ts: 1,
      data: {
        event: 'user_message_completed',
        role: 'user',
        media: [{ type: 'file', url: '/workspace/upload.pdf', metadata: { filename: 'upload.pdf' } }],
      },
    };
    assert.equal(
      mapEnvelopeAttachments(envelope, 'conv-1', {
        origin: 'live',
        includeUserMedia: false,
      }).some((event) => event.type === 'media'),
      false,
    );
  });
});
