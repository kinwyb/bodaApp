/**
 * V0372 织造明细弹窗：对应旧客户端 `Views/Dialog/V0372/ZZDetailForm.cs`。
 * 主表双击越南的织造列打开；存储过程 `Query_BJZZMachineTypeData` 按机型返回月明细。
 * 只读 + 导出（旧弹窗命令条上唯一的按钮就是导出，交给 FilterTable 的 exportName）。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {App, Modal} from 'antd';
import {sqlApi, S, N} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable} from '@/components/grid-table';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {isBlank} from '@/utils';
import {ZZ_MONTH_DETAIL_COLUMNS, ZZ_MONTH_DETAIL_SUMMARY, type ZZMonthDetailRow} from './zzDetailColumns';
import {createZZMonthDetailBridge, type ZZMonthDetailBridgeContext} from './zzDetailBridge';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0018_V0372");


type ZZMonthDetailDto = Omit<ZZMonthDetailRow, '_rowKey'>;

export type ZZMonthDetailModalProps = {
    open: boolean;
    /** 所在页面的 View（界面桥注册用） */
    view: string;
    startDate: string;
    endDate: string;
    orgId: string;
    onClose: () => void;
};

export function ZZMonthDetailModal({open, view, startDate, endDate, orgId, onClose}: ZZMonthDetailModalProps): React.ReactElement {
    const {message} = App.useApp();
    const [rows, setRows] = useState<ZZMonthDetailRow[]>([]);
    const [loading, setLoading] = useState(false);

    const reload = useCallback(async () => {
        if (!open || isBlank(startDate) || isBlank(endDate) || isBlank(orgId)) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const result = await sqlApi.procedure({
                ProcedureName: 'Query_BJZZMachineTypeData',
                Args: {StartDate: startDate, EndDate: endDate, pk_org: orgId},
            });
            const records = result.data?.parseToList<ZZMonthDetailDto>({
                WorkStartDate: S,
                WorkEndDate: S,
                MC_SIZE: S,
                MachineCount: N,
                MachineHours: N,
                ZZTotalNum: N,
                ZZCPNum: N,
                CPRate: N,
                WorkHours: N,
                Efficiency: N,
                UtilizationRate: N,
            }) ?? [];
            setRows(records.map((record, index) => ({...record, _rowKey: String(index)})));
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [open, startDate, endDate, orgId, message]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const bridgeContext = useMemo<ZZMonthDetailBridgeContext>(
        () => ({startDate, endDate, rows, loading, reload, onClose}),
        [startDate, endDate, rows, loading, reload, onClose],
    );
    const dialogBridge = useMemo(() => createZZMonthDetailBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, dialogBridge, open);

    return (
        <Modal
            open={open}
            title={`织造明细（${startDate} ~ ${endDate}）`}
            width={1080}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{height: 420, display: 'flex', flexDirection: 'column'}}>
                <FilterTable
                    columns={ZZ_MONTH_DETAIL_COLUMNS}
                    records={rows}
                    rowKey="_rowKey"
                    loading={loading}
                    showPagination={false}
                    summary={ZZ_MONTH_DETAIL_SUMMARY}
                    exportName={t("月织造数据明细")}
                    emptyTip={t("暂无数据")}
                />
            </div>
        </Modal>
    );
}
