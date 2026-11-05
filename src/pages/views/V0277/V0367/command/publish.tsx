import {CloudUploadOutlined} from '@ant-design/icons';
import type {ProcessRouteMatrixCommandFactory} from './types';

/**
 * 发布：打开「工艺路线矩阵明细」弹窗，对选中矩阵的规则做发布 / 取消发布 / 更新。
 *
 * 命令只负责「打开哪一份」：真正取规则、调接口、刷新发布状态都在通用弹窗里
 * （`components/nc/matrixPushModal`，与包装 BOM 共用一份实现）。
 */
export const publishCommand: ProcessRouteMatrixCommandFactory = ({activeRow, hasSelection, openPush}) => ({
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
