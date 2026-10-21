import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {App, Button, DatePicker, Form, Input, InputNumber, Modal, Select} from 'antd';
import {DeleteOutlined} from '@ant-design/icons';
import dayjs, {type Dayjs} from 'dayjs';
import {ApiError, employeeApi, yupaiApi, YupaiMachineSizeHeader, type YupaiOrder, type YupaiOrderDto} from '@/api';
import {
    GridTable,
    type GridTableApi,
    type GridTableCellStyleHook,
    type GridTableCellTooltipHook,
    type GridTableCellValueChangeInfo,
    type GridTableMenuConfig
} from '@/components/grid-table';
import {EmployeeQuickSelect} from '@/components/quick-select';
import type {FormMode} from '../command';
import {alignMenuIcons, toMenuIcon} from '@/components/grid-table/menuIcon';
import {
    buildPreorderDetailColumns,
    createDetailRow,
    DETAIL_EDITOR_FIELDS,
    setCurrentOrderCode,
    type yupaiOrderDetailRow,
} from './yupaiOrderEditColumns.ts';
import {isEmptyYupaiOrder, validateYupaiOrderDetailRows, yupaiService} from "@/services/yupai.ts";
import {
    DATE_FORMAT,
    formatDateTime,
    isBlank,
    now,
    toDateString,
    toDayjs,
    toNumberOrNullIfZero,
    toNumberOrZero,
    toStringOrEmpty
} from '@/utils';
import {useAuth} from "@/store/auth-context.ts";
import {SUPER_ADMIN_USER_ID} from "@/services";

/**
 * 右键菜单图标：直接用 antd 图标。
 *
 * GridTable 的菜单图标要的是字符串（完整 `<svg>` 字符串，它会把内容 innerHTML 进一个 span），
 * 而 antd 图标是 React 组件 —— `toMenuIcon` 就是这一层转换，模块级调用一次即可。
 * 图标自带 1em 尺寸与 currentColor，所以大小跟着菜单字号、颜色跟着文字（高亮时一起变）。
 */
const MENU_ICON_DELETE = toMenuIcon(<DeleteOutlined/>);

