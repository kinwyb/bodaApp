import React, {useEffect, useState} from "react";
import type {PackBomMatrix} from "@/api/schemas/nc/packBomMatrix.ts";
import {Tabs, type TabsProps} from "antd";
import ItemView from "@/components/nc/bomMatrix/itemView.tsx";

export type BomMatrixViewProps = {
    bomMatrix: PackBomMatrix;
}

export const BomMatrixView: React.FC<BomMatrixViewProps> = ({bomMatrix}) => {

    const [items, setItems] = useState<TabsProps['items']>([]);

    useEffect(() => {
        console.log("view", bomMatrix);
        setItems([
            {
                label: '子项物料',
                key: 'items',
                children: <ItemView items={bomMatrix.Detail ?? []}/>,
            },
            {
                label: 'Tab 2',
                key: '2',
                children: 'Content of editable tab 2',
            },
            {
                label: 'Tab 3',
                key: '3',
                children: 'Content of editable tab 3',
            }]);
    }, [bomMatrix]);

    return (
        <Tabs
            className="grid-table-expand-tabs"
            defaultActiveKey="1"
            size={'small'}
            style={{marginBottom: 32}}
            items={items}
        />
    );
}

export default BomMatrixView;