import {CloudUploadOutlined} from '@ant-design/icons';
import {toStringOrEmpty} from '@/utils';
import type {PackBomMatrixCommandFactory} from './types';

/**
 * 发布：把选中矩阵的发布规则推给下游（NC）。
 *
 * **还没接后端**：这个模块目前只有 `pushRule` 的查询接口，没有发布接口。
 * 所以这里如实说明缺什么，而不是假装成功 —— 用户会以为数据已经推过去了。
 * 接上接口后改成「确认 → 调 api → reload」，`types.ts` 里的依赖不用动。
 */
export const publishCommand: PackBomMatrixCommandFactory = ({message, activeRow, hasSelection}) => ({
    key: 'publish',
    label: '发布',
    icon: <CloudUploadOutlined/>,
    dividerBefore: true,
    disabled: !hasSelection,
    onClick: () => {
        if (!activeRow) {
            void message.warning('请先选中一行矩阵');
            return;
        }
        void message.info(`发布「${toStringOrEmpty(activeRow.PackMaterialCode)}」：发布接口还没接入`);
    },
});
