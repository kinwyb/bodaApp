/**
 * 输入框下方的 token 用量。
 *
 * 一行只放「本对话累计消耗」，悬停看输入 / 输出 / 缓存命中明细。
 *
 * 缓存命中率 = `cachedInputTokens ÷ inputTokens`：缓存是**输入的一部分**（同一批 prompt
 * 里有多少被命中），不是额外加的量，所以分母只取输入、不取总量。
 */

import React, { useMemo } from 'react';
import { Tooltip } from 'antd';
import { formatPercent, rateToPercent } from '@/utils';
import { formatTokenCount } from '../format';
import type { AgentTokenDetail, AgentTokenUsage } from '../types';

/** 一行「标签 值」的明细行 */
const DetailLine: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="agent-token-detail-line">
    <span>{label}</span>
    <span>{value}</span>
  </div>
);

/**
 * 累计缓存命中：`105.7k（58.3%）`。
 *
 * 只挂在「本对话累计」上：单轮用户输入都是新内容，轮内谈命中率没有意义，
 * 命中是跨轮复用历史上下文才有的，累计维度才看得出来。
 *
 * 一次都没命中也要如实说「未命中」—— 不显示的话，用户分不清「确实没命中」
 * 和「前端没拿到这项数据」。
 */
function cacheTextOf(detail: AgentTokenDetail): string {
  if (detail.cachedInputTokens <= 0) return '未命中';
  if (detail.inputTokens <= 0) return formatTokenCount(detail.cachedInputTokens);

  const percent = rateToPercent(detail.cachedInputTokens / detail.inputTokens, 1);
  const hit = formatTokenCount(detail.cachedInputTokens);
  return percent === null
    ? hit
    : `${hit}（${formatPercent(percent, { digits: 1, trimZeros: true })}）`;
}

export const AgentTokenMeter: React.FC<{ usage: AgentTokenUsage }> = ({ usage }) => {
  const { total, last } = usage;

  // 极端情况：只拿到本轮用量（累计还没落库）时，不该显示「累计 0」
  const totalText = formatTokenCount(total.totalTokens || last.totalTokens);

  const detail = useMemo(
    () => (
      <div className="agent-token-detail">
        {total.totalTokens > 0 ? (
          <>
            <DetailLine label="本对话累计" value={`${formatTokenCount(total.totalTokens)} tokens`} />
            <DetailLine label="　输入" value={formatTokenCount(total.inputTokens)} />
            <DetailLine
              label="　输出"
              value={`${formatTokenCount(total.outputTokens)}${
                total.reasoningOutputTokens > 0
                  ? `（思考 ${formatTokenCount(total.reasoningOutputTokens)}）`
                  : ''
              }`}
            />
            <DetailLine label="　缓存命中" value={cacheTextOf(total)} />
          </>
        ) : null}

        {last.totalTokens > 0 ? (
          <>
            <DetailLine label="最后一轮" value={`${formatTokenCount(last.totalTokens)} tokens`} />
            <DetailLine label="　输入" value={formatTokenCount(last.inputTokens)} />
            <DetailLine label="　输出" value={formatTokenCount(last.outputTokens)} />
          </>
        ) : null}
      </div>
    ),
    [last, total],
  );

  return (
    <Tooltip
      title={detail}
      placement="top"
      /*
       * antd 的气泡固定 max-width: 250px（token.tooltipMaxWidth），明细会被折成一片。
       * 用内联样式放宽：root 本身是 width: max-content，放宽后会自然贴合内容。
       * rootClassName 是同名样式兜底（见 agent.css）。
       */
      rootClassName="agent-token-tooltip"
      styles={{ root: { maxWidth: 300 } }}
    >
      <span className="agent-token-meter" aria-label={`本对话累计 ${totalText} tokens`}>
        累计 {totalText}
      </span>
    </Tooltip>
  );
};
