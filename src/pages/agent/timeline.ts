/**
 * 回答时间线的渲染分块与折叠分区（纯逻辑，无 React）。
 *
 * 分块：相邻工具步合成一条链，其余一项一块，供 AgentAnswer 按到达顺序渲染。
 * 分区：轮次结束后把「过程」折进一行摘要，末尾正文与错误留在外面，
 * 规则抽在这里方便用 node --test 直接覆盖。
 */

import type {
  AgentApproval,
  AgentTimelineItem,
  AgentToolStep,
  AgentUserInput,
} from './types';

/** 渲染单元：相邻的工具步合成一个链，其余一项一块 */
export type TimelineBlock =
  | { kind: 'reasoning'; key: string; item: Extract<AgentTimelineItem, { kind: 'reasoning' }> }
  | { kind: 'text'; key: string; item: Extract<AgentTimelineItem, { kind: 'text' }> }
  | { kind: 'tools'; key: string; steps: AgentToolStep[] }
  | { kind: 'approval'; key: string; approval: AgentApproval }
  | { kind: 'user-input'; key: string; userInput: AgentUserInput }
  | { kind: 'error'; key: string; message: string };

export function blocksOf(items: AgentTimelineItem[]): TimelineBlock[] {
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
      case 'user-input':
        blocks.push({ kind: 'user-input', key: item.key, userInput: item.userInput });
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

/** 轮次结束后的分区结果 */
export type AnswerSplit = {
  /** 折进「执行过程」的块（错误块除外，错误永远外露） */
  process: TimelineBlock[];
  /** 留在折叠外的块：末尾连续正文 + 全部错误，保持原相对顺序 */
  answer: TimelineBlock[];
  /**
   * 是否折叠：有过程，且外面有正文或错误可看。
   * 纯过程轮（没有收尾正文也没有错误）不折 —— 折起来只剩一行摘要，内容反而没了。
   */
  foldable: boolean;
  /** 摘要行统计：思考段数 */
  reasoningCount: number;
  /** 摘要行统计：工具次数（按步数，不是链数） */
  toolCount: number;
  /** 摘要行统计：过程里的中途说明段数 */
  noteCount: number;
  /** 整轮是否带错误（摘要行换失败图标） */
  failed: boolean;
};

/**
 * 按「最后一段连续正文」切分时间线。
 *
 * 最后一个非正文块之前的所有块（思考 / 工具 / 旁白 / 已解决的审批提问）归过程，
 * 其后的正文归最终回答。错误块无论在哪都抽到折叠外：失败不能被藏起来。
 * 中途的实质内容若被误折，展开即无损找回，不做「旁白还是正文」的猜测。
 */
export function splitAnswerBlocks(blocks: TimelineBlock[]): AnswerSplit {
  let lastNonText = -1;
  blocks.forEach((block, index) => {
    if (block.kind !== 'text') lastNonText = index;
  });

  const process: TimelineBlock[] = [];
  const answer: TimelineBlock[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'error') {
      answer.push(block);
      return;
    }
    if (index <= lastNonText) process.push(block);
    else answer.push(block);
  });

  let reasoningCount = 0;
  let toolCount = 0;
  let noteCount = 0;
  process.forEach((block) => {
    if (block.kind === 'reasoning') reasoningCount += 1;
    else if (block.kind === 'tools') toolCount += block.steps.length;
    else if (block.kind === 'text') noteCount += 1;
  });

  const failed = answer.some((block) => block.kind === 'error');
  const foldable =
    process.length > 0 && answer.some((block) => block.kind === 'text' || block.kind === 'error');

  return { process, answer, foldable, reasoningCount, toolCount, noteCount, failed };
}
