import React, {useState} from "react";
import type {ViewPageProps} from "@/pages/types.ts";
import {PageBreadcrumb} from "@/components/PageBreadcrumb.tsx";
import BITree from "./biTree";
import {BIQueryParam} from "./biQuery.tsx";
import type {BIList} from "@/api/modules/bi.ts";
import {Splitter} from "antd";
import BITable from "@/pages/views/V0018/V0112/biTable.tsx";
import {isDebugEnv} from "@/utils";


/**
 * 常规报表界面
 * @param param0
 * @param param0.view
 * @param param0.trail
 */
const biPage: React.FC<ViewPageProps> = ({trail}) => {

    const [queryNode, setQueryNode] = useState<BIList>();
    const [selectedNode, setSelectedNode] = useState<BIList>();
    const [openQuery, setOpenQuery] = useState<boolean>(false);

    return (
        <>
            <div className="page-container page-fill">
                <PageBreadcrumb trail={trail}/>
                <Splitter style={{
                    flex: 1,
                    minHeight: 0,
                    height: 'auto',
                    boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)',
                    borderRadius: "10px",
                    overflow: 'hidden'
                }}>
                    <Splitter.Panel defaultSize="20%" min="15%" max="40%">
                        <BITree open={(node) => {
                            setSelectedNode(node);
                            setOpenQuery(true);
                        }}></BITree>
                    </Splitter.Panel>
                    <Splitter.Panel>
                        <BITable node={queryNode}/>
                    </Splitter.Panel>
                </Splitter>
            </div>
            <BIQueryParam node={selectedNode} open={openQuery}
                          query={(node) => {
                              setQueryNode({...node});
                              isDebugEnv && console.log("查询：", node);
                              setOpenQuery(false);
                          }}
                          onClose={() => setOpenQuery(false)}/>
        </>
    );
}

export default biPage;