import {ApartmentOutlined} from '@ant-design/icons';
import type {YupaiOrderBatchCommandFactory} from './types';

/**
 * 分批：对**当前激活的那一行**设置出货分批（月份/日期 + 比例）。
 *
 * 为什么看 activeRow 而不是 hasSelection：分批是针对「某一单」的操作，
 * 多选时该给谁分批取决于用户此刻聚焦的那一行；只有一行被选中时两者恰好一致。
 *
 * 用 YupaiOrderBatchCommandFactory（这一组专属类型）而不是本页通用工厂：
 * 只有这组命令能解构出 openBatch ——「打开分批弹窗」不进公共依赖。
 */
export const batchCommand: YupaiOrderBatchCommandFactory = ({activeRow, openBatch}) => ({
    key: 'assign',
    label: '分批',
    icon: <ApartmentOutlined/>,
    dividerBefore: true,
    disabled: !activeRow,
    onClick: () => {
        // 兜底：按钮本该已经禁用，这里防的是键盘 / 程序化触发
        if (!activeRow) return;
        openBatch(activeRow);
    },
});
