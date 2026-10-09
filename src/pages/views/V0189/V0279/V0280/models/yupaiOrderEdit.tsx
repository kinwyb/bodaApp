import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Skeleton} from 'antd';
import dayjs, {type Dayjs} from 'dayjs';
import {ApiError, employeeApi, yupaiApi, YupaiMachineSizeHeader, type YupaiOrder} from '@/api';
import {
    VTable,
    type VTableApi,
    type VTableCellStyleHook,
    type VTableCellValueChangeInfo,
    type VTableMenuConfig
} from '@/components/VTable';
import {EmployeeQuickSelect} from '@/components/quick-select';
import {
    buildPreorderDetailColumns,
    createDetailRow,
    DETAIL_EDITOR_FIELDS,
    type yupaiOrderDetailRow,
} from './yupaiOrderEditColumns.ts';
import {validateYupaiOrderDetailRows, yupaiService} from "@/services/yupai.ts";
import {DATE_FORMAT, toDateString, toDayjs, toNumberOrNullIfZero, toNumberOrZero} from '@/utils';

interface yupaiOrderFormValues {
    OrderCode?: string;
    YPDate?: Dayjs;
    Ywy?: string;
    WorkPlace?: string;
    JHDate?: Dayjs;
    QRDate?: Dayjs;
    WCDate?: Dayjs;
    ZHDate?: Dayjs;
    YLDate?: Dayjs;
    FLDate?: Dayjs;
    BZFLDate?: Dayjs;
    XDRate?: string;
    Qty?: number;
    Memo?: string;
    ZQCheckDate?: Dayjs;
    ZQCheckMemo?: string;
}

export interface yupaiOrderFormModalProps {
    open: boolean;
    mode: 'add' | 'edit' | 'view';
    record?: YupaiOrder | null;
    workPlaces: string[];
    disabled?: boolean;
    onCancel: () => void;
    onSaved: () => void;
}

/**
 * 单元格错误的键：行主键 + 字段。
 * 用主键而不是行号 —— 表格排序后行号会变，主键不会，标红/清错都不会串行。
 */
const cellErrorKey = (rowKey: string, field: string): string => `${rowKey}#${field}`;

/** 服务层返回「行主键 → 字段 → 提示」，这里拍平成「行主键#字段 → 提示」的错误表 */
const toCellErrors = (byRow: Record<string, Record<string, string>>): Record<string, string> => {
    const flat: Record<string, string> = {};
    Object.entries(byRow).forEach(([rowKey, fields]) => {
        Object.entries(fields).forEach(([field, message]) => {
            flat[cellErrorKey(rowKey, field)] = message;
        });
    });
    return flat;
};

const buildValues = (record?: YupaiOrder | null): yupaiOrderFormValues => {
    if (!record) {
        return {YPDate: dayjs(), Qty: 0};
    }
    return {
        OrderCode: String(record.OrderCode ?? ''),
        YPDate: toDayjs(record.YPDate),
        Ywy: String(record.Ywy ?? ''),
        WorkPlace: String(record.WorkPlace ?? ''),
        JHDate: toDayjs(record.JHDate),
        QRDate: toDayjs(record.QRDate),
        WCDate: toDayjs(record.WCDate),
        ZHDate: toDayjs(record.ZHDate),
        YLDate: toDayjs(record.YLDate),
        FLDate: toDayjs(record.FLDate),
        BZFLDate: toDayjs(record.BZFLDate),
        XDRate: String(record.XDRate ?? ''),
        Qty: Number(record.Qty) || 0,
        Memo: String(record.Memo ?? ''),
        ZQCheckDate: toDayjs(record.ZQCheckDate),
        ZQCheckMemo: String(record.ZQCheckMemo ?? ''),
    };
};

/**
 * 未落库的空白 / 新增行的临时主键。
 *
 * 必须唯一：VTable 用它当 rowKey（重复会导致行错位），页面也靠它定位「编辑的是哪一行」。
 * 用模块级自增而不是行号，弹窗反复开关也不会撞。
 */
let draftRowSeq = 0;
const nextDraftRowKey = (): string => {
    draftRowSeq += 1;
    return `draft-${draftRowSeq}`;
};

