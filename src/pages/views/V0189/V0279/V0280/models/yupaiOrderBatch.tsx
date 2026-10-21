import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, Checkbox, InputNumber, Modal} from 'antd';
import {GridTable, type GridTableApi, type GridTableCellValueChangeInfo,} from '@/components/grid-table';
import {ApiError, yupaiApi, type YupaiOrder} from '@/api';
import {formatDate, isDebugEnv, toNumberOrNull, toNumberOrZero, toStringOrEmpty} from '@/utils';
import {
    batchEditableFields,
    buildBatchColumns,
    buildBatchRows,
    isBatchRowEmpty,
    normalizeBatchDate,
    rebuildBatchTail,
    shouldDefaultByDate,
    sumBatchPercent,
    type YupaiOrderBatchRow,
} from './yupaiOrderBatchColumns.ts';

export interface YupaiOrderBatchModalProps {
    open: boolean;
    /** 要分批的那一单（列表行里已经带了 `Batchs`） */
    order: YupaiOrder | null;
    onCancel: () => void;
    /** 数据确认后回调：接好保存接口时在 handleConfirm 里调 onSaved 即可（当前是关闭弹窗） */
    onSaved: () => void;
}

/** 百分数保留两位，避免 10.1 + 20.2 算出 30.299999999999997 */

/**
 * 预订单分批弹窗。
 *
 * 交互对照原 WinForm 界面：两列表格（分期月份/出货日期 + 出货比例）、
 * 左下「按日期」勾选框、右下只读合计、底部「删除行 / 确定」。
 *
 * 几个刻意为之的点：
 * - **空白行跟着校验走**：只有上一行单行通过（日期 + 比例都填对）且合计还没到 100 时
 *   才在下面留一行空白；合计满了就不再给新行（见 yupaiOrderBatchColumns 的 rebuildBatchTail）；
 * - **行的定位一律用主键 `_id`**：GridTable 回传的 rowIndex 是「当前 records 里的位置」，
 *   排序/增删后与页面这份 rows 对不上（本项目详情表格踩过）；
 * - **日期只有一份存储形态**：按月选也存该月 1 日（见 yupaiOrderBatchColumns 的说明），
 *   保存时不用按模式分叉。
 */
