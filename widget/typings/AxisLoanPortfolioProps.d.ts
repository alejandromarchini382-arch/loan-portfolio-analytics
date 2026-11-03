/**
 * This file was generated from AxisLoanPortfolio.xml
 * WARNING: All changes made to this file will be overwritten
 * @author Mendix Widgets Framework Team
 */
import { ActionValue, DynamicValue } from "mendix";
import { CSSProperties } from "react";

export type PrimaryEnum = "division" | "loanOfficer" | "borrowerType" | "riskRating";

export type SecondaryEnum = "none" | "division" | "loanOfficer" | "borrowerType" | "riskRating";

export interface AxisLoanPortfolioContainerProps {
    name: string;
    class: string;
    style?: CSSProperties;
    tabIndex?: number;
    apiBaseUrl: string;
    title: string;
    primary: PrimaryEnum;
    secondary: SecondaryEnum;
    pageSize: number;
    showRisk: boolean;
    accessToken: DynamicValue<string>;
    sessionScope: DynamicValue<string>;
    canReadRisk: DynamicValue<boolean>;
    canRunRisk: DynamicValue<boolean>;
    renewSession?: ActionValue;
}

export interface AxisLoanPortfolioPreviewProps {
    /**
     * @deprecated Deprecated since version 9.18.0. Please use class property instead.
     */
    className: string;
    class: string;
    style: string;
    styleObject?: CSSProperties;
    readOnly: boolean;
    renderMode: "design" | "xray" | "structure";
    translate: (text: string) => string;
    apiBaseUrl: string;
    title: string;
    primary: PrimaryEnum;
    secondary: SecondaryEnum;
    pageSize: number | null;
    showRisk: boolean;
    accessToken: string;
    sessionScope: string;
    canReadRisk: string;
    canRunRisk: string;
    renewSession: {} | null;
}
