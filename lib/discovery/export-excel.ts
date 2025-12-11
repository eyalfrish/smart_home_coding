import * as XLSX from 'xlsx';
import type { DiscoveryResult, PanelInfo, LivePanelState } from './types';

interface ExportData {
  results: DiscoveryResult[];
  panelInfoMap: Record<string, PanelInfo>;
  livePanelStates?: Map<string, LivePanelState>;
}

/**
 * Generate a sortable datetime string for filenames: YYYYMMDD_HHmmss
 */
function getSortableDateTime(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

// Status display names for export
const statusLabels: Record<string, string> = {
  panel: 'Cubixx Panel',
  'not-panel': 'Other HTTP Device',
  'no-response': 'No Response',
  error: 'Error',
  pending: 'Scanning',
  initial: 'Not Scanned',
};

/**
 * Export discovery results to an Excel file and trigger download
 */
export function exportDiscoveryToExcel(data: ExportData): void {
  const { results, panelInfoMap, livePanelStates } = data;

  // Prepare rows for Excel - export ALL results, not just panels
  const rows = results.map(result => {
    const metadata = panelInfoMap[result.ip];
    const liveState = livePanelStates?.get(result.ip);
    const fullState = liveState?.fullState;
    const isPanel = result.status === 'panel';

    // Get live state summary (lights/shades status) - only for panels
    const getLiveStateSummary = () => {
      if (!fullState || !isPanel) return '';
      
      const lightRelays = fullState.relays.filter(r => {
        if (!r.name || r.name.trim() === '') return false;
        if (/^Relay\s+\d+$/i.test(r.name.trim())) return false;
        const name = r.name.toLowerCase();
        if (name.includes('door') || name.includes('lock') || name.includes('unlock')) return false;
        return true;
      });
      
      const doorRelays = fullState.relays.filter(r => {
        if (!r.name) return false;
        const name = r.name.toLowerCase();
        return name.includes('door') || name.includes('lock') || name.includes('unlock');
      });
      
      const configuredCurtains = fullState.curtains.filter(c => {
        if (!c.name || c.name.trim() === '') return false;
        if (/^Curtain\s+\d+$/i.test(c.name.trim())) return false;
        return true;
      });

      const parts: string[] = [];
      
      if (lightRelays.length > 0) {
        const onCount = lightRelays.filter(r => r.state).length;
        parts.push(`Lights: ${onCount}/${lightRelays.length} on`);
      }
      
      if (doorRelays.length > 0) {
        const onCount = doorRelays.filter(r => r.state).length;
        parts.push(`Doors: ${onCount}/${doorRelays.length}`);
      }
      
      if (configuredCurtains.length > 0) {
        parts.push(`Shades: ${configuredCurtains.length}`);
      }
      
      return parts.join(', ');
    };

    // Determine display status
    const getDisplayStatus = () => {
      if (isPanel && liveState?.connectionStatus === 'connected') {
        return 'Cubixx Panel (LIVE)';
      }
      return statusLabels[result.status] ?? result.status;
    };

    // Generate notes text - for panels, show discovery time; for others, show error message
    const getNotesText = (r: typeof result) => {
      if (r.status === 'panel' && r.discoveryTimeMs != null) {
        return `Discovered in ${r.discoveryTimeMs}ms`;
      }
      return r.errorMessage ?? '';
    };

    return {
      'IP Address': result.ip,
      'Name': isPanel ? (fullState?.hostname ?? metadata?.name ?? result.name ?? '') : '',
      'Status': getDisplayStatus(),
      'FW Version': isPanel ? (fullState?.version ?? '') : '',
      'Signal (%)': isPanel ? (fullState?.wifiQuality ?? '') : '',
      'Backlight': isPanel && fullState?.statusLedOn != null 
        ? (fullState.statusLedOn ? 'On' : 'Off') 
        : '',
      'Logging': isPanel && result.settings?.logging != null 
        ? (result.settings.logging ? 'On' : 'Off') 
        : '',
      'Long Press (ms)': isPanel ? (result.settings?.longPressMs ?? '') : '',
      'Live State': getLiveStateSummary(),
      'Touched': isPanel ? (metadata?.touched ? 'Yes' : 'No') : '',
      'Notes': getNotesText(result),
      'Link': isPanel ? `http://${result.ip}/` : '',
    };
  });

  // Don't export if no results
  if (rows.length === 0) {
    console.warn('No results to export');
    return;
  }

  // Create workbook and worksheet
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Discovery Results');

  // Auto-size columns based on content
  const firstRow = rows[0];
  const columnWidths = Object.keys(firstRow).map((key) => {
    const maxLength = Math.max(
      key.length,
      ...rows.map(row => String(row[key as keyof typeof row] ?? '').length)
    );
    return { wch: Math.min(maxLength + 2, 50) };
  });
  worksheet['!cols'] = columnWidths;

  // Generate filename with sortable datetime
  const filename = `discovery_results_${getSortableDateTime()}.xlsx`;

  // Trigger download
  XLSX.writeFile(workbook, filename);
}

