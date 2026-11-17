/**
 * QuickBI 指标图表弹窗：对应旧客户端 `Views/Dialog/QuickBIChartForm.cs`。
 * 命令条「图表」打开：取主表中所选「指标」在各月份列（列名含「月份」）上的值，
 * 折线 / 柱状切换（C# barEditItem1 的两项下拉）。
 *
 * 与 C# 的一处口径说明：C# 把「95.5%」除以 100 后用 {V:P} 显示回百分数；
 * 图表组件的刻度/标签是通用数值格式，这里直接保留百分数数值（95.5），
 * 系列名带「(%)」标注 —— 显示语义一致，不改公共图表组件。
 */
import React, {useMemo, useState} from 'react';
import {Modal, Segmented} from 'antd';
import {LineChart, StackedBarChart} from '@/components/charts';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {toStringOrEmpty} from '@/utils';
import {UNCLICK_COLUMNS} from '../columns';
import type {KpiRecord} from '../types';
import {createKpiChartBridge, type KpiChartBridgeContext, type KpiChartPoint, type KpiChartType} from './kpiChartBridge';

export type KpiChartModalProps = {
    open: boolean;
    /** 所在页面的 View（界面桥注册用） */
    view: string;
    /** 所选指标名（主表「指标」列的值） */
    kpi: string;
    /** 主表当前数据（图表从同一份 records 派生，不另发请求） */
    records: KpiRecord[];
    onClose: () => void;
};

/** 从主表数据派生图表点：指标匹配的行 × 列名含「月份」的列（C# getBindingSource） */
function derivePoints(records: KpiRecord[], kpi: string): {points: KpiChartPoint[]; isRate: boolean} {
    const points: KpiChartPoint[] = [];
    let isRate = false;
    for (const row of records) {
        if (toStringOrEmpty(row['指标']) !== kpi) continue;
        for (const field of Object.keys(row)) {
            if (UNCLICK_COLUMNS.includes(field) || !field.includes('月份')) continue;
            let text = toStringOrEmpty(row[field]);
            if (text === '') {
                text = '0';
            } else if (text.endsWith('%')) {
                isRate = true;
                text = text.slice(0, -1);
            }
            const value = Number(text);
            if (!Number.isNaN(value)) {
                points.push({Month: field, Value: value});
            }
        }
    }
    return {points, isRate};
}

export function KpiChartModal({open, view, kpi, records, onClose}: KpiChartModalProps): React.ReactElement {
    const [chartType, setChartType] = useState<KpiChartType>('line');

    const {points, isRate} = useMemo(() => derivePoints(records, kpi), [records, kpi]);
    const series = useMemo(
        () => [{field: 'Value', name: isRate ? `${kpi}(%)` : kpi}],
        [kpi, isRate],
    );

    const bridgeContext = useMemo<KpiChartBridgeContext>(
        () => ({kpi, chartType, points, isRate, setChartType, onClose}),
        [kpi, chartType, points, isRate, onClose],
    );
    const dialogBridge = useMemo(() => createKpiChartBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, dialogBridge, open);

    return (
        <Modal
            open={open}
            title={`指标图表（${kpi}）`}
            width={860}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                <Segmented
                    value={chartType}
                    onChange={(value) => setChartType(value as KpiChartType)}
                    options={[
                        {label: '折线图', value: 'line'},
                        {label: '柱状图', value: 'bar'},
                    ]}
                    style={{alignSelf: 'flex-start'}}
                />
                <div style={{height: 400}}>
                    {chartType === 'line' ? (
                        <LineChart
                            data={points}
                            xField="Month"
                            series={series}
                            showDots={points.length <= 12}
                            showLabels={points.length <= 12}
                        />
                    ) : (
                        <StackedBarChart data={points} xField="Month" series={series} stacked={false}/>
                    )}
                </div>
            </div>
        </Modal>
    );
}
