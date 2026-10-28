/**
 * Agent 对话里的数值格式化（纯函数，界面与状态层都能用）。
 */

import { roundTo } from '@/utils';

/**
 * token 数压缩到一行：`1234` → `1.2k`、`1234567` → `1.2M`。
 *
 * 输入框下方只有 12px 一行，明细气泡里也不该出现 `183,703` 这种长串 ——
 * 六位数字一多，整行就会被折成两行。需要精确值时让用户去服务端的用量记录里看。
 * 按 1000 进位：token 是计数，不是字节，按 1024 反而会对不上模型窗口那些整数。
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${trimZero(roundTo(value / 1000, 1))}k`;
  return `${trimZero(roundTo(value / 1_000_000, 1))}M`;
}

/** `1.0` → `1`，`1.2` 原样：别让缩写多出一个没有信息量的小数点 */
function trimZero(value: number): string {
  return String(value).replace(/\.0+$/, '');
}
