import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEND_FILE_TOOL, sendFileMediaOf } from './attachments.ts';

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
