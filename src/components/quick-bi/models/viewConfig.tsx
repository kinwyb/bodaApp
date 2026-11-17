/**
 * QuickBI 明细配置弹窗：对应旧客户端 `Views/Dialog/QuickBIViewConfigForm.cs`（仅超管）。
 * 维护 [transitDB].dbo.BIViewConfig：主表「业务单元_指标」点开后的明细标签页配置。
 * BIGroup 由各页面的 caption 传入（C# getCaption()）。
 *
 * 与 C# 逐项对应：
 * - 加载：SELECT * FROM BIViewConfig WHERE BIGroup = 研发分析 AND OrgID = 当前查询组织；
 * - 编辑 / 保存按钮切换表格编辑态；单元格提交即整行调 BIViewSave(SAVE)，返回 ID 回填主键
 *   （C# gridView1_RowUpdated 在行提交时保存，这里粒度是格提交，保存内容一致）；
 * - 新增行预填 BIGroup / OrgID（C# InitNewRow）；删除行调 BIViewSave(DEL)，无二次确认（与 C# 一致）。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, Modal, Space} from 'antd';
import {DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined} from '@ant-design/icons';
import {sqlApi, N, S} from '@/api';
import {ErrorMessage} from '@/api/request';
import {
    GridTable,
    type AppColumnDef,
    type GridTableCellValueChangeInfo,
    type GridTableSelectedRowChangeInfo,
} from '@/components/grid-table';
import {registerAntdSelectEditor} from '@/components/grid-table/editors/register';
import {useUIBridgeDialog} from '@/pages/agent/ui-bridge';
import {ORG_NAME, ORG_SELECT_OPTIONS} from '@/store/orgs';
import {isBlank, toStringOrEmpty} from '@/utils';
import type {BiViewConfig} from '../types';
import {createViewConfigBridge, type ViewConfigBridgeContext} from './viewConfigBridge';

type ConfigRow = BiViewConfig & {_rowKey: string};

const CONFIG_COLUMNS: AppColumnDef[] = [
    {field: 'BIWork', title: '业务单元', minWidth: 120},
    {field: 'BIKPI', title: '指标', minWidth: 120},
    {field: 'BITag', title: '标签页', minWidth: 90},
    {field: 'BISQL', title: '存储过程', minWidth: 240},
    {field: 'SortNo', title: '排序', width: 70, dataType: 'int' as const},
    // 显示组织名称（store ORG_NAME），编辑走下拉选名称、落库仍是 ID
    {field: 'OrgID', title: '组织', minWidth: 140, fieldFormat: (record) => ORG_NAME(record.OrgID)},
];

/** 组织列专用下拉编辑器：候选来自 store，显示名称、值是 ID（具名注册，避免串到公共自动编辑器） */
registerAntdSelectEditor('quick-bi-config-org', {options: ORG_SELECT_OPTIONS});

const CONFIG_EDITABLE_FIELDS = {
    BIWork: true, BIKPI: true, BITag: true, BISQL: true, SortNo: true,
    OrgID: 'quick-bi-config-org',
} as const;

/** 组织 ID（可能逗号分隔多个）→ 名称串，标题用 */
function orgNames(orgId: string): string {
    return orgId.split(',').map((id) => ORG_NAME(id)).filter((name) => name !== '').join('、');
}

export type ViewConfigModalProps = {
    open: boolean;
    /** 所在页面的 View（界面桥注册用） */
    view: string;
    /** BIGroup：页面标题（C# getCaption()） */
    biGroup: string;
    /** 当前查询的组织（C# 传 this.orgID，即最近一次查询的 OrgPK） */
    orgId: string;
    onClose: () => void;
};

