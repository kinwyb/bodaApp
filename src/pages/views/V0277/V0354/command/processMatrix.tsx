import {ToolOutlined} from '@ant-design/icons';
import type {PackBomMatrixCommandFactory} from './types';

/**
 * 工艺矩阵：打开这一份包装 BOM 对应的工艺矩阵。
 *
 * 跳转需要知道「菜单里那个页面怎么打开」，那是页面的能力（`openProcessMatrix`），
 * 所以命令只负责「要求先选一行」，怎么过去交给页面。
 */
export const processMatrixCommand: PackBomMatrixCommandFactory = ({
    message,
    activeRow,
    hasSelection,
    openProcessMatrix,
}) => ({
    key: 'processMatrix',
    label: '工艺矩阵',
    icon: <ToolOutlined/>,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一行矩阵');
            return;
        }
        openProcessMatrix(activeRow);
    },
});