interface yupaiOrderFormValues {
    OrderCode?: string;
    YPDate?: Dayjs;
    Ywy?: string;
    YwyNo?: string;
    DepartmentID?: string;
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
    /**
     * 表单模式（语义见 `FormMode`）。
     *
     * 本页用到四种：新增（空白表单）/ 编辑（改原单）/ 查看 / **复制**（拿一条已有订单当底稿新建，
     * 见「已下订单复制」：订单号不复制、明细清掉主键，提交落成新记录）。
     */
    mode: FormMode;
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

/**
 * 取一行的主键值 —— 详情行的行主键就是 `_id`（新增出来的空白行也是 `draft-N`）。
 *
 * ⚠️ 别再掺 `YupaiOrderID`：`createDetailRow` 生成的新行**没有**这个字段，
 * 一旦某处按它取主键就会拿到空串 —— cellStyle 里 `if (!rowKey) return undefined` 直接不标红，
 * 表现成「有错的那一行没反应、反倒是别的行标了红」。
 */
const rowKeyOf = (row: yupaiOrderDetailRow): string => String(row._id ?? '');

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
        // 业务员的两个附带字段：界面上没有输入框（表单里是 hidden 的 Form.Item），
        // 这里回填是为了让「换订单 / 换记录」时旧值能被覆盖掉，不然会残留上一个订单的业务员
        YwyNo: String(record.YwyNo ?? ''),
        DepartmentID: String(record.DepartmentID ?? ''),
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
 * 必须唯一：GridTable 用它当 rowKey（重复会导致行错位），页面也靠它定位「编辑的是哪一行」。
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
            _id: String(record.ID ?? ''),
            YupaiOrderID: String(record.ID ?? ''),
            StyleCode: String(record.StyleCode ?? ''),
            // 数值列统一「0 视作未填 → null」，与 createDetailRow 的初始值保持一致，
            // 这样判空（isBlank）和校验都不用再猜「这个 0 是初始值还是用户填的」
            Number: toNumberOrNullIfZero(record.Number),
            ProduceName: String(record.ProduceName ?? ''),
            Color: String(record.Color ?? ''),
            TSWorkName: String(record.TSWorkName ?? ''),
            HDWorkName: String(record.HDWorkName ?? ''),
            MWeight: toNumberOrNullIfZero(record.MWeight),
            MCycle: toNumberOrNullIfZero(record.MCycle),
            MSewWt: toNumberOrNullIfZero(record.MSewWt),
            DataVersion: record.DataVersion,
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

/**
 * 复制：把原单的**全部款式**带出来，但每行换一个新主键、并清空 `YupaiOrderID`。
 *
 * 清空 `YupaiOrderID` 是「复制」与「编辑」的分界：handleSave 拿它当提交的 `ID`，
 * 非空后端就按「更新」处理 —— 那样复制出来的单会直接改掉原订单的款式，
 * 而不是新增一份（原单已被下单，更不能动）。
 *
 * 主键换新而不是沿用原来的 ID：主键在页面上代表「这一行是谁」，
 * 复制出来的行是**新行**，沿用旧主键会让「删除行」「标红定位」都指向原单那一行。
 *
 * `DataVersion` 一并归零：它跟着 `ID` 走（已有行的乐观锁版本），
 * 新行没有版本可言 —— 这里的 0 与 `createDetailRow` 新建行保持一致。
 *
 * 末尾补一行空白行，与「检测」带出订单时的体验保持一致（要加新款直接填）。
 */
const buildCopyDetailRows = (records: YupaiOrder[]): yupaiOrderDetailRow[] =>
    buildDetailRows(records, true).map((row) => ({
        ...row,
        _id: nextDraftRowKey(),
        YupaiOrderID: '',
        DataVersion: 0,
    }));

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
        const {userInfo} = useAuth();
        const [saving, setSaving] = useState(false);
        const [checking, setChecking] = useState(false);
        const [detailRows, setDetailRows] = useState<yupaiOrderDetailRow[]>([]);
        const [hideDatas, setHideDatas] = useState<YupaiOrder[]>([]);
        /** 校验不通过的单元格：「行主键#字段」→ 提示文案 */
        const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
        const [employeeOpen, setEmployeeOpen] = useState(false);
        const [orderChecked, setOrderChecked] = useState(false);
        // 初值取 true：首帧先显示骨架屏，等下面那个 effect 用 setIsLoading(isEdit) 定值。
        // 若初值为 false，编辑态首次打开会先按「非加载」渲染一帧 —— 表格被建出来、紧接着
        // 又被 Skeleton 顶掉，多一次建表/释放，正是需要避开的时序。
        const [isLoading, setIsLoading] = useState(true);
        const [toolbarLocked, setToolbarLocked] = useState(true);
        const [maxYLDate, setMaxYLDate] = useState<Dayjs | undefined>(toDayjs("9999-12-31"));
        const [maxFLDate, setMaxFLDate] = useState<Dayjs | undefined>(toDayjs("9999-12-31"));
        const [minZHDate, setMinZHDate] = useState<Dayjs | undefined>(now());
        const [minWCDate, setMinWCDate] = useState<Dayjs | undefined>(now());

        /** 详情表格实例：校验结果变化后要靠它重绘（cellStyle 是 canvas 渲染时读取的） */
        const tableRef = useRef<GridTableApi>(null);

        const isView = mode === 'view';
        const isEdit = mode === 'edit';
        const isAdd = mode === 'add';
        /** 复制：数据从一条已有订单带出来，但落库是新增（见 buildCopyDetailRows） */
        const isCopy = mode === 'copy';

        // 复制不带「未检测」这个状态：数据已经按订单号查过一遍，进来就是可编辑的
        const detailLocked = isView || (isAdd && !orderChecked) || (isCopy && !orderChecked);

