import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTagValue, resolveTagItems, resolveTagPalette, splitTagValue } from './tag.ts';

describe('splitTagValue', () => {
  it('splits on English and Chinese commas and trims empty segments', () => {
    assert.deepEqual(splitTagValue(' 审核, 调整，审核调整 ,, '), ['审核', '调整', '审核调整']);
  });

  it('returns no tags for nullish or blank values', () => {
    assert.deepEqual(splitTagValue(null), []);
    assert.deepEqual(splitTagValue(undefined), []);
    assert.deepEqual(splitTagValue(' , ， '), []);
  });

  it('flattens array values before splitting', () => {
    assert.deepEqual(splitTagValue(['审核,调整', null, '调整']), ['审核', '调整', '调整']);
  });
});

describe('resolveTagItems', () => {
  const map = {
    '1': '苹果',
    '2': { label: '香蕉', color: '#d46b08' },
    '3': { label: '  ', color: '#389e0d' },
  };

  it('matches each comma-separated token independently', () => {
    assert.deepEqual(resolveTagItems('1,2,未知', map), [
      { label: '苹果' },
      { label: '香蕉', color: '#d46b08' },
      { label: '未知' },
    ]);
  });

  it('falls back to the raw token when a mapped label is blank', () => {
    assert.deepEqual(resolveTagItems('3', map), [{ label: '3', color: '#389e0d' }]);
  });
});

describe('formatTagValue', () => {
  it('keeps single-tag text compatible and joins multiple labels with commas', () => {
    assert.equal(formatTagValue('1', { '1': '苹果' }), '苹果');
    assert.equal(formatTagValue('1,2', { '1': '苹果', '2': '香蕉' }), '苹果,香蕉');
    assert.equal(formatTagValue('', {}), '');
  });
});

describe('resolveTagPalette', () => {
  it('derives background and border from a hex text color', () => {
    assert.deepEqual(resolveTagPalette({ label: '审核', color: '#cf1322' }, '#1f1f1f'), {
      text: '#cf1322',
      background: 'rgba(207, 19, 34, 0.08)',
      border: 'rgba(207, 19, 34, 0.35)',
    });
  });

  it('prefers explicit background and border colors', () => {
    assert.deepEqual(
      resolveTagPalette({ label: '审核', color: '#cf1322', bgColor: '#fff1f0', borderColor: '#ffa39e' }, '#1f1f1f'),
      { text: '#cf1322', background: '#fff1f0', border: '#ffa39e' },
    );
  });

  it('falls back to neutral colors when the text color is not hex', () => {
    assert.deepEqual(resolveTagPalette({ label: '审核', color: 'red' }, '#1f1f1f'), {
      text: 'red',
      background: '#fafafa',
      border: '#d9d9d9',
    });
  });
});
