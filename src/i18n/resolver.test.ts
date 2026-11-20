import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pageScopes, resolveTranslation } from './resolver.ts';

const common = {
  'en-US': {
    保存: 'Save',
    查询: 'Query',
  },
  'vi-VN': {
    保存: 'Lưu',
  },
};

const pages = {
  'en-US': {
    V0018: {
      查询: 'Look up',
      织造产量: 'Weaving output',
    },
    V0018_V0326: {
      查询: 'Search',
    },
  },
  'vi-VN': {
    V0018: {
      织造产量: 'Sản lượng dệt',
    },
  },
};

const menu = {
  'en-US': {
    报表管理: 'Reports',
  },
};

describe('pageScopes', () => {
  it('walks from the exact View code to its ancestors', () => {
    assert.deepEqual(pageScopes('V0189_V0279_V0280'), [
      'V0189_V0279_V0280',
      'V0189_V0279',
      'V0189',
    ]);
  });
});

describe('resolveTranslation', () => {
  it('prefers the exact page code over its parent and common messages', () => {
    assert.equal(
      resolveTranslation({
        locale: 'en-US',
        source: '查询',
        pageCode: 'V0018_V0326',
        common,
        menu,
        pages,
      }),
      'Search',
    );
  });

  it('falls back to page ancestors and then common messages', () => {
    assert.equal(
      resolveTranslation({
        locale: 'en-US',
        source: '织造产量',
        pageCode: 'V0018_V0326',
        common,
        menu,
        pages,
      }),
      'Weaving output',
    );
    assert.equal(
      resolveTranslation({
        locale: 'en-US',
        source: '保存',
        pageCode: 'V0018_V0326',
        common,
        menu,
        pages,
      }),
      'Save',
    );
  });

  it('returns the Chinese source when a translation is missing', () => {
    assert.equal(
      resolveTranslation({
        locale: 'vi-VN',
        source: '不存在',
        pageCode: 'V0018_V0326',
        common,
        menu,
        pages,
      }),
      '不存在',
    );
  });

  it('interpolates variables for translated and fallback text', () => {
    assert.equal(
      resolveTranslation({
        locale: 'vi-VN',
        source: '第{week}周',
        options: { vars: { week: 3 } },
        common: { 'vi-VN': { '第{week}周': 'Tuần {week}' } },
        menu,
        pages,
      }),
      'Tuần 3',
    );
    assert.equal(
      resolveTranslation({
        locale: 'vi-VN',
        source: '第{week}周',
        options: { vars: { week: 3 } },
        common,
        menu,
        pages,
      }),
      '第3周',
    );
  });

  it('looks up menu translations before common messages', () => {
    assert.equal(
      resolveTranslation({
        locale: 'en-US',
        source: '报表管理',
        options: { scope: 'menu' },
        common: { 'en-US': { 报表管理: 'Report fallback' } },
        menu,
        pages,
      }),
      'Reports',
    );
  });
});