const YupaiOrderBatchModal: React.FC<YupaiOrderBatchModalProps> = ({open, order, onCancel, onSaved}) => {
    const {message} = App.useApp();
    const [rows, setRows] = useState<YupaiOrderBatchRow[]>([]);
    /** 按日期（true）还是按月（false）；默认值见 shouldDefaultByDate */
    const [byDate, setByDate] = useState(false);
    const tableRef = useRef<GridTableApi | null>(null);

    /**
     * 打开时按这一单重新铺数据。
     *
     * 不在这里做「关闭即清空」：内容由 Modal 的 destroyOnHidden 收掉，
     * 下次打开这个 effect 会重新铺一遍 —— 关闭动画期间翻 state 只会让表格重建一次。
     */
    useEffect(() => {
        if (!open) return;
        setByDate(shouldDefaultByDate(order?.Batchs));
        setRows(buildBatchRows(order?.Batchs));
    }, [open, order]);

    const columns = useMemo(() => buildBatchColumns(byDate), [byDate]);
    const editableFields = useMemo(() => batchEditableFields(byDate), [byDate]);

    /** 已填写的行（完全空白的行不参与合计 / 校验 / 提交） */
    const filledRows = useMemo(() => rows.filter((row) => !isBatchRowEmpty(row)), [rows]);

    /** 合计（百分数） */
    const totalPercent = useMemo(() => sumBatchPercent(filledRows), [filledRows]);

    /**
     * 编辑提交：把新值同步回页面这份 rows（保存时读的是它）。
     *
     * GridTable 会**就地改写**它拿到的 record 对象，所以这里必须出新对象，
     * 否则 rows 的引用没变、React 不会重渲染，界面上看到的是「改了但没生效」。
     *
     * 末尾空白行交给 rebuildBatchTail：上一行通过校验且合计 < 100 才留，
     * 否则收起（例如把比例改成让合计到 100，空白行随之消失）。
     */
    const handleCellChange = useCallback(({field, rowIndex, record, value}: GridTableCellValueChangeInfo) => {
        const rowKey = String(record?._id ?? '');
        setRows((prev) => {
            const next = prev.map((row, index) => {
                // 正常走主键；万一拿不到主键（理论上不会）退回行号，宁可保留旧行为也别丢掉这次编辑
                const hit = rowKey ? String(row._id) === rowKey : index === rowIndex;
                if (!hit) return row;
                return {...row, [field]: value};
            });
            /**
             * 正在编辑的恰好是末尾那行空白、又被清空了：原样留着。
             * 交给 rebuildBatchTail 会把它摘掉再补一个新的（主键变了），
             * 正在编辑的单元格会被整表重建打断。
             */
            const editedKey = rowKey || String(next[rowIndex]?._id ?? '');
            const last = next[next.length - 1];
            if (last && editedKey && String(last._id) === editedKey && isBatchRowEmpty(last)) {
                return next;
            }
            return rebuildBatchTail(next);
        });
    }, []);

    /**
     * 切换「按日期 / 按月」：已有行跟着换粒度（日期 → 当月 1 日，月 → 只保留到月）。
     *
     * 这一步会把「按日期」里精确到日的值截到月初，且切回来也找不回原来那一天 ——
     * 这是两种粒度本身的取舍，不是数据丢失 bug：界面上已经按用户要求只让选到月。
     */
    const handleByDateChange = useCallback((checked: boolean) => {
        setByDate(checked);
        setRows((prev) =>
            prev.map((row) =>
                toStringOrEmpty(row.BatchDate) ? {...row, BatchDate: normalizeBatchDate(row.BatchDate, checked)} : row,
            ),
        );
    }, []);

    /**
     * 删除当前激活行。
     *
     * 删完交给 rebuildBatchTail 重算末尾空白行：删掉一行后合计往往又不到 100 了，
     * 空白行该重新出现；删空则保留一行可输入的空白。
     */
    const handleDeleteRow = useCallback(() => {
        const active = tableRef.current?.getActiveRow();
        const rowKey = String(active?.record?._id ?? '');
        if (!rowKey) {
            void message.warning('请先选中要删除的行');
            return;
        }
        setRows((prev) => rebuildBatchTail(prev.filter((row) => String(row._id) !== rowKey)));
    }, [message]);

    /**
     * 确定：先做整表校验（跨行规则只有这里拿得到），通过后把提交数据打印出来。
     *
     * ⚠️ **接口接入点在本函数末尾**：后端分批保存接口还没接，需求是先确认界面与数据结构；
     * 接入时把 console.log 换成保存调用即可，校验与数据组装都不用动。
     */
    const handleConfirm = useCallback(async () => {
        const problems: string[] = [];
        const rowNoOf = (row: YupaiOrderBatchRow): number =>
            rows.findIndex((item) => item._id === row._id) + 1;

        filledRows.forEach((row) => {
            const rowNo = rowNoOf(row);
            if (!toStringOrEmpty(row.BatchDate)) {
                problems.push(`第 ${rowNo} 行：请选择${byDate ? '出货日期' : '分期月份'}`);
            }
            const percent = toNumberOrNull(row.BatchPercent);
            if (percent === null) {
                problems.push(`第 ${rowNo} 行：请填写出货比例`);
            } else if (percent <= 0 || percent > 100) {
                problems.push(`第 ${rowNo} 行：出货比例需在 0~100 之间`);
            }
        });

        // 跨行：同一日期/月份只能有一批（两行一样的话，合起来算还是分开算没有意义）
        const dateRows = new Map<string, number[]>();
        filledRows.forEach((row) => {
            const date = toStringOrEmpty(row.BatchDate);
            if (!date) return;
            const list = dateRows.get(date);
            if (list) list.push(rowNoOf(row));
            else dateRows.set(date, [rowNoOf(row)]);
        });
        dateRows.forEach((rowNos, date) => {
            if (rowNos.length < 2) return;
            const label = byDate ? `出货日期 ${date}` : `分期月份 ${date.slice(0, 7)}`;
            problems.push(`${label} 在分批中重复（第 ${rowNos.join('、')} 行）`);
        });

        // 跨行：比例合计必须 100%（三批 10/70/20 这类数据都是占满的）
        if (filledRows.length > 0 && Math.abs(totalPercent - 100) > 0.001) {
            problems.push(`出货比例合计为 ${totalPercent}%，必须等于 100%`);
        }

        if (problems.length > 0) {
            void message.error({
                content: (
                    <div>
                        <div>分批数据有 {problems.length} 处问题：</div>
                        {problems.slice(0, 6).map((text) => <div key={text}>· {text}</div>)}
                        {problems.length > 6 ? <div>· 其余 {problems.length - 6} 处请检查表格</div> : null}
                    </div>
                ),
                duration: 6,
            });
            return;
        }
        if (filledRows.length < 2) {
            void message.warning('分批至少2条数据');
            return;
        }

        // 提交形态按后端
        if (isDebugEnv) {
            const payload = {
                ID: toStringOrEmpty(order?.ID),
                OrderCode: toStringOrEmpty(order?.OrderCode),
                /** 界面上当前的粒度，接接口时用不到可以删掉（排查问题时有帮助） */
                ByDate: byDate,
                Batchs: filledRows.map((row) => ({
                    BatchDate: toStringOrEmpty(row.BatchDate),
                    // 百分数 → 小数，保留 4 位：33.33% → 0.3333
                    BatchRate: Math.round(toNumberOrZero(row.BatchPercent) * 100) / 10000,
                })),
            };

            // ─── 接口接入点 ─────────────────────────────────────────────────────────
            // 后端分批保存接口尚未接入，这里先把界面数据打出来，接好后替换成保存调用，例如：
            //   await yupaiApi.save([{ID: payload.ID, Batchs: payload.Batchs}]);
            // 成功后照常 message.success(...) + onSaved()。
            console.log('[预订单分批] 界面数据', {byDate, rows: filledRows, payload});
            // ──────────────────────────────────────────────────────────────────────
        }
        const payload = {
            OrderCode: toStringOrEmpty(order?.OrderCode),
            Batchs: filledRows.map((row) => ({
                BatchDate: formatDate(row.BatchDate),
                BatchRate: Math.round(toNumberOrZero(row.BatchPercent) * 100) / 100,
            }))
        };
        try {
            await yupaiApi.batchSave(payload);
            void message.success('分批数据保存成功');
            onSaved();
        } catch (error) {
            void message.error(error instanceof ApiError ? error.message : '分批数据保存失败');
        }
    }, [byDate, filledRows, message, onSaved, order, rows, totalPercent]);

    const totalValid = filledRows.length === 0 || Math.abs(totalPercent - 100) <= 0.001;

    return (
        <Modal
            open={open}
            title="预订单分批"
            width={566}
            destroyOnHidden
            footer={null}
            mask={{closable: false}}
            onCancel={onCancel}
        >
            <div
                style={{
                    height: 420,
                    border: '1px solid #f0f0f0',
                    borderRadius: 4,
                    overflow: 'hidden',
                }}
            >
                <GridTable
                    ref={tableRef}
                    columns={columns}
                    records={rows}
                    rowKey="_id"
                    rowNumber={false}
                    multiSelect={false}
                    autoFillWidth
                    editableFields={editableFields}
                    // 老系统的表格是「点中就改」，弹窗里只有两列，单击编辑最省事
                    editCellTrigger="click"
                    onCellValueChange={handleCellChange}
                    emptyTip="请添加分批"
                />
            </div>

            <div style={{display: 'flex', alignItems: 'center', marginTop: 12}}>
                <Checkbox checked={byDate} onChange={(event) => handleByDateChange(event.target.checked)}>
                    按日期
                </Checkbox>
                <InputNumber
                    readOnly
                    controls={false}
                    value={totalPercent}
                    // 合计不等于 100 时边框标红：这个数决定能不能提交，得一眼看得出来
                    status={totalValid ? undefined : 'error'}
                    style={{marginLeft: 'auto', width: 200}}
                />
            </div>

            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12}}>
                <Button onClick={handleDeleteRow}>删除行</Button>
                <Button type="primary" onClick={() => void handleConfirm()}>
                    确定
                </Button>
            </div>
        </Modal>
    );
};

export default YupaiOrderBatchModal;
