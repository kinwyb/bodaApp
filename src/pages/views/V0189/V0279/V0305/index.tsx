import React, {useCallback, useEffect, useRef, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {Button, DatePicker, Form, message, Space} from "antd";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {SearchOutlined} from "@ant-design/icons";
import {FilterTable, type GridTableApi} from "@/components/grid-table";
import {YUPAIALLGROUP_COLUMNS} from "@/pages/views/V0189/V0279/V0305/columns.ts";
import {type Dayjs} from "dayjs";
import {now} from "@/utils";
import {type YupaiAllGroup, yupaiService} from "@/services/yupai.ts";
import {ErrorMessage} from "@/api/request.ts";


const YupaiOrderAllGroupPage: React.FC<ViewPageProps> = ({trail}) => {

    const tableRef = useRef<GridTableApi | null>(null);
    const [form] = Form.useForm<{ year?: Dayjs }>();
    const [dataSource, setDataSource] = useState<YupaiAllGroup[]>([]);
    const [loading, setLoading] = useState(false);
    const [year, setYear] = useState<string>(now().format("YYYY"));

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const reuslt = await yupaiService.allGroup(year);
            setDataSource(reuslt);
        } catch (error) {
            void message.error(ErrorMessage(error, '加载失败'));
        } finally {
            setLoading(false);
        }
    }, [year])

    /** 表单初值只在挂载时给一次；不能和数据加载放同一个 effect，否则每次查询都会把选中的年份重置回今年 */
    useEffect(() => {
        form.setFieldValue("year", now());
    }, [form]);

    /** year 变化（含首次挂载）就重新拉数据 */
    useEffect(() => {
        void loadData();
    }, [loadData]);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Form
                className="page-search"
                form={form}
                layout="inline"
                style={{marginTop: 20}}
                onFinish={(values: { year?: Dayjs }) => {
                    setYear(values.year?.format("YYYY") ?? now().format('YYYY'));
                }}
            >
                <Form.Item name="year">
                    <DatePicker picker="year"/>
                </Form.Item>
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" icon={<SearchOutlined/>}>
                            查询
                        </Button>
                    </Space>
                </Form.Item>
            </Form>
            <FilterTable ref={tableRef} columns={YUPAIALLGROUP_COLUMNS} records={dataSource} loading={loading}
                         rowKey={'_id'} exportName={'全订单汇总'} groupable={true}/>

        </div>
    );
}
export default YupaiOrderAllGroupPage;