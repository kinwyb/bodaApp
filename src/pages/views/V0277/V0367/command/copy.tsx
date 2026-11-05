import {CopyOutlined} from '@ant-design/icons';
import type {ProcessRouteMatrixCommandFactory} from './types';

/** 复制：以选中的那一行为底稿新建（提交时不带主键，落成一份新矩阵） */
export const copyCommand: ProcessRouteMatrixCommandFactory = ({message, activeRow, hasSelection, openForm}) => ({
    key: 'copy',
    label: '复制',
    icon: <CopyOutlined/>,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一份工艺路线矩阵');
            return;
        }
        openForm('copy', activeRow);
    },
});