const buildDetailRows = (records?: YupaiOrder[] | null, withNewLine: boolean = false): yupaiOrderDetailRow[] => {
    if (!records) return [createDetailRow(nextDraftRowKey())];
    const result = records.map((record) => {
        const row: yupaiOrderDetailRow = {
            YupaiOrderID: String(record.ID ?? ''),
            StyleCode: String(record.StyleCode ?? ''),
            // 数值列统一「0 视作未填 → null」，与 createDetailRow 的初始值保持一致，
            // 这样判空（isBlank）和校验都不用再猜「这个 0 是初始值还是用户填的」
            Number: toNumberOrNullIfZero(record.Number),
            ProduceName: String(record.ProduceName ?? ''),
            Color: String(record.Color ?? ''),
            TSWorkName: String(record.TSWorkName ?? ''),
            HDWorkName: String(record.HDWorkName ?? ''),
            ZZMWeight: toNumberOrNullIfZero(record.ZZMWeight),
            ZZMTime: toNumberOrNullIfZero(record.ZZMTime),
            MSewWt: toNumberOrNullIfZero(record.MSewWt),
        };
        YupaiMachineSizeHeader.forEach((_, index) => {
            const field = `MCSize${index + 1}`;
            row[field] = toNumberOrNullIfZero(record[field]);
        });
        return row;
    });
    if (withNewLine) {
        result.push(createDetailRow(nextDraftRowKey()));
    }
    return result;
};

const Field: React.FC<{
    label: string;
    required?: boolean;
    grow?: boolean;
    children: React.ReactNode;
}> = ({label, required, grow, children}) => (
    <div className={grow ? 'pf-field pf-field-grow' : 'pf-field'}>
        <span className={required ? 'pf-label pf-label-required' : 'pf-label'}>{label}</span>
        <div className="pf-control">{children}</div>
    </div>
);

