import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blocksOf, splitAnswerBlocks } from './timeline.ts';
import type { AgentTimelineItem, AgentToolStep } from './types.ts';

function tool(key: string): AgentTimelineItem {
  const step: AgentToolStep = { key, title: 'command', status: 'success' };
  return { kind: 'tool', key, step };
}

function reasoning(key: string): AgentTimelineItem {
  return { kind: 'reasoning', key, text: '……', done: true };
}

function text(key: string, value = '正文'): AgentTimelineItem {
  return { kind: 'text', key, text: value, done: true };
}

describe('blocksOf', () => {
  it('相邻工具步合成一条链，被思考隔开的各自成链', () => {
    const blocks = blocksOf([tool('t1'), tool('t2'), reasoning('r1'), tool('t3')]);
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ['tools', 'reasoning', 'tools'],
    );
    assert.equal(blocks[0].kind === 'tools' && blocks[0].steps.length, 2);
    assert.equal(blocks[2].kind === 'tools' && blocks[2].steps.length, 1);
  });
});

describe('splitAnswerBlocks', () => {
  it('典型长轮：过程（思考/工具/旁白）折叠，末尾正文外露', () => {
    const split = splitAnswerBlocks(
      blocksOf([reasoning('r1'), tool('t1'), tool('t2'), text('n1', '数据已获取'), tool('t3'), text('a1', '最终报告')]),
    );
    assert.equal(split.foldable, true);
    assert.deepEqual(
      split.process.map((block) => block.kind),
      ['reasoning', 'tools', 'text', 'tools'],
    );
    assert.deepEqual(
      split.answer.map((block) => block.key),
      ['a1'],
    );
    assert.equal(split.reasoningCount, 1);
    assert.equal(split.toolCount, 3);
    assert.equal(split.noteCount, 1);
    assert.equal(split.failed, false);
  });

  it('末尾多段连续正文都留在折叠外', () => {
    const split = splitAnswerBlocks(blocksOf([tool('t1'), text('a1'), text('a2')]));
    assert.equal(split.foldable, true);
    assert.deepEqual(
      split.answer.map((block) => block.key),
      ['a1', 'a2'],
    );
  });

  it('纯正文不折叠', () => {
    const split = splitAnswerBlocks(blocksOf([text('a1'), text('a2')]));
    assert.equal(split.foldable, false);
    assert.equal(split.process.length, 0);
    assert.equal(split.answer.length, 2);
  });

  it('空时间线不折叠', () => {
    const split = splitAnswerBlocks([]);
    assert.equal(split.foldable, false);
  });

  it('错误永远外露：收尾错误留在外面并标记失败', () => {
    const split = splitAnswerBlocks(
      blocksOf([reasoning('r1'), tool('t1'), { kind: 'error', key: 'e1', message: '执行失败' }]),
    );
    assert.equal(split.foldable, true);
    assert.equal(split.failed, true);
    assert.deepEqual(
      split.process.map((block) => block.kind),
      ['reasoning', 'tools'],
    );
    assert.deepEqual(
      split.answer.map((block) => block.kind),
      ['error'],
    );
  });

  it('中途错误也抽到外面，与末尾正文保持原相对顺序', () => {
    const split = splitAnswerBlocks(
      blocksOf([text('n1'), { kind: 'error', key: 'e1', message: '一步失败' }, tool('t1'), text('a1')]),
    );
    assert.equal(split.foldable, true);
    assert.equal(split.failed, true);
    assert.deepEqual(
      split.answer.map((block) => block.key),
      ['e1', 'a1'],
    );
    assert.deepEqual(
      split.process.map((block) => block.key),
      ['n1', 't1'],
    );
  });

  it('纯过程轮（无收尾正文也无错误）不折叠，过程本身就是内容', () => {
    const split = splitAnswerBlocks(blocksOf([reasoning('r1'), tool('t1')]));
    assert.equal(split.foldable, false);
  });

  it('已解决的审批 / 提问归过程', () => {
    const split = splitAnswerBlocks(
      blocksOf([
        { kind: 'approval', key: 'ap1', approval: { id: 'ap1', content: '允许执行命令？', status: 'accepted' } },
        { kind: 'user-input', key: 'ui1', userInput: { id: 'ui1', questions: [], status: 'answered' } },
        text('a1'),
      ]),
    );
    assert.equal(split.foldable, true);
    assert.deepEqual(
      split.process.map((block) => block.kind),
      ['approval', 'user-input'],
    );
  });
});
