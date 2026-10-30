/** 单元格编辑：进入方式、编辑前拦截与编辑结果回调 */

/** 进入单元格编辑的触发方式 */
export type EditCellTrigger =
  | 'doubleclick'
  | 'click'
  | 'api'
  | 'keydown'
  | Array<'doubleclick' | 'click' | 'api' | 'keydown'>;

/** 单元格编辑完成后的回调参数 */
export interface GridTableCellValueChangeInfo {
  /** 列字段名 */
  field: string;
  /** 数据行索引（不含表头，0 起） */
  rowIndex: number;
  /** 该行原始记录 */
  record?: Record<string, unknown>;
  /** 编辑后的值 */
  value: unknown;
  /**
   * 编辑**前**的值（单元格原来的内容），对应 @visactor/vtable 原生事件里的 currentValue。
   *
   * 想要新旧对比必须读这个字段：@visactor/vtable 提交编辑时是**直接改写 record 对象**的
   * （DataSource.changeFieldValue → setRecordFieldValue），所以回调触发时，
   * 页面手里那份 records 里的值已经被覆盖成新值了，回头去读同一个 record 拿不到旧值。
   *
   * 需要「编辑前的整行」时，`{...record, [field]: previousValue}` 拼一下即可 ——
   * 这次提交只改了 field 这一个字段，行里其余字段本来就还是旧值。
   */
  previousValue?: unknown;
}

/**
 * 编辑前逐格判断（`GridTable.canEditCell`）的参数：**一个具体单元格**。
 *
 * 与 `cellStyle` / `cellTooltip` 是同一套口径（同一个行对象、同一套行号），只是回答的问题不同：
 * 那两个问「这一格长什么样 / 悬停说什么」，这个问「这一格能不能改」。
 */
export interface GridTableEditableCellInfo {
  /** 列字段名 */
  field: string;
  /**
   * 该行原始记录（表格内存里那一份，不是 cloneDeep 快照）。
   *
   * 统计行没有业务字段，这里会是 `undefined`；分组模式下**组行也有 record**
   * （里面只有 `children` 与汇总字段），按 `isGroupRow` 排掉。
   */
  record?: Record<string, unknown>;
  /**
   * 数据行下标（不含表头，0 起）。跟随**显示顺序**：排序后 0 是屏幕上第一行。
   *
   * 表头行不会走到判断里（组件直接放行）；分组下它与页面 `records` 的下标不对应，
   * 认行请用 `rowKey` 或 `record`。
   */
  rowIndex: number;
  /** 行主键（按表格的 `rowKey` 取；统计行为 `SUMMARY_ROW_KEY`，取不到是空串） */
  rowKey: string;
  /** 该单元格当前值（原始值，未经 fieldFormat / tagMap 转换） */
  dataValue: unknown;
  /** 是否底部统计行 */
  isSummaryRow: boolean;
  /** 是否树形分组的组行（配了 `group` 才有意义） */
  isGroupRow: boolean;
}

/**
 * 编辑前判断：返回 `false` 的单元格**不进编辑态**。
 *
 * 与 `validator` 的分工（最容易搞混的一处）：
 *
 * | | 时机 | 管什么 |
 * |---|---|---|
 * | `canEditCell` | **双击 / 单击 / 回车时**，编辑器还没创建 | 「这一格让不让改」 |
 * | `validator` | 用户提交时 | 「改成的这个值行不行」 |
 *
 * 被它拦下时**没有任何提示**（双击就是没反应），要让用户知道原因得自己配
 * `cellStyle`（灰显）+ `cellTooltip`（悬停说明），见 docs/表格编辑器用法.md。
 *
 * ⚠️ 它是**渲染路径上的回调**（勾选框列的 `disable` 每帧每格都会问一次），
 * 只做内存判断，别在这里发请求。
 */
export type GridTableCanEditCellHook = (info: GridTableEditableCellInfo) => boolean;
