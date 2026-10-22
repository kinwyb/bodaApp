import React from "react";
import type {PackBomMatrix} from "@/api/schemas/nc/packBomMatrix.ts";

export type BomMatrixColorViewProps = {
    bomMatrix: PackBomMatrix;
}

// interface bomMatrixColorData {
//     VRowNo: string;
//     MaterialVID: string;
//     MaterialCode: string;
//     MaterialName: string;
//     MaterialVersion: string;
//     MaterialSpec: string;
//     MaterialType: string;
//     VFree5Name: string;
//     VFree1Name: string;
//     VFree9Name: string;
//     VFree4Name: string;
// }

const BomMatrixColorView: React.FC<BomMatrixColorViewProps> = ({}) => {
    return (
        <div className="page-container page-fill">
            color view
        </div>
    );
}

export default BomMatrixColorView;