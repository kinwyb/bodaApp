/**
 * autoFillWidth 的「额外列」补偿。
 *
 * @visactor/vtable 的 `autoFillWidth` 只做了「补白」这一半：列宽总和不足容器时按比例拉宽，
 * 一旦总和大于容器就撒手不管。它的「总和」是把**行号列、展开列也算进去**的（行号列在
 * `colCount` 里占着 col 0），所以列宽按「铺满容器」配的表格一打开序号列，总宽就变成
 * 容器宽 + 一列序号宽 —— 明明没有内容要横向滚动，却冒出横向滚动条。
 * 这一格很像「补白把可用宽度算多了」，根子是：**超过容器时它不收缩**。
 *
 * 这里只收拾「溢出主要是额外列造成」的那一种：把业务列按比例收回，
 * 让总宽精确等于可用宽度（`tableNoFrameWidth`）。业务列本身就明显超出容器的
 * （列真的太多 / 列宽真的太大）保持原样 —— 那是 standard 模式该有的横向滚动。
 *
 * 「明显」的界线用边框容差：列宽是按「铺满容器」配的，业务列合计等于容器宽时
 * 只比 `tableNoFrameWidth` 多出左右边框那几像素，不该因为这几像素放弃补偿。
 */

/** 单个列宽下限（与 @visactor/vtable 的默认最小列宽一致，用作兜底） */
const FALLBACK_MIN_COL_WIDTH = 20;

/**
 * 把业务列按比例收回，使「额外列 + 业务列」正好铺满可用宽度。
 *
 * @param table         表格实例
 * @param extraCols     前导的额外列数（行号列 + 展开列），它们不参与缩放
 * @param containerWidth 容器宽（用于算出边框占的容差）
 * @returns 是否真的改过列宽
 */
export function fitColumnsToContainer(
  table: {
    colCount: number;
    tableNoFrameWidth: number;
    getColWidth: (col: number) => number;
    getMinColWidth?: (col: number) => number;
    setColWidth: (col: number, width: number) => void;
  },
  extraCols: number,
  containerWidth: number,
): boolean {
  const totalCols = table.colCount;
  if (extraCols <= 0 || extraCols >= totalCols) return false;
  const available = table.tableNoFrameWidth;
  if (!(available > 0)) return false;

  let extraWidth = 0;
  for (let col = 0; col < extraCols; col++) extraWidth += table.getColWidth(col);
  let businessWidth = 0;
  for (let col = extraCols; col < totalCols; col++) businessWidth += table.getColWidth(col);

  // 业务列的目标宽度 = 可用宽度 - 额外列宽
  const target = available - extraWidth;
  if (target <= 0) return false;
  // 没溢出：vtable 的补白已经把总宽补到容器了（或业务列还短着）
  if (businessWidth <= target) return false;
  // 业务列自己就明显放不下：这是真要横向滚，别动它
  const slack = Math.max(0, containerWidth - available);
  if (businessWidth > available + slack) return false;

  const ratio = target / businessWidth;
  const widths: number[] = [];
  let sum = 0;
  for (let col = extraCols; col < totalCols; col++) {
    const min = table.getMinColWidth?.(col) || FALLBACK_MIN_COL_WIDTH;
    const width = Math.max(min, Math.floor(table.getColWidth(col) * ratio));
    widths.push(width);
    sum += width;
  }
  // 各列最小宽度加起来都放不下：压不出结果，保持原样（宁可滚，也别挤成一条缝）
  if (sum > target) return false;
  // 取整误差补在最后一列上：总宽必须精确等于可用宽度，差 1px 也会冒滚动条
  widths[widths.length - 1] += target - sum;
  widths.forEach((width, index) => table.setColWidth(extraCols + index, width));
  return true;
}
