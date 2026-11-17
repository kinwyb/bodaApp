import {LineChartOutlined} from '@ant-design/icons';
import {isBlank, toStringOrEmpty} from '@/utils';
import type {QuickBICommandFactory} from './types';

/**
 * 图表：取主表激活行的「指标」，打开折线/柱状弹窗（C# chartBtn_ItemClick）。
 * C# 没有配权限 GUID，按钮对所有人可见，这里不填 permission。
 */
export const chartCommand: QuickBICommandFactory = ({message, activeRow, hasSelection, openChart}) => ({
    key: 'chart',
    label: '图表',
    icon: <LineChartOutlined/>,
    disabled: !hasSelection,
    onClick: () => {
        const kpi = toStringOrEmpty(activeRow?.['指标']);
        if (isBlank(kpi)) {
            void message.warning('请先选中一行有指标的数据');
            return;
        }
        openChart(kpi);
    },
});
