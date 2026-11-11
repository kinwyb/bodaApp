import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App} from 'antd';
import type {YupaiOrderCompleteDeliverPlanRow} from '@/api';
import {ErrorMessage} from '@/api/request';
import {CommandBar} from '@/components/CommandBar';
import {FilterTable, type FilterTableApi} from '@/components/grid-table';
import {PageBreadcrumb} from '@/components/PageBreadcrumb';
import {useUIBridgeHost} from '@/pages/agent/ui-bridge';
import type {ViewPageProps} from '@/pages/types';
import {yupaiService} from '@/services/yupai';
import {createDeliverPlanBridge, type DeliverPlanBridgeContext} from './bridged';
import {useDeliverPlanCommands, type DeliverPlanCommandContext} from './command';
import {DELIVER_PLAN_COLUMNS} from './columns';

/**
 * V0189_V0279_V0296 计划管理 > 已下单分期。
 *
 * 旧窗体只有一个 FilterTable 对应控件；导出交给表格，刷新放在页面命令条。
 * `Batch` 与 `ZHMonth` 由服务层按旧客户端的运行时属性规则补齐。
 */
const DeliverPlanPage: React.FC<ViewPageProps> = ({view, trail}) => {
    const {message, modal} = App.useApp();
    const tableRef = useRef<FilterTableApi | null>(null);
    const [rows, setRows] = useState<YupaiOrderCompleteDeliverPlanRow[]>([]);
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            setRows(await yupaiService.completeDeliverPlan());
        } catch (error) {
            void message.error(ErrorMessage(error, '数据加载失败'));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const commandContext = useMemo<DeliverPlanCommandContext>(() => ({
        message,
        modal,
        tableRef,
        reload: loadData,
    }), [message, modal, loadData]);
    const commands = useDeliverPlanCommands(commandContext);

    const bridgeContext = useMemo<DeliverPlanBridgeContext>(() => ({
        view,
        readTable: () => tableRef.current,
        commands,
    }), [view, commands]);
    const bridge = useMemo(() => createDeliverPlanBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeHost(view, bridge);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <CommandBar view={view} items={commands}/>
            <FilterTable
                ref={tableRef}
                columns={DELIVER_PLAN_COLUMNS}
                records={rows}
                rowKey="_rowKey"
                loading={loading}
                emptyTip="没有任何记录"
                exportName="已下单分批"
                showSummary={false}
                groupable
            />
        </div>
    );
};

export default DeliverPlanPage;
