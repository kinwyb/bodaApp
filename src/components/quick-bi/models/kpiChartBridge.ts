/**
 * 指标图表弹窗的界面桥：打开期间顶掉页面层，关闭后自动恢复。
 * 只放常量与纯函数；弹窗组件在 `kpiChart.tsx`。
 */
import type {UIDialogHost} from '@/pages/agent/ui-bridge';

export type KpiChartType = 'line' | 'bar';

export type KpiChartPoint = {
    Month: string;
    Value: number;
};

export type KpiChartBridgeContext = {
    kpi: string;
    chartType: KpiChartType;
    points: KpiChartPoint[];
    /** 是否百分比指标（原值带 %，这里已换算成百分数数值，如 95.5） */
    isRate: boolean;
    setChartType: (type: KpiChartType) => void;
    onClose: () => void;
};

export function createKpiChartBridge(read: () => KpiChartBridgeContext): UIDialogHost {
    return {
        snapshot: () => {
            const ctx = read();
            return {
                id: 'kpiChart',
                title: `指标图表（${ctx.kpi}）`,
                mode: 'view',
                recordId: ctx.kpi,
                fields: [
                    {id: 'KPI', label: '指标', type: 'text', value: ctx.kpi, readOnly: true},
                    {
                        id: 'ChartType',
                        label: '图表类型',
                        type: 'select',
                        options: ['line', 'bar'],
                        value: ctx.chartType,
                        hint: 'line 折线 / bar 柱状',
                    },
                    {
                        id: 'Points',
                        label: '月度数据',
                        type: 'text',
                        value: JSON.stringify(ctx.points),
                        readOnly: true,
                        hint: ctx.isRate
                            ? 'JSON 数组 {Month, Value}；Value 是百分数数值（95.5 表示 95.5%）'
                            : 'JSON 数组 {Month, Value}；Month 是主表的月份列名',
                    },
                ],
                errors: [],
            };
        },
        actions: () => [
            {
                id: 'chart.setType',
                label: '切换图表类型',
                group: 'form',
                params: [{name: 'type', type: 'select', hint: 'line 折线 / bar 柱状'}],
            },
            {id: 'form.cancel', label: '关闭', group: 'form'},
        ],
        handlers: {
            'chart.setType': (params) => {
                const type = params.type;
                if (type !== 'line' && type !== 'bar') {
                    return 'type 只认 line / bar';
                }
                read().setChartType(type);
                return `已切换为${type === 'line' ? '折线' : '柱状'}图`;
            },
            'form.cancel': () => {
                read().onClose();
                return '已关闭指标图表';
            },
        },
        guide: {
            summary: '指标图表：把主表中所选指标在各月份列上的值画成折线/柱状图（对应旧客户端 QuickBIChartForm）',
            cautions: [
                '数据来自主表当前已查回的行，不另发请求；换年份/组织要先关弹窗、用页面 query.set 重查',
                '百分比指标的 Value 已换算成百分数数值（95.5 表示 95.5%），不要再除以 100',
            ],
        },
    };
}