const YupaiOrderEdit: React.FC<yupaiOrderFormModalProps> = ({
                                                                open,
                                                                mode,
                                                                record,
                                                                workPlaces,
                                                                disabled = false,
                                                                onCancel,
                                                                onSaved,
                                                            }) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<yupaiOrderFormValues>();
    const [saving, setSaving] = useState(false);
    const [checking, setChecking] = useState(false);
    const [detailRows, setDetailRows] = useState<yupaiOrderDetailRow[]>([]);
    /** 校验不通过的单元格：「行主键#字段」→ 提示文案 */
    const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
    const [employeeOpen, setEmployeeOpen] = useState(false);
    const [orderChecked, setOrderChecked] = useState(false);
    // 初值取 true：首帧先显示骨架屏，等下面那个 effect 用 setIsLoading(isEdit) 定值。
    // 若初值为 false，编辑态首次打开会先按「非加载」渲染一帧 —— 表格被建出来、紧接着
    // 又被 Skeleton 顶掉，多一次建表/释放，正是需要避开的时序。
    const [isLoading, setIsLoading] = useState(true);
    const [toolbarLocked, setToolbarLocked] = useState(true);

    /** 详情表格实例：校验结果变化后要靠它重绘（cellStyle 是 canvas 渲染时读取的） */
    const tableRef = useRef<VTableApi>(null);

    const isView = mode === 'view';
    const isEdit = mode === 'edit';
    const isAdd = mode === 'add';

    const detailLocked = isView || (isAdd && !orderChecked);

    useEffect(() => {
        if (!open) {
            // 关闭时只收掉弹窗内的临时状态，**不要把 isLoading 置回 false**：
            // 关闭动画期间内容还在 DOM 里，isLoading 一变 false，渲染就会从 Skeleton
            // 换成真正的表单 + 详情表格 —— 等于往一个正在消失的容器里新建一张 canvas 表格。
            // 表格会以 0 尺寸初始化、留下坏掉的场景图，之后再 resize 就抛
            // 「Cannot read properties of null (reading 'element')」，序号列也跟着错乱。
            // 下次打开时开头会用 setIsLoading(isEdit) 重新定值，不会残留。
            setEmployeeOpen(false);
            setOrderChecked(false);
            setToolbarLocked(false);
            setCellErrors({});
            return;
        }
        setToolbarLocked(isView || isEdit);
        setIsLoading(isEdit);
        form.resetFields();
        if (!isEdit || !record) {
            form.setFieldsValue(buildValues(record));
            setDetailRows(buildDetailRows(record ? [record] : null));
            setOrderChecked(false);
            return;
        }
        // 如果是编辑，要按订单号取到最新的订单号所有的款式记录，显示当前选中的一条其他款式不显示但是更新的时候主信息要同步更新
        let cancel = false;
        const loadYupaiOrder = async () => {
            try {
                const res = await yupaiService.queryOrder(record.OrderCode);
                if (cancel) {
                    return;
                }
                if (res.data && res.data.length > 0 && res.data[0].Status < 2) {
                    const matchOrder = res.data.filter(o => o.ID == record.ID);
                    if (matchOrder && matchOrder.length > 0) {
                        form.setFieldsValue(buildValues(matchOrder[0]))
                        setDetailRows(buildDetailRows(matchOrder));
                    } else {
                        // 订单里已经没有选中的这条记录了（多半被他人改动过）。
                        // 提示后直接关窗，这里同样不翻 isLoading —— 理由同上，
                        // 别在弹窗关闭之后还把详情表格建出来。
                        void message.error("预订单信息与选择数据不匹配,请重试")
                        onCancel();
                        return;
                    }
                    setToolbarLocked(true);
                } else { //没有有效的订单信息，就相当于新增
                    form.setFieldsValue(buildValues(record))
                    setDetailRows(buildDetailRows(record ? [record] : null));
                }
                setOrderChecked(false);
                setIsLoading(false);
            } catch (error) {
                void message.error(error instanceof ApiError ? error.message : '预订单信息获取失败');
                setOrderChecked(false);
            } finally {
                setChecking(false);
            }
        }
        void loadYupaiOrder();
        return () => {
            cancel = true;
        }
    }, [form, open, record]);

    // 列定义只描述展示，是否可编辑由下面的 editableFields 决定
    const detailColumns = useMemo(() => buildPreorderDetailColumns(), []);

    /**
     * 右键菜单「添加行」：不传 afterRowKey 表示追加到末尾，传了则插到该行之后。
     *
     * 入参是**行主键**而不是行号：行号在表格排序后与数据顺序对不上，
     * 「在下方插入行」会插到别处；按主键先找到它在数据里的位置再插，才是用户看到的那一行。
     */
    const addDetailRow = useCallback((afterRowKey?: string) => {
        setDetailRows((prev) => {
            const next = [...prev];
            const anchor = afterRowKey
                ? next.findIndex((row) => String(row.YupaiOrderID) === afterRowKey)
                : -1;
            // 找不到锚点行（理论上不会）就退回追加到末尾，别插到开头
            const index = anchor >= 0 ? anchor + 1 : next.length;
            next.splice(index, 0, createDetailRow(nextDraftRowKey()));
            return next;
        });
    }, []);

    /**
     * 详情表格右键菜单：只读 / 未解锁时不弹（返回空数组即无菜单）。
     * 菜单里传递行主键而不是行号，理由见 addDetailRow。
     */
    const detailMenu = useMemo<VTableMenuConfig>(
        () => ({
            contextMenuItems: ({rowIndex, record}) => {
                if (detailLocked || !isAdd) return [];
                const rowKey = String(record?.YupaiOrderID ?? '');
                return [
                    ...(rowIndex >= 0 && rowKey ? [{text: '在下方插入行', menuKey: 'insertRowBelow'}] : []),
                    {text: '新增行', menuKey: 'appendRow'},
                ];
            },
            onClick: ({menuKey, record}) => {
                const rowKey = String(record?.YupaiOrderID ?? '');
                if (menuKey === 'insertRowBelow' && rowKey) addDetailRow(rowKey);
                else if (menuKey === 'appendRow') addDetailRow();
            },
        }),
        [addDetailRow, detailLocked, isAdd],
    );

    /**
     * 编辑提交：把新值同步回页面这份 detailRows（保存时读的就是它）。
     *
     * 定位用**行主键**而不是 rowIndex —— VTable 回传的 rowIndex 是「当前 records 数组里的位置」，
     * 而组件接管排序后这个数组已经排过序（见 VTable.tsx 的 rows/ setRecords），页面这份
     * detailRows 却还是原始顺序，按索引改会写错行。回调里带的 record 就是那一行的原始记录，
     * 取它的主键来定位，排序、增删行之后都准确。
     *
     * 顺带跑一次全表校验：跨行/跨字段规则只有在这里才拿得到完整数据。
     *
     * 需要「编辑前后对比」时，用回调参数里的 previousValue（被编辑那一格的旧值）——
     * 此刻 detailRows 里那一行已经被 VTable 就地改成新值了，回头读它拿不到旧数据；
     * 要整行的旧状态，`{...record, [field]: previousValue}` 拼一下即可。
     */
    const handleDetailChange = useCallback(
        ({field, rowIndex, record, value, previousValue}: VTableCellValueChangeInfo) => {
            const rowKey = String(record?.YupaiOrderID ?? '');
            const isMCSizeField = field.startsWith('MCSize');
            const nextRows = detailRows.map((row, index) => {
                // 正常走主键；万一拿不到主键（理论上不会）退回按行号改 ——
                // 宁可保留旧行为，也不能静默把这次编辑丢掉
                const hit = rowKey ? String(row.YupaiOrderID) === rowKey : index === rowIndex;
                if (!hit) return row;
                const nextRow = {...row, [field]: value};
                // 改尺码格时，款式数量做等量调整：换出旧值、换入新值。
                // 算出来是 0 就说明没数量，按行数据约定折成 null（而不是留一个 0）
                if (isMCSizeField) {
                    nextRow.Number = toNumberOrNullIfZero(
                        toNumberOrZero(row.Number) - toNumberOrZero(previousValue) + toNumberOrZero(value),
                    );
                }
                return nextRow;
            });
            setDetailRows(nextRows);
            setCellErrors(toCellErrors(validateYupaiOrderDetailRows(nextRows)));
        },
        [detailRows],
    );

    /** 校验不通过的单元格标红（cellStyle 由 canvas 渲染时读取，见下面的重绘 effect） */
    const detailCellStyle: VTableCellStyleHook = useCallback(
        ({rowKey, field, isSummaryRow}) => {
            if (!rowKey || isSummaryRow) return undefined;
            return cellErrors[cellErrorKey(rowKey, field)]
                ? {bgColor: '#fff2f0', color: '#cf1322'}
                : undefined;
        },
        [cellErrors],
    );

    /**
     * cellStyle 变了不会自动生效：canvas 只在重绘时才重新取样式。
     * 编辑场景下 records 变化会触发一次 setRecords，但「保存前统一校验」时数据没动，
     * 所以这里统一补一次重绘。关闭时跳过，别去动正在销毁的表格。
     */
    useEffect(() => {
        if (!open) return;
        tableRef.current?.repaint();
    }, [cellErrors, open]);

    const handleCheck = useCallback(async () => {
        const code = String(form.getFieldValue('OrderCode') ?? '').trim();
        if (!code) {
            void message.warning('请先输入订单号');
            return;
        }
        setChecking(true);
        try {
            const res = await yupaiService.queryOrder(code);
            if (res.data && res.data.length > 0) {
                if (res.data[0].Status < 2) { //未发布的订单，看看当前用户是否有全操作
                    const departments = (await yupaiApi.userDepartment()).data ?? []
                    if (departments && departments.includes(res.data[0].DepartmentID)) { //进入编辑状态
                        form.resetFields();
                        form.setFieldsValue(buildValues(res.data[0]));
                        setDetailRows(buildDetailRows(res.data, true));
                        setCellErrors({});
                        setOrderChecked(true);
                        return;
                    }
                }
                void message.warning(`订单号 ${code} 已存被${res.data[0].Ywy}使用`);
                setOrderChecked(false);
            } else {
                void message.success(`订单号 ${code} 可以使用`);
                setCellErrors({});
                setOrderChecked(true);
            }
        } catch (error) {
            void message.error(error instanceof ApiError ? error.message : '检测订单号失败');
            setOrderChecked(false);
        } finally {
            setChecking(false);
        }
    }, [form, message, record]);

    const handleSave = useCallback(async () => {
        // 先全量校验详情表：有错就标红并拦住提交，避免把不合法的数据发给后端
        const errors = toCellErrors(validateYupaiOrderDetailRows(detailRows));
        const errorCount = Object.keys(errors).length;
        if (errorCount > 0) {
            setCellErrors(errors);
            void message.error(`有 ${errorCount} 处数据需要修正，已在表格中标红`);
            return;
        }
        setCellErrors({});

        let values: yupaiOrderFormValues;
        try {
            values = await form.validateFields();
        } catch {
            return;
        }

        const payload: Partial<YupaiOrder> = {
            OrderCode: values.OrderCode ?? '',
            YPDate: toDateString(values.YPDate),
            Ywy: values.Ywy ?? '',
            WorkPlace: values.WorkPlace ?? '',
            JHDate: toDateString(values.JHDate),
            QRDate: toDateString(values.QRDate),
            WCDate: toDateString(values.WCDate),
            ZHDate: toDateString(values.ZHDate),
            YLDate: toDateString(values.YLDate),
            FLDate: toDateString(values.FLDate),
            BZFLDate: toDateString(values.BZFLDate),
            XDRate: values.XDRate ?? '',
            Qty: Number(values.Qty) || 0,
            Memo: values.Memo ?? '',
            ZQCheckDate: toDateString(values.ZQCheckDate),
            ZQCheckMemo: values.ZQCheckMemo ?? '',
        };
        const firstRow = detailRows[0];
        if (firstRow) {
            payload.StyleCode = String(firstRow.StyleCode ?? '');
            // 行数据里的「未填」是 null，提交时折回 0（后端字段非空）
            payload.Number = toNumberOrZero(firstRow.Number);
            payload.ProduceName = firstRow.ProduceName;
            payload.Color = firstRow.Color;
            payload.TSWorkName = firstRow.TSWorkName;
            payload.HDWorkName = firstRow.HDWorkName;
            payload.ZZMWeight = toNumberOrZero(firstRow.ZZMWeight);
            payload.MSewWt = toNumberOrZero(firstRow.MSewWt);
        }

        setSaving(true);
        try {
            if (mode === 'edit' && record) await yupaiApi.update(record.ID, payload);
            else await yupaiApi.create(payload);
            message.success(mode === 'edit' ? '保存成功' : '新增成功');
            onSaved();
        } catch (error) {
            message.error(error instanceof ApiError ? error.message : '保存失败');
        } finally {
            setSaving(false);
        }
    }, [detailRows, form, message, mode, onSaved, record]);

    const modalTitle = isView ? '查看预订单' : isEdit ? '编辑预订单' : '新增预订单';

    // DatePicker: open={false} 阻止打开, inputReadOnly 阻止输入
    // Select: open={false} 阻止下拉, allowClear=false 阻止清除
    const dpProps = (locked: boolean) =>
        locked ? {open: false, inputReadOnly: true, allowClear: false} : {allowClear: true};

    const selectProps = (locked: boolean) =>
        locked ? {open: false, allowClear: false} : {allowClear: true};

    return (
        <Modal
            open={open}
            title={modalTitle}
            width="94vw"
            // 关闭即销毁内容：详情表格是 canvas 组件，留在隐藏容器里不但占资源，
            // 下次打开还会带着上一轮的内部状态被 resize（见下面 !open 分支的说明）。
            destroyOnHidden
            style={{top: 24, maxWidth: 1600}}
            styles={{
                body: {
                    height: 'calc(100vh - 168px)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                },
            }}
            footer={null}
            mask={{closable: false}}
            onCancel={onCancel}
        >
            {isLoading ? (
                <Skeleton active paragraph={{rows: 6}}/>
            ) : (
                <Form form={form} component={false} className="preorder-form">
                    <div className="preorder-form-toolbar">
                        <span className="pf-label">订单号</span>
                        <Form.Item name="OrderCode" noStyle>
                            <Input
                                style={{width: 150}}
                                allowClear={!toolbarLocked}
                                placeholder="订单号"
                                readOnly={toolbarLocked}
                            />
                        </Form.Item>
                        {isAdd && (
                            <Button loading={checking} disabled={disabled} onClick={handleCheck}>
                                检测
                            </Button>
                        )}
                        <span className="pf-label pf-toolbar-gap">预排日期</span>
                        <Form.Item name="YPDate" noStyle>
                            <DatePicker
                                style={{width: 150}}
                                format={DATE_FORMAT}
                                {...dpProps(toolbarLocked)}
                            />
                        </Form.Item>
                        {!isView && (
                            <Button
                                type="primary"
                                style={{marginLeft: 'auto'}}
                                loading={saving}
                                disabled={detailLocked}
                                onClick={handleSave}
                            >
                                保存
                            </Button>
                        )}
                    </div>

                    <fieldset
                        className={`preorder-fieldset${detailLocked && !isView ? ' preorder-fieldset-disabled' : ''}`}>
                        <legend>详情</legend>

                        <div className="pf-row">
                            <Field label="业务员" required>
                                <Form.Item name="Ywy" noStyle>
                                    <Input style={{width: 120}} readOnly allowClear={false}/>
                                </Form.Item>
                                <Button
                                    style={{width: 30, padding: 0}}
                                    className="pf-picker-btn"
                                    disabled={detailLocked}
                                    onClick={() => setEmployeeOpen(true)}
                                >
                                    ...
                                </Button>
                            </Field>
                            <Field label="产地">
                                <Form.Item name="WorkPlace" noStyle>
                                    <Select
                                        style={{width: 150}}
                                        placeholder="请选择"
                                        options={workPlaces.map((value) => ({value, label: value}))}
                                        {...selectProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="计划下单日期" required>
                                <Form.Item
                                    name="JHDate"
                                    noStyle
                                    rules={[{required: true, message: '请选择计划下单日期'}]}
                                >
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="确认可下单期">
                                <Form.Item name="QRDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="尾货期" required>
                                <Form.Item
                                    name="WCDate"
                                    noStyle
                                    rules={[{required: true, message: '请选择尾货期'}]}
                                >
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="走货期" required>
                                <Form.Item
                                    name="ZHDate"
                                    noStyle
                                    rules={[{required: true, message: '请选择走货期'}]}
                                >
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="原料可下单期">
                                <Form.Item name="YLDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="缝制辅料可下单期">
                                <Form.Item name="FLDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="包装辅料提供期">
                                <Form.Item name="BZFLDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="下单把握率">
                                <Form.Item name="XDRate" noStyle>
                                    <Input
                                        style={{width: 150}}
                                        placeholder="如 95%"
                                        readOnly={detailLocked}
                                        allowClear={!detailLocked}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="总数量:">
                                <Form.Item name="Qty" noStyle>
                                    <InputNumber
                                        style={{width: 130}}
                                        min={0}
                                        readOnly={detailLocked}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="备注" grow>
                                <Form.Item name="Memo" noStyle>
                                    <Input placeholder="备注" readOnly={detailLocked} allowClear={!detailLocked}/>
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="中期检验日期">
                                <Form.Item name="ZQCheckDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="中期检验要求" grow>
                                <Form.Item name="ZQCheckMemo" noStyle>
                                    <Input
                                        placeholder="中期检验要求"
                                        readOnly={detailLocked}
                                        allowClear={!detailLocked}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="preorder-detail-grid">
                            <VTable
                                ref={tableRef}
                                columns={detailColumns}
                                records={detailRows as unknown as Array<Record<string, unknown>>}
                                rowKey="YupaiOrderID"
                                editableFields={detailLocked ? undefined : DETAIL_EDITOR_FIELDS}
                                onCellValueChange={handleDetailChange}
                                cellStyle={detailCellStyle}
                                menu={detailMenu}
                            />
                            {detailRows.length === 0 && <div className="preorder-detail-empty">没有任何记录</div>}
                        </div>
                    </fieldset>
                </Form>
            )}
            <EmployeeQuickSelect
                open={employeeOpen}
                title="快速选择-业务员"
                loadData={async () => (await employeeApi.list()).data ?? []}
                onSelect={(employee) => {
                    form.setFieldValue('Ywy', employee.EmployeeName);
                    setEmployeeOpen(false);
                }}
                onCancel={() => setEmployeeOpen(false)}
            />
        </Modal>
    );
};

export default YupaiOrderEdit;
