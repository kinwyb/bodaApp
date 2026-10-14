/** 单元格编辑：进入方式与编辑结果回调 */

/** 进入单元格编辑的触发方式 */
export type EditCellTrigger =
  | 'doubleclick'
  | 'click'
  | 'api'
  | 'keydown'
  | Array<'doubleclick' | 'click' | 'api' | 'keydown'>;

/** 单元格编辑完成后的回调参数 */
export interface VTableCellValueChangeInfo {
  /** 列字段名 */
  field: string;
  /** 数据行索引（不含表头，0 起） */
  rowIndex: number;
  /** 该行原始记录 */
  record?: Record<string, unknown>;
  /** 编辑后的值 */
  value: unknown;
  /**
   * 编辑**前**的值（单元格原来的内容），对应 VTable 原生事件里的 currentValue。
   *
   * 想要新旧对比必须读这个字段：VTable 提交编辑时是**直接改写 record 对象**的
   * （DataSource.changeFieldValue → setRecordFieldValue），所以回调触发时，
   * 页面手里那份 records 里的值已经被覆盖成新值了，回头去读同一个 record 拿不到旧值。
   *
   * 需要「编辑前的整行」时，`{...record, [field]: previousValue}` 拼一下即可 ——
   * 这次提交只改了 field 这一个字段，行里其余字段本来就还是旧值。
   */
  previousValue?: unknown;
}
