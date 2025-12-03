export type DiscoveryStatus =
  | "panel"
  | "not-panel"
  | "no-response"
  | "error"
  | "pending";

export interface DiscoveryRequest {
  baseIp: string;
  start: number;
  end: number;
}

export interface DiscoveryResult {
  ip: string;
  status: DiscoveryStatus;
  httpStatus?: number;
  errorMessage?: string;
  name?: string | null;
  panelHtml?: string;
}

export interface DiscoverySummary {
  baseIp: string;
  start: number;
  end: number;
  totalChecked: number;
  panelsFound: number;
  notPanels: number;
  noResponse: number;
  errors: number;
}

export interface DiscoveryResponse {
  summary: DiscoverySummary;
  results: DiscoveryResult[];
}

export interface PanelInfo {
  ip: string;
  isCubixx: boolean;
  name?: string;
  link?: string;
  baselineFingerprint?: string | null;
  lastFingerprint?: string | null;
  touched?: boolean;
}

