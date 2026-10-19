import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {App, Button, DatePicker, Form, Input, Select, Space} from "antd";
import {type ViewRowStatus} from "@/api";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {ReloadOutlined, SearchOutlined} from "@ant-design/icons";
import {FilterTable, type VTableCellStyle, type VTableCellStyleInfo} from "@/components/vtable";
import type {Dayjs} from "dayjs";
import type {YupaiOrderChangeDetail} from "@/api/modules/yupai.ts";
import {yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";
import {DATE_FORMAT} from "@/utils";
import {buildYupaiOrderChangeListColumns} from "@/pages/views/V0189/V0279/V0281/columns.ts";

interface SearchValues {
    orderCode?: string;
    dateRange?: [Dayjs, Dayjs];
}

const statusMap: Record<ViewRowStatus, { color: string; label: string }> = {
    enabled: {color: '#52c41a', label: '正常'},
    disabled: {color: '#8c8c8c', label: '停用'},
};

const statusOptions = Object.entries(statusMap).map(([value, {label}]) => ({value, label}));

const YupaiOrderChangePage: React.FC<ViewPageProps> = ({trail}) => {
    const {message} = App.useApp();
    const [form] = Form.useForm<SearchValues>();
    const [dataSource, setDataSource] = useState<YupaiOrderChangeDetail[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState<{ orderCode?: string, startDate?: string, endDate?: string }>({});

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
        switch (info.record.ActionCode) {
            case 0:
                styles.backgroundColor = '#FF20B2AA'
                break;
            case 1:
                styles.backgroundColor = '#FFEEE8AA'
                break;
            case 2:
                styles.backgroundColor = '#FFDB7093'
                break;
            case 3:
                styles.backgroundColor = '#FF7FFFD4'
                break;
        }
        return styles
    }, [dataSource, columns])

    useEffect(() => {
        void loadData();
    }, [loadData, query]);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                onFinish={(values: SearchValues) => {
                    setQuery({
                        orderCode: values?.orderCode,
                        startDate: values.dateRange?.[0]?.format(DATE_FORMAT),
                        endDate: values.dateRange?.[1]?.format(DATE_FORMAT),
                    });
                }}
            >
                {/* 字段名要和 onFinish 里读的 key 一致（原来是 keyword，读的却是 orderCode，条件永远传不进去） */}
                <Form.Item name="orderCode">
                    <Input placeholder="订单号" allowClear/>
                </Form.Item>
                <Form.Item name="status">
                    <Select placeholder="状态" allowClear style={{width: 120}} options={statusOptions}/>
                </Form.Item>
                <Form.Item name="dateRange">
                    <DatePicker.RangePicker/>
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
                                setQuery({});
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
            <FilterTable columns={columns} records={dataSource} loading={loading} rowKey={'YupaiOrderChangeID'}
                         cellStyle={cellStyle}/>

        </div>
    );
};

export default YupaiOrderChangePage;
