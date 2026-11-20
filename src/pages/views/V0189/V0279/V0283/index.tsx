import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App} from 'antd';
import type {YupaiOrder} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {
    FilterTable,
    type FilterTableApi,
    type GridTableCellStyleHook,
    type GridTableSelectedRowChangeInfo,
} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {emitActiveUIEvent, useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {SUPER_ADMIN_USER_ID} from '@/services';
import {yupaiService} from '@/services/yupai';
import {useAuth} from '@/store/auth-context';
import {toStringOrEmpty} from '@/utils';
import {createYupaiCancelledBridge, type YupaiCancelledBridgeContext} from './bridged';
import {YUPAI_CANCELLED_COLUMNS} from './columns';
import {
    useYupaiCancelledCommands,
    type YupaiCancelledCommandContext,
} from './command';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0189_V0279_V0283");


/**
 * V0189_V0279_V0283 计划管理 > 预订单 > 预排取消列表
 *
 * 旧页面只有一张已取消列表：
 * - 「恢复」支持多选，调用 `/plan/yupaiOrder/reset`；
 * - 「删除」只处理当前激活行，调用 `/plan/yupaiOrder/remove`；
 * - 「刷新」不迁移，操作成功后由 reload 重新加载；
 * - 「导出」交给 FilterTable 的 exportName。
 */
const YupaiCancelledPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const {userInfo} = useAuth();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [dataSource, setDataSource] = useState<YupaiOrder[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeRow, setActiveRow] = useState<YupaiOrder | null>(null);
    const activeRowRef = useRef<YupaiOrder | null>(null);
    const [activeRowCount, setActiveRowCount] = useState(0);

    const isSuperUser = userInfo?.UserID === SUPER_ADMIN_USER_ID;

    const loadData = useCallback(async () => {
        tableRef.current?.clearSelection();
        setLoading(true);
        try {
            const orders = await yupaiService.deletedList();
            // 与旧客户端一致：非超级管理员只看到自己创建的取消记录。
            const visibleOrders = isSuperUser
                ? orders
                : orders.filter((order) => toStringOrEmpty(order.CreateUserNo) === userInfo?.EmpID);
            setDataSource(visibleOrders);
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [isSuperUser, message, userInfo?.EmpID]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const getSelectedRows = useCallback((): YupaiOrder[] => {
        const rows = tableRef.current?.getSelection().rows ?? [];
        const ids = new Set(dataSource.map((row) => row.ID));
        return rows.filter((row) => ids.has((row as YupaiOrder).ID)) as YupaiOrder[];
    }, [dataSource]);

    const handleSelectedChange = useCallback(
        (info: GridTableSelectedRowChangeInfo) => {
            const record = info.record as YupaiOrder | undefined;
            const next = !record || info.isSummaryRow || !dataSource.some((row) => row.ID === record.ID)
                ? null
                : record;
            activeRowRef.current = next;
            setActiveRow(next);
            emitActiveUIEvent('selection.change', {
                table: 'data',
                rowId: next?.ID ?? null,
            });
        },
        [dataSource],
    );

    const hasSelection = activeRowCount > 0;

    const commandContext = useMemo<YupaiCancelledCommandContext>(() => ({
        message,
        modal,
        tableRef,
        getSelectedRows,
        activeRow,
        hasSelection,
        reload: loadData,
    }), [activeRow, getSelectedRows, hasSelection, loadData, message, modal]);

    const commands = useYupaiCancelledCommands(commandContext);

    const cellStyle = useCallback<GridTableCellStyleHook>((info) => {
        if (!info.record || info.isSummaryRow) return undefined;
        const record = info.record as YupaiOrder;
        return record.Status === 0 ? {textColor: '#389e0d'} : undefined;
    }, []);

    const readTable = useCallback(() => tableRef.current, []);
    const readActiveRow = useCallback(() => activeRowRef.current, []);

    const bridgeContext = useMemo<YupaiCancelledBridgeContext>(() => ({
        view,
        commands,
        activeRow,
        activeRowCount,
        readTable,
        readActiveRow,
    }), [activeRow, activeRowCount, commands, readActiveRow, readTable, view]);

    const bridge = useMemo(() => createYupaiCancelledBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            {commands.length > 0 && <CommandBar view={view} items={commands}/>}
            <FilterTable
                ref={tableRef}
                columns={YUPAI_CANCELLED_COLUMNS}
                records={dataSource}
                rowKey="ID"
                multiSelect
                loading={loading}
                emptyTip={loading ? '加载中…' : '没有任何记录'}
                exportName={t("预排取消列表")}
                cellStyle={cellStyle}
                onActiveSelectionChange={(info) => setActiveRowCount(info.rowCount)}
                onSelectedChange={handleSelectedChange}
            />
        </div>
    );
};

export default YupaiCancelledPage;
