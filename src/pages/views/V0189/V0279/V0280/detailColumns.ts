import type { ColumnsDefine } from '@visactor/vtable';
import { register } from '@visactor/vtable';
import { InputEditor } from '@visactor/vtable-editors';
import { buildColumns, type AppColumnDef } from '@/components/columnBuilder';

/** 详情表格的一行：当前一单一款式，编辑时由预订单记录映射而来 */
export interface PreorderDetailRow {
  __id: string;
  /** 款号 */
  StyleCode: string | number;
  /** 款式数量 */
  Number: string | number;
  /** 款式描述 */
  ProduceName: string;
  /** 预估颜色 */
  Color: string;
  /** 特殊工序 */
  TSWorkName: string;
  /** 后道主工序 */
  HDWorkName: string;
  /** 中码下机克重 */
  ZZMWeight: string | number;
  /** 中码下机时间 */
  ZZMTime: string;
  /** 缝制工时 */
  MSewWt: string | number;
  /** 尺码分布，字段名 MCSize1 ~ MCSize9，对应下面 SIZE_HEADERS 的顺序 */
  [key: string]: unknown;
}

/** 尺码列标题，按界面原样展示 */
export const SIZE_HEADERS = [
  '12/960',
  '12/1056',
  '13/1152',
  '14/1248',
  '15/1344',
  '16/1440',
  '17/1536',
  '18/1632',
  '19/1728',
];

/** 详情表格的单元格编辑器名，全局注册一次 */
export const DETAIL_EDITOR_NAME = 'preorder-detail-input';
register.editor(DETAIL_EDITOR_NAME, new InputEditor());

const DETAIL_COLUMNS: AppColumnDef[] = [
  { field: 'StyleCode', title: '款号', width: 96 },
  { field: 'Number', title: '款式数量', width: 76, dataType: 'number' },
  { field: 'ProduceName', title: '款式描述', width: 130 },
  { field: 'Color', title: '预估颜色', width: 140 },
  { field: 'TSWorkName', title: '特殊工序', width: 110 },
  { field: 'HDWorkName', title: '后道主工序', width: 100 },
  { field: 'ZZMWeight', title: '中码下机克重', width: 108, dataType: 'number' },
  { field: 'ZZMTime', title: '中码下机时间', width: 108 },
  { field: 'MSewWt', title: '缝制工时', width: 88, dataType: 'number' },
  ...SIZE_HEADERS.map((title, index) => ({
    field: `MCSize${index + 1}`,
    title,
    width: 82,
    dataType: 'number' as const,
  })),
];

/** 详情表格可编辑字段 -> 编辑器名 */
export const DETAIL_EDITOR_FIELDS: Record<string, string> = Object.fromEntries(
  DETAIL_COLUMNS.map((column) => [column.field, DETAIL_EDITOR_NAME]),
);

export function buildPreorderDetailColumns(): ColumnsDefine {
  // 每列都挂上输入编辑器，双击即可修改
  return buildColumns(
    DETAIL_COLUMNS.map((column) => ({
      ...column,
      columnProps: { ...column.columnProps, editor: DETAIL_EDITOR_NAME },
    })),
  );
}

/** 新建一行空白明细，供用户直接在表格里输入 */
export function createDetailRow(id: string): PreorderDetailRow {
  const row = {
    __id: id,
    StyleCode: '',
    Number: '',
    ProduceName: '',
    Color: '',
    TSWorkName: '',
    HDWorkName: '',
    ZZMWeight: '',
    ZZMTime: '',
    MSewWt: '',
  } as PreorderDetailRow;
  SIZE_HEADERS.forEach((_, index) => {
    row[`MCSize${index + 1}`] = '';
  });
  return row;
}
