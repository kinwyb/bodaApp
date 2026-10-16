import React, {useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import BITree from "./biTree";
import {QueryParam} from "@/pages/views/V0018/V0112/query.tsx";
import type {BIList} from "@/api/modules/bi.ts";


/**
 * 常规报表界面
 * @param param0
 * @param param0.view
 * @param param0.trail
 */
const biPage: React.FC<ViewPageProps> = ({trail}) => {

    const [queryNode, setQueryNode] = useState<BIList>();
    const [openQuery, setOpenQuery] = useState<boolean>(false);

    return (
        <>
            <div className="page-container page-fill">
                <PageBreadcrumb trail={trail}/>
                <BITree open={(node) => {
                    console.log("open", node);
                    setQueryNode(node);
                    setOpenQuery(true);
                }}></BITree>
            </div>
            <QueryParam node={queryNode} open={openQuery}
                        onClose={() => setOpenQuery(false)}/>
        </>
    );
}

export default biPage;