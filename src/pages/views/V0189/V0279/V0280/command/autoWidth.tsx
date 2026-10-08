import {ColumnWidthOutlined} from '@ant-design/icons';
import type {PreorderCommandFactory} from './types';

/** 列宽自适应：按内容自适应所有列宽（与双击列边界的效果一致） */
export const autoWidthCommand: PreorderCommandFactory = ({tableRef}) => ({
    key: 'autoWidth',
    label: '列宽自适应',
    icon: <ColumnWidthOutlined/>,
    onClick: () => tableRef.current?.autoFitColumns(),
});
