import React, {useEffect, useState} from "react";
import type {PackBomMatrix} from "@/api/schemas/nc/packBomMatrix.ts";
import {Tabs, type TabsProps} from "antd";
import BomMatrixItemView from "./itemView.tsx";
import type {ViewPageProps} from "@/pages/types.ts";
import BomMatrixSizeView from "./sizeView.tsx";
import BomMatrixColorView from "@/components/nc/bomMatrix/colorView.tsx";

export type BomMatrixViewProps = ViewPageProps & {
    bomMatrix: PackBomMatrix;
}

export const BomMatrixView: React.FC<BomMatrixViewProps> = ({bomMatrix}) => {

    const [items, setItems] = useState<TabsProps['items']>([]);

    useEffect(() => {
        setItems([
            {
                label: '子项物料',
                key: 'items',
                children: <BomMatrixItemView items={bomMatrix.Detail ?? []}/>,
            },
            {
                label: '配色',
                key: 'colors',
                children: <BomMatrixColorView bomMatrix={bomMatrix}/>,
            },
            {
                label: '配码',
                key: 'sizes',
                children: <BomMatrixSizeView bomMatrix={bomMatrix}/>,
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