export function ViewConfigModal({open, view, biGroup, orgId, onClose}: ViewConfigModalProps): React.ReactElement {
    const {message} = App.useApp();
    const [rows, setRows] = useState<ConfigRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [activeRow, setActiveRow] = useState<ConfigRow | null>(null);
    const newRowSeq = useRef(0);

    const reload = useCallback(async () => {
        if (!open) return;
        setLoading(true);
        try {
            const res = await sqlApi.query({
                SQL: 'SELECT * FROM [transitDB].dbo.BIViewConfig WHERE BIGroup = ? AND OrgID = ?',
                Args: [biGroup, orgId],
            });
            const list = res.data?.parseToList<BiViewConfig>({
                BIViewConfigID: S, BIGroup: S, BIWork: S, BIKPI: S, BITag: S, BISQL: S, OrgID: S, SortNo: N,
            }) ?? [];
            setRows(list.map((row, index) => ({...row, _rowKey: toStringOrEmpty(row.BIViewConfigID) || `row_${index}`})));
        } catch (error) {
            void message.error(ErrorMessage(error, '配置加载失败'));
        } finally {
            setLoading(false);
        }
    }, [open, biGroup, orgId, message]);

    useEffect(() => {
        void reload();
    }, [reload]);

    /** 整行保存（C# RowUpdated → BIViewSave SAVE），返回的 ID 回填主键 */
    const saveRow = useCallback(async (row: ConfigRow) => {
        try {
            const args: Record<string, string> = {
                action: 'SAVE',
                group: row.BIGroup,
                work: row.BIWork,
                kpi: row.BIKPI,
                tag: row.BITag,
                sql: row.BISQL,
                orgID: row.OrgID,
                sortNo: String(row.SortNo),
            };
            if (!isBlank(row.BIViewConfigID)) {
                args.configID = row.BIViewConfigID;
            }
            const res = await sqlApi.procedure({ProcedureName: '[transitDB].dbo.BIViewSave', Args: args});
            const id = toStringOrEmpty(res.data?.DataVals?.[0]?.['ID']);
            if (isBlank(id)) {
                void message.error('保存失败：接口没有返回主键');
                return;
            }
            setRows((prev) => prev.map((item) => (
                item._rowKey === row._rowKey ? {...item, BIViewConfigID: id} : item
            )));
        } catch (error) {
            void message.error(ErrorMessage(error, '保存失败'));
        }
    }, [message]);

    const handleCellValueChange = useCallback((info: GridTableCellValueChangeInfo) => {
        const key = toStringOrEmpty(info.record?._rowKey);
        if (isBlank(key)) return;
        const field = info.field;
        const value = info.value;
        // vtable 提交时已直接改写 record，这里以它为准拼出整行；保存放在 updater 外，避免 StrictMode 双调
        const updated = {...(info.record as ConfigRow), [field]: value};
        setRows((prev) => prev.map((row) => (row._rowKey === key ? updated : row)));
        void saveRow(updated);
    }, [saveRow]);

    const addRow = useCallback(() => {
        newRowSeq.current += 1;
        setRows((prev) => [...prev, {
            _rowKey: `new_${newRowSeq.current}`,
            BIViewConfigID: '',
            BIGroup: biGroup,
            BIWork: '',
            BIKPI: '',
            BITag: '',
            BISQL: '',
            OrgID: orgId,
            SortNo: 0,
        }]);
        setEditing(true);
    }, [biGroup, orgId]);

    const deleteActiveRow = useCallback(async (): Promise<string> => {
        if (!activeRow) {
            return '没有选中的配置行：请先在表格里选中一行';
        }
        // 还没落库的新行直接移除，不用调 DEL
        if (isBlank(activeRow.BIViewConfigID)) {
            setRows((prev) => prev.filter((row) => row._rowKey !== activeRow._rowKey));
            setActiveRow(null);
            return '已移除未保存的新行';
        }
        try {
            await sqlApi.procedure({
                ProcedureName: '[transitDB].dbo.BIViewSave',
                Args: {action: 'DEL', configID: activeRow.BIViewConfigID},
            });
            setRows((prev) => prev.filter((row) => row._rowKey !== activeRow._rowKey));
            setActiveRow(null);
            return `已删除配置「${activeRow.BIWork}_${activeRow.BIKPI} / ${activeRow.BITag}」`;
        } catch (error) {
            const text = ErrorMessage(error, '删除失败');
            void message.error(text);
            return text;
        }
    }, [activeRow, message]);

    const handleSelectedChange = useCallback((info: GridTableSelectedRowChangeInfo) => {
        setActiveRow((info.record as ConfigRow | undefined) ?? null);
    }, []);

    const bridgeContext = useMemo<ViewConfigBridgeContext>(() => ({
        orgId, rows, loading, editing, reload, addRow, deleteActiveRow, setEditing, onClose,
    }), [orgId, rows, loading, editing, reload, addRow, deleteActiveRow, onClose]);
    const dialogBridge = useMemo(() => createViewConfigBridge(() => bridgeContext), [bridgeContext]);
    useUIBridgeDialog(view, dialogBridge, open);

    return (
        <Modal
            open={open}
            title={`配置明细（${orgNames(orgId)}）`}
            width={960}
            footer={null}
            destroyOnHidden
            onCancel={onClose}
        >
            <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
                <Space>
                    <Button icon={<PlusOutlined/>} onClick={addRow}>新增</Button>
                    <Button
                        icon={editing ? <SaveOutlined/> : <EditOutlined/>}
                        type={editing ? 'primary' : 'default'}
                        onClick={() => setEditing((prev) => !prev)}
                    >
                        {editing ? '保存' : '编辑'}
                    </Button>
                    <Button danger icon={<DeleteOutlined/>} disabled={!activeRow} onClick={() => void deleteActiveRow()}>
                        删除
                    </Button>
                </Space>
                <div style={{height: 360, display: 'flex', flexDirection: 'column'}}>
                    <GridTable
                        columns={CONFIG_COLUMNS}
                        records={rows}
                        rowKey="_rowKey"
                        loading={loading}
                        editableFields={editing ? CONFIG_EDITABLE_FIELDS : undefined}
                        onCellValueChange={handleCellValueChange}
                        onSelectedChange={handleSelectedChange}
                        emptyTip="暂无配置"
                    />
                </div>
            </div>
        </Modal>
    );
}
