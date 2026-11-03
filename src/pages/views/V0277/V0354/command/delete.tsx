import {DeleteOutlined} from '@ant-design/icons';
import {toStringOrEmpty} from '@/utils';
import type {PackBomMatrixCommandFactory} from './types';

/**
 * 删除：删掉选中的那一份矩阵。
 *
 * **还没接后端**（没有删除接口）。接上之后照 V0189 的写法来做：
 * `modal.confirm` 确认 → 调 api → `reload()`。确认框用 context 里的 `modal`，
 * 不要用 antd 的静态方法（拿不到 App 的主题与上下文）。
 */
export const deleteCommand: PackBomMatrixCommandFactory = ({message, activeRow, hasSelection}) => ({
    key: 'delete',
    label: '删除',
    icon: <DeleteOutlined/>,
    danger: true,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一行矩阵');
            return;
        }
        void message.info(`删除「${toStringOrEmpty(activeRow.PackMaterialCode)}」：删除接口还没接入`);
    },
});
