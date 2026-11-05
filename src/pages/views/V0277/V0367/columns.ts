/**
 * 主表（工艺路线矩阵列表）的列定义。
 *
 * 两个消费者：页面里的 `FilterTable`，与界面桥的 `createTableBridge`（列目录、默认投影列、
 * 「能按哪些字段筛」全靠这一份）。写两份必然漂移 —— 桥会跟模型说「能按 X 筛」，
 * 而屏幕上根本没有那一列。
 */

import type {AppColumnDef} from '@/components/grid-table';

/** 主表列定义（顺序即屏幕上的顺序，桥的列目录也照它来） */
export const PROCESS_MATRIX_LIST_COLUMNS: AppColumnDef[] = [
    {field: 'MaterialCode', title: '物料编码', minWidth: 110, filterType: 'enum'},
    {field: 'MaterialName', title: '物料名称', minWidth: 120, filterType: 'text'},
    {field: 'ProjectCode', title: '项目', minWidth: 100, filterType: 'text'},
    {field: 'PackMethod', title: '包装方式', minWidth: 100},
    {field: 'PackNum', title: '包装数量', minWidth: 90},
    {field: 'MatrixVersion', title: '矩阵版本', width: 90},
];
