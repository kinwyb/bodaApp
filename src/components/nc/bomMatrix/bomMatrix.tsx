import React, {useEffect, useState} from "react";
import type {BomMatrix} from "@/api/schemas/nc/bomMatrix.ts";
import {Button, Tabs, type TabsProps} from "antd";
import BomMatrixItemView from "./itemView.tsx";
import BomMatrixSizeView from "./sizeView.tsx";
import BomMatrixColorView from "@/components/nc/bomMatrix/colorView.tsx";

export type BomMatrixViewProps = {
    bomMatrix: BomMatrix;
    tabs?: TabsProps['items'];
    isEditMode?: boolean;
}

export const BomMatrixView: React.FC<BomMatrixViewProps> = ({bomMatrix, tabs, isEditMode}) => {

    const [items, setItems] = useState<TabsProps['items']>([]);
    const [isEdit, setIsEdit] = useState(isEditMode ?? false);

    useEffect(() => {
        setItems([
            {
                label: '子项物料',
                key: 'items',
                children: <BomMatrixItemView items={bomMatrix.Detail ?? []} isEditable={isEdit}/>,
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
            }, ...(tabs ?? [])]);
    }, [bomMatrix, tabs, isEdit]);

    return (
        <>
            <Button title={'编辑'} onClick={() => {
                console.log("编辑");
                setIsEdit(!isEdit);
            }}>编辑 </Button>
            <Tabs
                className="grid-table-expand-tabs page-tabs-fill"
                defaultActiveKey="1"
                size={'small'}
                items={items}
            />
        </>
    );
}

export default BomMatrixView;