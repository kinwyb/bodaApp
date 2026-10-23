import React, {useEffect, useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import {packBomMatrixApi} from "@/api/modules/nc/bomMatrix.ts";
import {BomMatrixView} from "@/components/nc/bomMatrix";
import type {PackBomMatrix} from "@/api/schemas/nc/packBomMatrix.ts";
import {Button} from "antd";
import NCMaterialModal from "@/components/nc/materialModal.tsx";
import type {NCMaterial} from "@/api/schemas/nc/NCMaterial.ts";
import NCMaterialVFreeModal from "@/components/nc/materialVFreeModal.tsx";

const NCPackBomMatrixPage: React.FC<ViewPageProps> = ({trail}) => {

    const [bomMatrix, setBomMatrix] = useState<PackBomMatrix>({});
    const [openModal, setOpenModal] = useState<boolean>(false);
    const [openModal2, setOpenModal2] = useState<boolean>(false);
    const [material, setMaterial] = useState<NCMaterial | undefined>();

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
            }}>点击物料</Button>
            <Button onClick={() => {
                setOpenModal2(true);
            }}>点击单位</Button>
            <BomMatrixView bomMatrix={bomMatrix}/>
            <NCMaterialModal open={openModal} onCancel={() => setOpenModal(false)}
                             onSelect={(material, activeRow) => {
                                 console.log("物料", material);
                                 console.log(activeRow);
                                 setMaterial(material);
                             }}/>

            <NCMaterialVFreeModal open={openModal2} onCancel={() => setOpenModal2(false)}
                                  onSelect={(material, activeRow) => {
                                      console.log("辅助属性", material);
                                      console.log(activeRow);
                                  }} materialVID={material?.pk_material ?? ''} vfreeField={'vfree4'}/>
        </div>
    );
}

export default NCPackBomMatrixPage;