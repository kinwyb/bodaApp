import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {App, Button, DatePicker, Form, Input, Select, Space} from "antd";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {ReloadOutlined, SearchOutlined} from "@ant-design/icons";
import {
    FilterTable,
    type MergeGroupConfig,
    type VTableApi,
    type VTableCellStyle,
    type VTableCellStyleInfo
} from "@/components/vtable";
import {type Dayjs} from "dayjs";
import type {YupaiOrderChangeAction, YupaiOrderChangeDetail} from "@/api/modules/yupai.ts";
import {yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";
import {DATE_FORMAT, formatDate, now} from "@/utils";
import {
    buildYupaiOrderChangeListColumns,
    yupaiOrderChangeListFilterFields
} from "@/pages/views/V0189/V0279/V0281/columns.ts";
import {CommandBar} from "@/components/CommandBar.tsx";
import {useTableExportCommand} from "@/components/commands/exportCommand.tsx";

interface SearchValues {
    orderCode?: string;
    dateRange?: [Dayjs, Dayjs];
}

const actionMap: Record<YupaiOrderChangeAction, { color: string; label: string }> = {
    0: {color: '#FF20B2AA', label: '新增'},
    1: {color: '#FFEEE8AA', label: '更新'},
    2: {color: '#FFDB7093', label: '删除'},
    3: {color: '#FF7FFFD4', label: '恢复'},
    4: {color: '#FF000000', label: '下生产单'},
};

const mergeColumnGroup: MergeGroupConfig = {
    mergeColumnSort: ["ChangeDate", "OrderCode", "WorkPlace", "StyleCode", "ProductName", "Number", "QRDate", "ZHDate", "ActionName"],
    topMergeColumn: ["ChangeDate", "OrderCode"]
} as const;

const actionOptions = Object.entries(actionMap).map(([value, {label}]) => ({value, label}));

const YupaiOrderChangePage: React.FC<ViewPageProps> = ({view, trail}) => {

    const startDate = now().add(-7, "day");
    const endDate = now();

    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const [dataSource, setDataSource] = useState<YupaiOrderChangeDetail[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState<{
        orderCode?: string,
        startDate?: string,
        endDate?: string
    }>({startDate: formatDate(startDate), endDate: formatDate(endDate)});
    const tableRef = useRef<VTableApi | null>(null);

    const commands = useTableExportCommand(tableRef, '预订单变更记录');

    const loadData = useCallback(
        async () => {
            setLoading(true);
            try {
                const res = await yupaiService.changeList(query.orderCode, query.startDate, query.endDate);
                setDataSource(res.data ?? []);
            } catch (error) {
                void message.error(ErrorMessage(error, '加载数据失败'));
            } finally {
                setLoading(false);
            }
        },
        [message, query],
    );

    const columns = useMemo(() => buildYupaiOrderChangeListColumns(), []);

    const cellStyle = useCallback((info: VTableCellStyleInfo) => {
        if (info.isSummaryRow || !info.record || info.field != 'ActionName') return undefined;
        let styles: VTableCellStyle = {}
        const actionOptions = actionMap[info.record.ActionCode as YupaiOrderChangeAction];
        styles.backgroundColor = actionOptions.color;
        return styles
    }, [dataSource, columns])

    useEffect(() => {
        void loadData();
    }, [loadData, query]);

    useEffect(() => {
        form.setFieldValue("dateRange", [startDate, endDate]);
    }, []);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            {commands.length > 0 && <CommandBar view={view} items={commands}/>}
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 20}}
                onFinish={(values: SearchValues) => {
                    setQuery({
                        orderCode: values?.orderCode,
                        startDate: values.dateRange?.[0]?.format(DATE_FORMAT),
                        endDate: values.dateRange?.[1]?.format(DATE_FORMAT),
                    });
                }}
            >
                <Form.Item name="status" hidden={true}>
                    <Select placeholder="状态" allowClear style={{width: 120}} options={actionOptions}/>
                </Form.Item>
                <Form.Item name="dateRange">
                    <DatePicker.RangePicker/>
                </Form.Item>
                <Form.Item name="orderCode">
                    <Input placeholder="订单号" allowClear/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            搜索
                        </Button>
                        <Button
                            icon={<ReloadOutlined/>}
                            onClick={() => {
                                form.resetFields();
                                form.setFieldValue("dateRange", [startDate, endDate]);
                                setQuery({
                                    startDate: formatDate(startDate),
                                    endDate: formatDate(endDate),
                                })
                            }}
                        >
                            重置
                        </Button>
                    </Space>
                </Form.Item>
            </Form>

            {/*
              不要在外面再包一层 .vtable-host：FilterTable 自身根节点是 .filter-table（flex:1 1 0），
              必须作为 .page-container（flex 列）的直接子项才能拿到剩余高度。
              外面套一个 .vtable-host（它只是 flex item，不是 flex 容器），.filter-table 的高度就变成 auto，
              里面那层 .vtable-host（flex-basis:0）会塌成 0 高 —— 画布高度 0，表现为整块空白。
            */}
            <FilterTable ref={tableRef} columns={columns} records={dataSource} loading={loading}
                         rowKey={'YupaiOrderChangeID'}
                         cellStyle={cellStyle} mergeGroups={mergeColumnGroup}
                         filterFields={yupaiOrderChangeListFilterFields}/>

        </div>
    );
};

export default YupaiOrderChangePage;
