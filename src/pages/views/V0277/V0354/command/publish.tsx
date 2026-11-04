import {CloudUploadOutlined} from '@ant-design/icons';
import type {PackBomMatrixCommandFactory} from './types';

/**
 * 发布：打开「包装BOM矩阵明细」弹窗，对选中矩阵的规则做发布 / 取消发布 / 更新。
 *
 * 命令只负责「打开哪一份」：真正取规则、调接口、刷新发布状态都在
 * `../models/bomMatrixPush`（与编辑弹窗的「生成」共用同一个弹窗）。
 * 编辑弹窗里的人点「生成」走的是同一份实现，不必在这里再写一遍。
 */
export const publishCommand: PackBomMatrixCommandFactory = ({activeRow, hasSelection, openPush}) => ({
    key: 'publish',
    label: '发布',
    icon: <CloudUploadOutlined/>,
    dividerBefore: true,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) return;
        openPush(activeRow);
    },
});
