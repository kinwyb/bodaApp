import React, {useMemo} from 'react';
import type {YupaiOrder} from '@/api';
import {VTable} from "@/components/vtable";
import {buildColumns} from "@/components/vtable/columnBuilder.ts";
import {toNumberOrZero} from "@/utils";
import {Tabs, type TabsProps} from "antd";

/**
 * 一次订单号修改的完整信息（展开区 -> 页面）。
 *
 * `record` 一并带上是给「接后端」留的：订单号是**单据级**字段，真要回写时得靠它的 `ID`
 * 认出是哪一行、用 `previous` 把整单捞回来（见页面里的 handleOrderCodeSave）。
 */
export interface YupaiOrderCodeChange {
    /** 用户输入的新订单号（已 trim） */
    orderCode: string;
    /** 改动前的订单号 */
    previous: string;
    /** 触发修改的那一行数据 */
    record: YupaiOrder;
}

export interface YupaiOrderMasterDetailProps {
    /** 展开行对应的记录（明细表格的数据） */
    records: Record<string, unknown>[];
}

/**
 * 展开区里的明细内容：一个 tab 里放表格。
 *
 * ⚠️ 高度必须一路传下去：VTable 的根节点是 `height: 100%`，只要祖先里有一环没有确定高度，
 * 它就量不到高度、画不出 canvas（表现为表格整个空白）。所以：
 * - 外层**不能**用 `display:flex + alignItems:center` —— 那会让 Tabs 在垂直方向居中、
 *   高度只按内容算（看起来就是「tab 悬在区域中间、里面什么都没有」）；
 * - Tabs 也不会自己撑满，得靠 `.vtable-expand-tabs` 那几条规则把 `height:100%` 与
 *   `flex:1` 逐层下发到 tabpane（见 index.css）。
 */
const YupaiOrderMasterDetail: React.FC<YupaiOrderMasterDetailProps> = ({records}) => {

    const columns = useMemo(() => {
        return buildColumns([
            {
                field: 'BatchDate', title: '出货日期', width: 80, dataType: "date"
            },
            {
                field: 'BatchRate', title: '出货比例', width: 80, dataType: "number", columnProps: {
                    fieldFormat: (record: Record<string, unknown>) => {
                        const rate = toNumberOrZero(record.BatchRate);
                        return rate.toFixed(2) + "%";
                    },
                }
            },
        ]);
    }, []);

    const items: TabsProps['items'] = [
        {
            key: '1',
            label: '分批信息',
            children: <VTable columns={columns} records={records}/>,
        }
    ];

    return (
        <div style={{height: '100%', padding: 10, boxSizing: 'border-box'}}>
            <Tabs className="vtable-expand-tabs" defaultActiveKey="1" items={items}/>
        </div>
    );
};

export default YupaiOrderMasterDetail;
