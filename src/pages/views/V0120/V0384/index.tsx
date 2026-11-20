import React from 'react';
import {misReportApi} from '@/api';
import type {ViewPageProps} from '@/pages/types';
import {EfficiencyReportPage} from '../efficiencyReport';
import {createMechanicEfficiencyBridge} from './bridged';

import { createPageTranslator } from '@/i18n';

const t = createPageTranslator("V0120_V0384");


const MechanicEfficiencyPage: React.FC<ViewPageProps> = (props) => (
    <EfficiencyReportPage
        {...props}
        title={t("MIS > 机修工效率")}
        exportName={t("机修工效率")}
        loadReport={misReportApi.mechanicRate}
        createBridge={createMechanicEfficiencyBridge}
    />
);

export default MechanicEfficiencyPage;