        useEffect(() => {
            if (!open) {
                // 关闭时只收掉弹窗内的临时状态，**不要把 isLoading 置回 false**：
                // 关闭动画期间内容还在 DOM 里，isLoading 一变 false，渲染就会从 Skeleton
                // 换成真正的表单 + 详情表格 —— 等于往一个正在消失的容器里新建一张 canvas 表格。
                // 表格会以 0 尺寸初始化、留下坏掉的场景图，之后再 resize 就抛
                // 「Cannot read properties of null (reading 'element')」，序号列也跟着错乱。
                // 下次打开时开头会用 setIsLoading(isEdit || isCopy) 重新定值，不会残留。
                setEmployeeOpen(false);
                setOrderChecked(false);
                setToolbarLocked(false);
                setCellErrors({});
                // 订单号是模块级共享的（详情行的款号查重要用它限定范围），关弹窗时清掉，
                // 免得下一个弹窗（可能是别的订单）读到上一单的号
                setCurrentOrderCode('');
                setHideDatas([]);
                return;
            }
            setToolbarLocked(isView || isEdit);
            // 编辑与复制都要先按订单号把订单取回来（编辑是对比选中那条，复制是要全部款式），
            // 两者首帧都先走骨架屏，别按「已加载」渲染一帧再被顶掉（见上面 isLoading 初值的说明）
            setIsLoading(isEdit || isCopy);
            if (isCopy && record) {
                let cancel = false;
                const loadCopyOrder = async () => {
                    try {
                        const res = await yupaiService.queryOrder(record.OrderCode);
                        if (cancel) {
                            return;
                        }
                        if (!res.data || res.data.length === 0) {
                            // 从命令弹窗查到、到表单打开这一小段时间里数据被删掉了（或已被置为删除）。
                            // 这里同样不翻 isLoading —— 理由与编辑分支一致：别往正在消失的弹窗里建详情表格。
                            void message.error(`订单号 ${record.OrderCode} 不存在`);
                            onCancel();
                            return;
                        }
                        form.resetFields();
                        // 订单号**不复制**：复制出来的是新单，必须换新号（表单里它是必填），
                        // 其余主信息按最新数据带出，日期区间等联动值交给下面的渲染逻辑自己取
                        form.setFieldsValue({
                            ...buildValues(res.data[0]),
                            OrderCode: '',
                            YPDate: now(),
                            JHDate: undefined,
                            QRDate: undefined,
                            WCDate: undefined,
                            ZHDate: undefined,
                            YLDate: undefined,
                            FLDate: undefined,
                            BZFLDate: undefined,
                            ZQCheckDate: undefined,
                        });
                        // 日期边界与原单对齐（同编辑分支）：这些边界本该跟着确认可下单期走，
                        // 不设的话「走货期」的下限会退回组件初始值（今天），原单的日期可能早于它
                        if (res.data[0].QRDate) {
                            setMaxFLDate(res.data[0].QRDate);
                            setMaxYLDate(res.data[0].QRDate);
                            setMinWCDate(res.data[0].QRDate);
                            setMinZHDate(res.data[0].QRDate);
                        }
                        setDetailRows(buildCopyDetailRows(res.data));
                        // 复制不涉及「原单中被隐藏的其它款式」：全部款式都在明细里，没有要顺带更新的行
                        setHideDatas([]);
                        setCellErrors({});
                        setIsLoading(false);
                        setOrderChecked(false); //复制的订单要锁定详情直到订单号检测成功
                    } catch (error) {
                        void message.error(error instanceof ApiError ? error.message : '预订单信息获取失败');
                    }
                };
                void loadCopyOrder();
                return () => {
                    cancel = true;
                };
            }
            if (!isEdit || !record) {
                form.resetFields();
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
                            form.resetFields();
                            form.setFieldsValue(buildValues(matchOrder[0]));
                            if (matchOrder[0].QRDate) {
                                setMaxFLDate(matchOrder[0].QRDate);
                                setMaxYLDate(matchOrder[0].QRDate);
                                setMinWCDate(matchOrder[0].QRDate);
                                setMinZHDate(matchOrder[0].QRDate);
                            }
                            setDetailRows(buildDetailRows(matchOrder));
                        } else {
                            // 订单里已经没有选中的这条记录了（多半被他人改动过）。
                            // 提示后直接关窗，这里同样不翻 isLoading —— 理由同上，
                            // 别在弹窗关闭之后还把详情表格建出来。
                            void message.error("预订单信息与选择数据不匹配,请重试")
                            onCancel();
                            return;
                        }
                        setHideDatas(res.data.filter(o => o.ID != record.ID && o.OrderCode == record.OrderCode));
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
        }, [form, open, record, mode]);

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
                    ? next.findIndex((row) => String(row._id) === afterRowKey)
                    : -1;
                // 找不到锚点行（理论上不会）就退回追加到末尾，别插到开头
                const index = anchor >= 0 ? anchor + 1 : next.length;
                if (index > 0) {
                    const data = prev[index - 1];
                    if (data && isEmptyYupaiOrder(data)) { //如果原本就是一行空数据，那就不再新增空行了
                        return prev
                    }
                }
                next.splice(index, 0, createDetailRow(nextDraftRowKey()));
                return next;
            });
        }, []);

        const deleteDetailRow = useCallback((delRowKey: string) => {
            setDetailRows((prev) => {
                const next = [...prev];
                const anchor = delRowKey
                    ? next.findIndex((row) => String(row._id) === delRowKey)
                    : -1;
                const row = next.find(row => String(row._id) === delRowKey);
                if (anchor < 0 || anchor >= prev.length || !row) { //无效的下标，不更新任何数据
                    return prev
                }
                if (!isBlank(row.YupaiOrderID)) {
                    void message.warning("该行数据已保存请前往列表页取消")
                    return prev;
                }
                next.splice(anchor, 1);
                if (next.length < 1) {
                    // 这里还要处理如果全部都删掉了，需要增加一个空白行
                    next.push(createDetailRow(nextDraftRowKey()))
                }
                return next;
            });
        }, []);

        /**
         * 详情表格右键菜单：只读 / 未解锁时不弹（返回空数组即无菜单）。
         * 菜单里传递行主键而不是行号，理由见 addDetailRow。
         * 菜单项过一遍 alignMenuIcons：只有「删除行」配了图标，其余项补空白占位才不会文字错位。
         */
        const detailMenu = useMemo<GridTableMenuConfig>(
            () => ({
                contextMenuItems: ({rowIndex, record}) => {
                    // 复制出来的是新单，明细行可增删（同新增）；只有编辑/查看才禁掉
                    if (detailLocked || !(isAdd || isCopy)) return [];
                    const rowKey = String(record?._id ?? '');
                    const allowNewLine = !isEmptyYupaiOrder(detailRows[detailRows.length - 1]);
                    const allowNewNextLine = !isEmptyYupaiOrder(record ?? null);
                    return alignMenuIcons([
                        ...(rowIndex >= 0 && rowKey && allowNewNextLine ? [{
                            text: '在下方插入行',
                            menuKey: 'insertRowBelow'
                        }] : []),
                        ...(allowNewLine ? [{text: '新增行', menuKey: 'appendRow'}] : []),
                        ...(rowKey && isBlank(record?.YupaiOrderID) ? [{
                            text: '删除行',
                            menuKey: 'deleteRow',
                            icon: MENU_ICON_DELETE
                        }] : []),
                    ]);
                },
                onClick: ({menuKey, record}) => {
                    const rowKey = String(record?._id ?? '');
                    if (menuKey === 'insertRowBelow' && rowKey) addDetailRow(rowKey);
                    else if (menuKey === 'appendRow') addDetailRow();
                    else if (menuKey === 'deleteRow' && rowKey) deleteDetailRow(rowKey);
                },
            }),
            [addDetailRow, detailLocked, isAdd, isCopy, detailRows, deleteDetailRow],
        );

        /**
         * 编辑提交：把新值同步回页面这份 detailRows（保存时读的就是它）。
         *
         * 定位用**行主键**而不是 rowIndex —— GridTable 回传的 rowIndex 是「当前 records 数组里的位置」，
         * 而组件接管排序后这个数组已经排过序（见 GridTable.tsx 的 rows/ setRecords），页面这份
         * detailRows 却还是原始顺序，按索引改会写错行。回调里带的 record 就是那一行的原始记录，
         * 取它的主键来定位，排序、增删行之后都准确。
         *
         * 顺带跑一次全表校验：跨行/跨字段规则只有在这里才拿得到完整数据。
         *
         * 需要「编辑前后对比」时，用回调参数里的 previousValue（被编辑那一格的旧值）——
         * 此刻 detailRows 里那一行已经被 GridTable 就地改成新值了，回头读它拿不到旧数据；
         * 要整行的旧状态，`{...record, [field]: previousValue}` 拼一下即可。
         */
        const handleDetailChange = useCallback(
            ({field, rowIndex, record, value, previousValue}: GridTableCellValueChangeInfo) => {
                // 定位行一律用行主键 `_id`（与表格的 rowKey、服务层校验的键保持一致）
                const rowKey = String(record?._id ?? '');
                const isMCSizeField = field.startsWith('MCSize');
                let totalNumber = 0;
                const nextRows = detailRows.map((row, index) => {
                    // 正常走主键；万一拿不到主键（理论上不会）退回按行号改 ——
                    // 宁可保留旧行为，也不能静默把这次编辑丢掉
                    const hit = rowKey ? String(row._id) === rowKey : index === rowIndex;
                    if (!hit) {
                        if (isMCSizeField) {
                            totalNumber = totalNumber + toNumberOrZero(row.Number);
                        }
                        return row;
                    }
                    const nextRow = {...row, [field]: value};
                    // 改尺码格时，款式数量做等量调整：换出旧值、换入新值。
                    // 算出来是 0 就说明没数量，按行数据约定折成 null（而不是留一个 0）
                    if (isMCSizeField) {
                        nextRow.Number = toNumberOrNullIfZero(
                            toNumberOrZero(row.Number) - toNumberOrZero(previousValue) + toNumberOrZero(value),
                        );
                        totalNumber = totalNumber + toNumberOrZero(nextRow.Number);
                    }
                    return nextRow;
                });
                if (isMCSizeField) {
                    form.setFieldsValue({Qty: totalNumber});
                }
                setDetailRows(nextRows);
                setCellErrors(toCellErrors(validateYupaiOrderDetailRows(nextRows)));
            },
            [detailRows, form],
        );


        /** 校验不通过的单元格标红（cellStyle 由 canvas 渲染时读取，见下面的重绘 effect） */
        const detailCellStyle: GridTableCellStyleHook = useCallback(
            ({rowKey, field, isSummaryRow}) => {
                if (!rowKey || isSummaryRow) return undefined;
                return cellErrors[cellErrorKey(rowKey, field)]
                    ? {backgroundColor: '#fff2f0', textColor: '#cf1322'}
                    : undefined;
            },
            [cellErrors],
        );

        /**
         * 悬停提示：光有红底用户不知道错在哪，鼠标移上去把服务层给的提示文案显示出来。
         * 与 detailCellStyle 用同一份 cellErrors、同一套行主键判断，所以「红的格子」必然「有提示」。
         */
        const detailCellTooltip: GridTableCellTooltipHook = useCallback(
            ({rowKey, field, isSummaryRow}) => {
                if (!rowKey || isSummaryRow) return undefined;
                return cellErrors[cellErrorKey(rowKey, field)];
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
                    // ⚠️ 复制模式下**跳过**「检出未发布订单 → 转编辑」这一段：
                    // 那会把刚带出来的底稿整份换成别人的订单，而且明细行会带着原单的主键
                    // （保存时改的是那张单，不是复制）。复制时订单号已存在只提示「被占用」，
                    // 用户换个新号即可 —— 这里不代他做决定。
                    if (!isCopy && res.data[0].Status < 2) { //未发布的订单，看看当前用户是否有全操作
                        const departments = (await yupaiApi.userDepartment()).data ?? []
                        if (userInfo?.UserID == SUPER_ADMIN_USER_ID || departments.includes(res.data[0].DepartmentID)) { //进入编辑状态
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
                    // 加载默认业务员
                    const ywyResult = await yupaiApi.defaultYwy(code.split('-')[0]);
                    if (ywyResult.data) {
                        form.setFieldsValue({
                            Ywy: ywyResult.data.EmployeeName,
                            YwyNo: ywyResult.data.EmployeeNo,
                            DepartmentID: ywyResult.data.DepartmentID
                        });
                    } else {
                        form.setFieldsValue({
                            Ywy: userInfo?.EmpName ?? '',
                            YwyNo: userInfo?.EmpID ?? '',
                            // 这里少部门信息
                        })
                    }
                    setCellErrors({});
                    setOrderChecked(true);
                }
            } catch (error) {
                void message.error(error instanceof ApiError ? error.message : '检测订单号失败');
                setOrderChecked(false);
            } finally {
                setChecking(false);
            }
        }, [form, message, isCopy, userInfo]);

        const handleSave = useCallback(async () => {
            // 先全量校验详情表：有错就标红并拦住提交，避免把不合法的数据发给后端
            const errors = toCellErrors(validateYupaiOrderDetailRows(detailRows));
            const errorCount = Object.keys(errors).length;
            if (errorCount > 0) {
                setCellErrors(errors);
                // 只说「有几处」用户还得满表格找红格 —— 这里把前几条直接列出来，
                // 其余的靠悬停红格看（cellTooltip 会显示同一份提示文案）
                const preview = Object.entries(errors).slice(0, 5).map(([key, detail]) => {
                    const [rowKey] = key.split('#');
                    const rowNo = detailRows.findIndex((row) => rowKeyOf(row) === rowKey) + 1;
                    return `${rowNo > 0 ? `第 ${rowNo} 行：` : ''}${detail}`;
                });
                const rest = errorCount - preview.length;
                void message.error({
                    content: (
                        <div>
                            <div>有 {errorCount} 处数据需要修正（表格里已标红，鼠标移到红格上可看原因）：</div>
                            {preview.map((text) => <div key={text}>· {text}</div>)}
                            {rest > 0 ? <div>· 其余 {rest} 处请在表格中查看</div> : null}
                        </div>
                    ),
                    duration: 6,
                });
                return;
            }
            setCellErrors({});

            // 主数据
            let values: yupaiOrderFormValues;
            try {
                values = await form.validateFields();
                if (values.ZHDate?.isBefore(values.QRDate)) {
                    // 走货期小于确认下单日期
                    if (values.WCDate && values.WCDate.isAfter(values.ZHDate)) {
                        values.ZHDate = values.WCDate.add(3, 'day')
                    }
                    if (values.ZHDate?.isBefore(values.QRDate)) {
                        void message.error("走货期无效");
                        return;
                    }
                }
            } catch {
                return;
            }
            let newDataRows = detailRows.filter(row => !isBlank(row)).map((row): Partial<YupaiOrderDto> => {
                return {
                    ID: toStringOrEmpty(row.YupaiOrderID),
                    OrderCode: toStringOrEmpty(values.OrderCode),
                    YPDate: toDateString(values.YPDate),
                    Ywy: toStringOrEmpty(values.Ywy),
                    YwyNo: toStringOrEmpty(values.YwyNo),
                    DepartmentID: toStringOrEmpty(values.DepartmentID),
                    WorkPlace: toStringOrEmpty(values.WorkPlace),
                    JHDate: toDateString(values.JHDate),
                    QRDate: toDateString(values.QRDate),
                    WCDate: toDateString(values.WCDate),
                    ZHDate: toDateString(values.ZHDate),
                    YLDate: toDateString(values.YLDate),
                    FLDate: toDateString(values.FLDate),
                    BZFLDate: toDateString(values.BZFLDate),
                    XDRate: toStringOrEmpty(values.XDRate),
                    Qty: toNumberOrZero(values.Qty),
                    Memo: toStringOrEmpty(values.Memo),
                    ZQCheckDate: toDateString(values.ZQCheckDate),
                    ZQCheckMemo: toStringOrEmpty(values.ZQCheckMemo),
                    StyleCode: toStringOrEmpty(row.StyleCode),
                    Number: toNumberOrZero(row.Number),
                    ProduceName: toStringOrEmpty(row.ProduceName),
                    Color: toStringOrEmpty(row.Color),
                    TSWorkName: toStringOrEmpty(row.TSWorkName),
                    HDWorkName: toStringOrEmpty(row.HDWorkName),
                    MWeight: toStringOrEmpty(row.MWeight),
                    MSewWt: toNumberOrZero(row.MSewWt),
                    MCycle: toStringOrEmpty(row.MCycle),
                    DataVersion: row.DataVersion,
                    ...YupaiMachineSizeHeader.reduce((acc, _, index) => {
                        acc[`MCSize${index + 1}`] = toNumberOrZero(row[`MCSize${index + 1}`])
                        return acc
                    }, {} as Record<string, number>),
                }
            })
            const newHideRows = hideDatas.map((row): Partial<YupaiOrderDto> => {
                return {
                    ...row,
                    OrderCode: toStringOrEmpty(values.OrderCode),
                    YPDate: toDateString(values.YPDate),
                    Ywy: toStringOrEmpty(values.Ywy),
                    YwyNo: toStringOrEmpty(values.YwyNo),
                    DepartmentID: toStringOrEmpty(values.DepartmentID),
                    WorkPlace: toStringOrEmpty(values.WorkPlace),
                    JHDate: toDateString(values.JHDate),
                    QRDate: toDateString(values.QRDate),
                    WCDate: toDateString(values.WCDate),
                    ZHDate: toDateString(values.ZHDate),
                    YLDate: toDateString(values.YLDate),
                    FLDate: toDateString(values.FLDate),
                    BZFLDate: toDateString(values.BZFLDate),
                    YLDHDate: toDateString(row.YLZLDate),
                    YLZLDate: toDateString(row.YLDHDate),
                    CreateTime: formatDateTime(row.CreateTime),
                    UpdateTime: formatDateTime(row.UpdateTime),
                    XDRate: toStringOrEmpty(values.XDRate),
                    Qty: toNumberOrZero(values.Qty),
                    Memo: toStringOrEmpty(values.Memo),
                    ZQCheckDate: toDateString(values.ZQCheckDate),
                    ZQCheckMemo: toStringOrEmpty(values.ZQCheckMemo),
                }
            })
            newDataRows.push(...newHideRows)
            const totalNum = newDataRows.reduce((acc, row) => acc + toNumberOrZero(row.Number), 0);
            if (totalNum < 1) {
                void message.error("总数量不能为空");
                return;
            }
            newDataRows = newDataRows.map((row) => {
                row.Qty = totalNum;
                return row
            });

            setSaving(true);
            try {
                await yupaiApi.save(newDataRows);
                message.success(isEdit ? '保存成功' : isCopy ? '复制成功' : '新增成功');
                onSaved();
            } catch (error) {
                message.error(error instanceof ApiError ? error.message : '保存失败');
            } finally {
                setSaving(false);
            }
        }, [detailRows, form, message, onSaved, hideDatas, isEdit, isCopy]);

        const modalTitle = isView ? '查看预订单' : isEdit ? '编辑预订单' : isCopy ? '复制预订单' : '新增预订单';

        // DatePicker: open={false} 阻止打开, inputReadOnly 阻止输入
        // Select: open={false} 阻止下拉, allowClear=false 阻止清除
        const dpProps = (locked: boolean) =>
            locked ? {open: false, inputReadOnly: true, allowClear: false} : {allowClear: true};

        const selectProps = (locked: boolean) =>
            locked ? {open: false, allowClear: false} : {allowClear: true};

        // 走货日期变化同步修改
        const zhDateValueChange = useCallback((date: Dayjs | null) => {
            if (date) {
                const wcDate = toDayjs(form.getFieldValue("WCDate"))
                if (wcDate) return;
                const orderCode = toStringOrEmpty(form.getFieldValue("OrderCode"));
                if (!orderCode) return;
                if (orderCode.startsWith("HL") || orderCode.startsWith("HG")) {
                    form.setFieldValue("WCDate", date.add(-3, 'day'))
                } else if (orderCode.startsWith("FT")) {
                    form.setFieldValue("WCDate", date.add(-7, 'day'))
                }
            }
        }, [form])

        // 确认日期变化同步修改
        const qrDateValueChange = useCallback((date: Dayjs | null) => {
            if (date) {
                setMaxYLDate(date);
                setMaxFLDate(date);
                setMinZHDate(date);
                setMinWCDate(date);
                const orderCode = toStringOrEmpty(form.getFieldValue("OrderCode"));
                if (!orderCode) return;
                if (orderCode.startsWith("HG")) {
                    const ylDate = toDayjs(form.getFieldValue("YLDate"))
                    const flDate = toDayjs(form.getFieldValue("FLDate"))
                    if (!ylDate) {
                        form.setFieldValue("YLDate", date.add(-15, 'day'))
                    }
                    if (!flDate) {
                        form.setFieldValue("FLDate", date.add(-15, 'day'))
                    }
                }
            }
        }, [form, setMaxYLDate, setMaxFLDate, setMinZHDate, setMinWCDate])

        // 计划日期变化同步修改
        const jhDateValueChange = useCallback((date: Dayjs | null) => {
            if (date) {
                // 所有订单计划下单时间=确认下单时间
                form.setFieldValue("QRDate", date);
                const orderCode = toStringOrEmpty(form.getFieldValue("OrderCode"));
                if (!orderCode) return;
                if (orderCode.startsWith("HL")) {
                    const flDate = toDayjs(form.getFieldValue("FLDate"))
                    if (!flDate) {
                        form.setFieldValue("FLDate", date.add(-9, 'day'))
                    }
                } else if (orderCode.startsWith("FT")) {
                    const ylDate = toDayjs(form.getFieldValue("YLDate"))
                    if (!ylDate) {
                        form.setFieldValue("YLDate", date.add(-30, 'day'))
                    }
                    const flDate = toDayjs(ylDate)
                    if (!flDate) {
                        form.setFieldValue("FLDate", date.add(-7, 'day'))
                    }
                }
                qrDateValueChange(date)
            }
        }, [form, qrDateValueChange])

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
                loading={isLoading}
            >
                <Form
                    form={form}
                    component={false}
                    className="preorder-form"
                    // 订单号变化同步给明细的款号查重（见 yupaiOrderEditColumns 的 currentOrderCode）。
                    // 用 onFieldsChange 而不是 onValuesChange：后者只在**用户交互**时触发，
                    // 而订单号还会被 setFieldsValue 程序化写入（打开弹窗预填、点检测覆盖），
                    // onFieldsChange 两种情况都能收到 —— 所以这一处就够，别处不用再手动同步。
                    onFieldsChange={(changed) => {
                        const hit = changed.find((item) => {
                            const path = Array.isArray(item.name) ? item.name : [item.name];
                            return path[0] === 'OrderCode';
                        });
                        if (hit) {
                            setCurrentOrderCode(String(hit.value ?? ''));
                        }
                    }}
                >
                    <div className="preorder-form-toolbar">
                        <span className="pf-label">订单号</span>
                        <Form.Item name="OrderCode" noStyle
                                   rules={[{required: true, message: '订单号不能为空'}]}>
                            <Input
                                style={{width: 150}}
                                // allowClear 必须恒定：它决定 antd 要不要套 affix（后缀）容器 ——
                                // 跟着锁定态翻会在聚焦时摘/挂容器，导致 input 重建、失焦
                                // （控制台报 dynamic add or remove prefix / suffix）。
                                // 锁定由 readOnly 表达即可，清除图标本来就只在非锁定态显示。
                                allowClear
                                placeholder="订单号"
                                readOnly={toolbarLocked}

                            />
                        </Form.Item>
                        {(isAdd || isCopy) && (
                            <Button loading={checking} disabled={disabled} onClick={handleCheck}>
                                检测
                            </Button>
                        )}
                        <span className="pf-label pf-toolbar-gap">预排日期</span>
                        <Form.Item name="YPDate" noStyle
                                   rules={[{required: true, message: '预排日期不能为空'}]}>
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
                                <Form.Item name="Ywy" noStyle rules={[{required: true, message: '业务员不能为空'}]}>
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
                            {/*
                              业务员的两个附带字段：界面上没有输入框，值由「快速选择业务员」和
                              「检测订单号」联动写入。**必须挂一个 Form.Item 让它们「注册」进表单**，
                              否则：
                              - `validateFields()` / `getFieldsValue()` 都取不到它们
                                （rc-field-form 只遍历注册过的字段实体，见 useForm.js 的
                                `getFieldEntities(true)` → `getFieldsValue(finalValueNamePathList)`），
                                提交时 payload 里也就没有这两个字段；
                              - `resetFields()` 同样只重置注册字段，换订单检测时旧值会残留
                                （buildValues 里没有这两个字段，覆盖不掉上一个订单带出来的值）。
                              hidden 只是不显示，值照常参与校验与取值。
                            */}
                            <Form.Item name="YwyNo" hidden>
                                <Input/>
                            </Form.Item>
                            <Form.Item name="DepartmentID" hidden>
                                <Input/>
                            </Form.Item>
                            <Field label="产地" required>
                                <Form.Item name="WorkPlace" noStyle rules={[{required: true, message: '产地不能为空'}]}>
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
                                        onChange={jhDateValueChange}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="确认可下单期">
                                <Form.Item name="QRDate" noStyle>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                        onChange={qrDateValueChange}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="尾货期">
                                <Form.Item
                                    name="WCDate"
                                    noStyle
                                >
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                        minDate={minWCDate}
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
                                        onChange={zhDateValueChange}
                                        minDate={minZHDate}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="原料可下单期" required>
                                <Form.Item name="YLDate" noStyle
                                           rules={[{required: true, message: '请选择原料可下单期'}]}>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                        maxDate={maxYLDate}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="缝制辅料可下单期" required>
                                <Form.Item name="FLDate" noStyle
                                           rules={[{required: true, message: '请选择缝制辅料可下单期'}]}>
                                    <DatePicker
                                        style={{width: 150}}
                                        format={DATE_FORMAT}
                                        {...dpProps(detailLocked)}
                                        maxDate={maxFLDate}
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="包装辅料提供期" required>
                                <Form.Item name="BZFLDate" noStyle
                                           rules={[{required: true, message: '请选择包装辅料提供期'}]}>
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
                                        allowClear
                                    />
                                </Form.Item>
                            </Field>
                            <Field label="总数量:">
                                <Form.Item name="Qty" noStyle>
                                    <InputNumber
                                        style={{width: 130}}
                                        min={0}
                                        readOnly={true}
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="pf-row">
                            <Field label="备注" grow>
                                <Form.Item name="Memo" noStyle>
                                    <Input
                                        placeholder="备注"
                                        readOnly={detailLocked}
                                        allowClear
                                    />
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
                                        allowClear
                                    />
                                </Form.Item>
                            </Field>
                        </div>

                        <div className="preorder-detail-grid">
                            <GridTable
                                ref={tableRef}
                                columns={detailColumns}
                                records={detailRows as unknown as Array<Record<string, unknown>>}
                                rowKey="_id"
                                editableFields={detailLocked ? undefined : DETAIL_EDITOR_FIELDS}
                                onCellValueChange={handleDetailChange}
                                cellStyle={detailCellStyle}
                                cellTooltip={detailCellTooltip}
                                menu={detailMenu}
                            />
                            {detailRows.length === 0 && <div className="preorder-detail-empty">没有任何记录</div>}
                        </div>
                    </fieldset>
                </Form>
                <EmployeeQuickSelect
                    open={employeeOpen}
                    title="快速选择-业务员"
                    loadData={async () => (await employeeApi.list()).data ?? []}
                    onSelect={(employee) => {
                        // 后端 /employee 的姓名字段就叫 Employee（不是 EmployeeName）
                        form.setFieldValue('Ywy', employee.Employee);
                        form.setFieldValue('YwyNo', employee.EmployeeNo);
                        form.setFieldValue('DepartmentID', employee.DepartmentID);
                        setEmployeeOpen(false);
                    }}
                    onCancel={() => setEmployeeOpen(false)}
                />
            </Modal>
        );
    }
;

export default YupaiOrderEdit;
