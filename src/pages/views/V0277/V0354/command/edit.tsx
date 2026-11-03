import {EditOutlined} from '@ant-design/icons';
import type {PackBomMatrixCommandFactory} from './types';

/** 编辑：取选中的那一行，打开编辑表单 */
export const editCommand: PackBomMatrixCommandFactory = ({message, activeRow, hasSelection, openForm}) => ({
    key: 'edit',
    label: '编辑',
    icon: <EditOutlined/>,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一行矩阵');
            return;
        }
        openForm('edit', activeRow);
    },
});
