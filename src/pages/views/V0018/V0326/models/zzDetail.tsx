/**
 * V0326 织造明细弹窗：对应旧客户端 `Views/Dialog/V0326/ZZDetailForm.cs`。
 * 主表双击织造列打开；SQL 直查 transitDB 的周数据长表（DataType=2），
 * 按机型（ExtendVal1）透视成一行一机型。只读，无导出（旧弹窗就没有导出按钮）。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {App, Modal} from 'antd';
import {sqlApi} from '@/api';
import {ErrorMessage} from '@/api/request';
import {FilterTable} from '@/components/grid-table';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {isBlank, toNumberOrNull} from '@/utils';
import {PRODUCTION_ORGS} from '../../productionShared';
import {ZZ_DETAIL_COLUMNS, ZZ_DETAIL_FIELDS, ZZ_DETAIL_SUMMARY, type ZZDetailRow} from './zzDetailColumns';
import {createZZDetailBridge, type ZZDetailBridgeContext} from './zzDetailBridge';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0018_V0326");


const ZZ_DETAIL_SQL =
    'SELECT * FROM [transitDB].dbo.ProductionWeekData WHERE IsDel = 0 AND DataType = 2 AND StartDate = ? AND EndDate = ? AND OrgID = ? ORDER BY ExtendVal1,DataField';

export type ZZDetailModalProps = {
    open: boolean;
    /** 所在页面的 View（界面桥注册用） */
    view: string;
    startDate: string;
    endDate: string;
    orgId: string;
    onClose: () => void;
};

export function ZZDetailModal({open, view, startDate, endDate, orgId, onClose}: ZZDetailModalProps): React.ReactElement {
    const {message} = App.useApp();
    const [rows, setRows] = useState<ZZDetailRow[]>([]);
    const [loading, setLoading] = useState(false);

    const orgName = PRODUCTION_ORGS.find((org) => org.id === orgId)?.name ?? orgId;

    const reload = useCallback(async () => {
        if (!open || isBlank(startDate) || isBlank(endDate) || isBlank(orgId)) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const result = await sqlApi.query({SQL: ZZ_DETAIL_SQL, Args: [startDate, endDate, orgId]});
            // 长表 → 一行一机型（旧客户端 dataParse 的 rowDic 透视）
            const bySize = new Map<string, ZZDetailRow>();
            for (const record of result.data?.DataVals ?? []) {
                const size = record['ExtendVal1'] ?? '';
                let row = bySize.get(size);
                if (!row) {
                    row = {MSize: size, _rowKey: size};
                    bySize.set(size, row);
                }
                const field = record['DataField'] as (typeof ZZ_DETAIL_FIELDS)[number];
                if (ZZ_DETAIL_FIELDS.includes(field)) {
                    const value = toNumberOrNull(record['DataValue']);
                    if (value !== null) row[field] = value;
                }
            }
            setRows([...bySize.values()]);
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [open, startDate, endDate, orgId, message]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const bridgeContext = useMemo<ZZDetailBridgeContext>(
        () => ({startDate, endDate, orgName, rows, loading, reload, onClose}),
        [startDate, endDate, orgName, rows, loading, reload, onClose],
    );
    const dialogBridge = useMemo(() => createZZDetailBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, dialogBridge, open);

    return (
        <Modal
            open={open}
            title={`织造明细（${startDate} ~ ${endDate} · ${orgName}）`}
            width={860}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{height: 420, display: 'flex', flexDirection: 'column'}}>
                <FilterTable
                    columns={ZZ_DETAIL_COLUMNS}
                    records={rows}
                    rowKey="_rowKey"
                    loading={loading}
                    showPagination={false}
                    summary={ZZ_DETAIL_SUMMARY}
                    emptyTip={t("暂无数据")}
                />
            </div>
        </Modal>
    );
}
