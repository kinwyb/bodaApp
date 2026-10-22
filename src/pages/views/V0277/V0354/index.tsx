import React, {useEffect, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";
import {BomMatrixView} from "@/components/nc/bomMatrix";
import type {PackBomMatrix} from "@/api/schemas/nc/packBomMatrix.ts";
import {Button} from "antd";
import NCMaterial from "@/components/nc/materialModal.tsx";

const NCPackBomMatrixPage: React.FC<ViewPageProps> = ({trail}) => {

    const [bomMatrix, setBomMatrix] = useState<PackBomMatrix>({});
    const [openModal, setOpenModal] = useState<boolean>(false);

    useEffect(() => {
        packBomMatrixApi.detail("241C0A56-B08C-4E41-867D-AEECBA89E851").then((res) => {
            console.log(res);
            setBomMatrix(res.data ?? {});
        });
    }, []);

    return (
        <div className="page-container page-fill">
            <PageBreadcrumb trail={trail}/>
            <Button onClick={() => {
                setOpenModal(true);
            }}>点击</Button>
            <BomMatrixView bomMatrix={bomMatrix}/>
            <NCMaterial open={openModal} onCancel={() => setOpenModal(false)}/>
        </div>
    );
}

export default NCPackBomMatrixPage;