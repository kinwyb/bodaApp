/**
 * 主表（包装 BOM 列表）的列定义。
 *
 * 有两个消费者：页面里的 `FilterTable`，与界面桥的 `createTableBridge`（列目录、默认投影列、
 * 「能按哪些字段筛」全靠这一份）。写两份必然漂移 —— 桥会跟模型说「能按 X 筛」，
 * 而屏幕上根本没有那一列，或者反过来。
 */

import type {AppColumnDef} from '@/components/grid-table';

/** 主表列定义（顺序即屏幕上的顺序，桥的列目录也照它来） */
export const MATRIX_LIST_COLUMNS: AppColumnDef[] = [
    {field: 'PackMaterialCode', title: '物料编码', minWidth: 100, filterType: 'enum'},
    {field: 'PackMaterialName', title: '物料名称', minWidth: 100, filterType: 'text'},
    {field: 'ProjectCode', title: '项目', minWidth: 100, filterType: 'text'},
    {field: 'PackMethod', title: '包装方式', filterType: 'text'},
    {field: 'PackNum', title: '包装方法', filterType: 'text'},
    {field: 'MatrixVersion', title: '矩阵版本'},
];
