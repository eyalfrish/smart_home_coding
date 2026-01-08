'use client';

import { useCallback, useState, useRef, useEffect, type KeyboardEvent, type MouseEvent, type TouchEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResponse, PanelInfo, LivePanelState, PanelCommand, PanelSettings, RelayPairConfig, DeviceType } from "@/lib/discovery/types";
import { getRelayDeviceType, getCurtainDeviceType } from "@/lib/discovery/types";

// Long press duration for touch highlighting (ms)
const LONG_PRESS_DURATION = 500;

// Type for tracking which device is being edited
interface EditingDevice {
  ip: string;
  type: "relay" | "curtain";
  index: number;
  currentName: string;
}

interface DiscoveryResultsProps {
  data: DiscoveryResponse | null;
  onPanelsSummaryClick?: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  panelInfoMap: Record<string, PanelInfo>;
  livePanelStates?: Map<string, LivePanelState>;
  showOnlyCubixx: boolean;
  showOnlyTouched: boolean;
  showOnlyLightActive: boolean;
  onShowOnlyCubixxChange: (value: boolean) => void;
  onShowOnlyTouchedChange: (value: boolean) => void;
  onShowOnlyLightActiveChange: (value: boolean) => void;
  onSendCommand?: (ip: string, command: PanelCommand) => Promise<boolean>;
  // Selection props for batch operations
  selectedPanelIps?: Set<string>;
  onPanelSelectionChange?: (ip: string, selected: boolean) => void;
  onSelectAll?: (ips: string[]) => void;
  onDeselectAll?: () => void;
  cubixxPanelIps?: string[];
}

// Status indicators - now includes detailed status from discovery
const statusConfig: Record<string, { icon: string; label: string; className: string }> = {
  panel: { icon: "●", label: "Cubixx", className: "statusPanel" },
  "not-panel": { icon: "○", label: "NotCubixx", className: "statusOther" },
  "no-response": { icon: "○", label: "No Response", className: "statusNone" },
  error: { icon: "⚠", label: "Error", className: "statusError" },
  pending: { icon: "◌", label: "Scanning...", className: "statusPending" },
  initial: { icon: "◌", label: "Waiting...", className: "statusInitial" },
};

// Compare two semver-like version strings, returns positive if a > b, negative if a < b, 0 if equal
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);
  
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

// Check if a device name indicates it's a "Link" device (ends with -Link, _Link, Link, etc.)
function isLinkDevice(name?: string): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  // Match patterns like "-link", "_link", " link" at the end of the name
  return /[-_\s]?link$/i.test(normalized);
}

// Sortable column types
type SortColumn = "ip" | "name" | "status" | "version" | "signal" | "backlight" | "logging" | "longpress" | "touched" | null;
type SortDirection = "asc" | "desc";

// Helper to get the base device name (strip -Link, _Link, etc. suffix)
function getBaseDeviceName(name?: string): string {
  if (!name) return "";
  return name.replace(/[-_\s]?link$/i, "").trim().toLowerCase();
}

export default function DiscoveryResults({
  data,
  onPanelsSummaryClick,
  searchQuery,
  onSearchChange,
  panelInfoMap,
  livePanelStates,
  showOnlyCubixx,
  showOnlyTouched,
  showOnlyLightActive,
  onShowOnlyCubixxChange,
  onShowOnlyTouchedChange,
  onShowOnlyLightActiveChange,
  onSendCommand,
  selectedPanelIps,
  onPanelSelectionChange,
  onSelectAll,
  onDeselectAll,
  cubixxPanelIps = [],
}: DiscoveryResultsProps) {
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [switchSearchQuery, setSwitchSearchQuery] = useState("");
  
  // Track expanded panels on mobile (for showing extra info)
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());
  
  // Track hovered/highlighted device for cross-panel highlighting
  // Stores: { baseName: string, sourceIp: string, sourceType: "relay"|"curtain", sourceIndex: number }
  const [hoveredDevice, setHoveredDevice] = useState<{
    baseName: string;
    sourceIp: string;
    sourceType: "relay" | "curtain";
    sourceIndex: number;
  } | null>(null);
  
  // Long press state for touch highlighting
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggeredRef = useRef(false);
  const isTouchInteractionRef = useRef(false);
  
  // Inline editing state for switch names
  const [editingDevice, setEditingDevice] = useState<EditingDevice | null>(null);
  
  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    direct: 320,
    link: 320,
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  const [editValue, setEditValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // Swipe-to-toggle checkbox state (for selecting multiple panels by dragging)
  const [isSwipeSelecting, setIsSwipeSelecting] = useState(false);
  const swipeProcessedIps = useRef<Set<string>>(new Set());

  // Selection helpers
  const handleCheckboxChange = useCallback((ip: string, checked: boolean) => {
    // If this checkbox was already toggled during a swipe gesture, skip the onChange
    if (swipeProcessedIps.current.has(ip)) return;
    onPanelSelectionChange?.(ip, checked);
  }, [onPanelSelectionChange]);

  // Swipe-to-toggle handlers for checkboxes
  const handleSwipeStart = useCallback((ip: string, currentlySelected: boolean, e: React.MouseEvent | React.TouchEvent) => {
    // Prevent text selection during drag
    e.preventDefault();
    
    swipeProcessedIps.current = new Set([ip]);
    setIsSwipeSelecting(true);
    
    // Toggle the first checkbox
    onPanelSelectionChange?.(ip, !currentlySelected);
  }, [onPanelSelectionChange]);

  const handleSwipeEnter = useCallback((ip: string, currentlySelected: boolean) => {
    if (!isSwipeSelecting) return;
    
    // Skip if we already processed this IP in this swipe gesture
    if (swipeProcessedIps.current.has(ip)) return;
    
    // Mark as processed and toggle
    swipeProcessedIps.current.add(ip);
    onPanelSelectionChange?.(ip, !currentlySelected);
  }, [isSwipeSelecting, onPanelSelectionChange]);

  const handleSwipeEnd = useCallback(() => {
    setIsSwipeSelecting(false);
    // Delay clearing processed IPs to allow onChange to check if it should skip
    // (click/onChange fires after mouseup, so we need a small delay)
    setTimeout(() => {
      swipeProcessedIps.current.clear();
    }, 50);
  }, []);

  // Touch move handler for swipe selection (detects which checkbox is under finger)
  const handleSwipeTouchMove = useCallback((e: React.TouchEvent, selectedPanelIpsSet?: Set<string>) => {
    if (!isSwipeSelecting) return;
    
    const touch = e.touches[0];
    if (!touch) return;
    
    // Find the element under the touch point
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elementUnderTouch) return;
    
    // Check if it's a checkbox or inside a checkbox cell
    const checkboxCell = elementUnderTouch.closest('[data-swipe-ip]');
    if (!checkboxCell) return;
    
    const ip = (checkboxCell as HTMLElement).dataset.swipeIp;
    if (!ip) return;
    
    // Skip if we already processed this IP
    if (swipeProcessedIps.current.has(ip)) return;
    
    // Mark as processed and toggle based on current state
    swipeProcessedIps.current.add(ip);
    const currentlySelected = selectedPanelIpsSet?.has(ip) ?? false;
    onPanelSelectionChange?.(ip, !currentlySelected);
  }, [isSwipeSelecting, onPanelSelectionChange]);

  // Global mouse up handler for ending swipe selection
  useEffect(() => {
    if (!isSwipeSelecting) return;
    
    const handleGlobalMouseUp = () => {
      handleSwipeEnd();
    };
    
    const handleGlobalTouchEnd = () => {
      handleSwipeEnd();
    };
    
    document.addEventListener("mouseup", handleGlobalMouseUp);
    document.addEventListener("touchend", handleGlobalTouchEnd);
    
    return () => {
      document.removeEventListener("mouseup", handleGlobalMouseUp);
      document.removeEventListener("touchend", handleGlobalTouchEnd);
    };
  }, [isSwipeSelecting, handleSwipeEnd]);

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      // New column, start with ascending
      setSortColumn(column);
      setSortDirection("asc");
    }
  }, [sortColumn]);

  const handleLightToggle = useCallback(async (
    e: MouseEvent,
    ip: string,
    relayIndex: number
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Skip if this was a long press (for highlighting)
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    
    if (!onSendCommand) return;
    
    const key = `${ip}-L${relayIndex}`;
    setPendingCommands(prev => new Set(prev).add(key));
    
    try {
      await onSendCommand(ip, { command: "toggle_relay", index: relayIndex });
    } finally {
      setPendingCommands(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [onSendCommand]);

  const handleShadeAction = useCallback(async (
    e: MouseEvent,
    ip: string,
    curtainIndex: number,
    requestedAction: "open" | "close",
    currentState?: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!onSendCommand) return;
    
    // If shade is currently moving, send "stop" instead
    const isMoving = currentState === "opening" || currentState === "closing";
    const action = isMoving ? "stop" : requestedAction;
    
    const key = `${ip}-S${curtainIndex}-${requestedAction}`;
    setPendingCommands(prev => new Set(prev).add(key));
    
    try {
      await onSendCommand(ip, { command: "curtain", index: curtainIndex, action });
    } finally {
      setPendingCommands(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [onSendCommand]);

  // Inline rename handlers
  const handleRightClickRename = useCallback((
    e: MouseEvent,
    ip: string,
    type: "relay" | "curtain",
    index: number,
    currentName: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingDevice({ ip, type, index, currentName });
    setEditValue(currentName);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingDevice(null);
    setEditValue("");
  }, []);

  const handleSaveRename = useCallback(async () => {
    if (!editingDevice || savingRename) return;
    
    const trimmedValue = editValue.trim();
    if (!trimmedValue || trimmedValue === editingDevice.currentName) {
      handleCancelEdit();
      return;
    }
    
    setSavingRename(true);
    try {
      // POST through our API route to avoid CORS issues
      const response = await fetch("/api/panels/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: editingDevice.ip,
          type: editingDevice.type,
          index: editingDevice.index,
          name: trimmedValue,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`Failed to rename device: ${response.status}`, errorData);
      } else {
        console.log(`Renamed ${editingDevice.type} ${editingDevice.index} to "${trimmedValue}"`);
      }
      // The panel will broadcast the update via WebSocket, which will update livePanelStates
    } catch (error) {
      console.error("Error renaming device:", error);
    } finally {
      setSavingRename(false);
      handleCancelEdit();
    }
  }, [editingDevice, editValue, savingRename, handleCancelEdit]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  }, [handleSaveRename, handleCancelEdit]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingDevice && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingDevice]);

  // Device hover handlers for cross-panel highlighting (desktop)
  const handleDeviceMouseEnter = useCallback((
    ip: string,
    type: "relay" | "curtain",
    index: number,
    deviceName?: string
  ) => {
    // Skip if this is from a touch interaction (mobile taps trigger mouseenter)
    if (isTouchInteractionRef.current) return;
    
    const baseName = getBaseDeviceName(deviceName);
    if (baseName) {
      setHoveredDevice({ baseName, sourceIp: ip, sourceType: type, sourceIndex: index });
    }
  }, []);

  const handleDeviceMouseLeave = useCallback(() => {
    // Skip if this is from a touch interaction
    if (isTouchInteractionRef.current) return;
    
    setHoveredDevice(null);
  }, []);

  // Long press handlers for touch highlighting (mobile)
  const handleDeviceTouchStart = useCallback((
    ip: string,
    type: "relay" | "curtain",
    index: number,
    deviceName?: string
  ) => {
    // Mark that we're in a touch interaction (to ignore mouseenter/leave)
    isTouchInteractionRef.current = true;
    
    const baseName = getBaseDeviceName(deviceName);
    if (!baseName) return;
    
    longPressTriggeredRef.current = false;
    
    // Start long press timer
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      // Toggle highlight - if same device, clear it; otherwise set it
      setHoveredDevice(prev => {
        if (prev?.baseName === baseName && prev?.sourceIp === ip) {
          return null; // Clear highlight
        }
        return { baseName, sourceIp: ip, sourceType: type, sourceIndex: index };
      });
    }, LONG_PRESS_DURATION);
  }, []);

  const handleDeviceTouchEnd = useCallback(() => {
    // Cancel long press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // Reset touch interaction flag after a delay (to ignore subsequent mouse events)
    setTimeout(() => {
      isTouchInteractionRef.current = false;
    }, 300);
  }, []);

  const handleDeviceTouchMove = useCallback(() => {
    // Cancel long press if user moves finger
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Toggle expanded state for a panel card on mobile
  const togglePanelExpanded = useCallback((ip: string, e: MouseEvent) => {
    e.stopPropagation();
    setExpandedPanels(prev => {
      const next = new Set(prev);
      if (next.has(ip)) {
        next.delete(ip);
      } else {
        next.add(ip);
      }
      return next;
    });
  }, []);

  // Helper to check if a device should be highlighted
  const getDeviceHighlightClass = useCallback((
    ip: string,
    type: "relay" | "curtain",
    index: number,
    deviceName?: string
  ): string => {
    if (!hoveredDevice) return "";
    const baseName = getBaseDeviceName(deviceName);
    if (!baseName || baseName !== hoveredDevice.baseName) return "";
    
    // Direct devices (no -Link suffix) get green highlight
    // Link devices get purple/blue highlight
    const isLink = isLinkDevice(deviceName);
    
    return isLink ? styles.deviceHighlighted : styles.deviceHighlightedSource;
  }, [hoveredDevice]);

  // Column resize handlers
  const handleResizeStart = useCallback((e: MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColumn(columnId);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = columnWidths[columnId] || 180;
  }, [columnWidths]);

  const handleResizeMove = useCallback((e: globalThis.MouseEvent) => {
    if (!resizingColumn) return;
    const delta = e.clientX - resizeStartX.current;
    const newWidth = Math.max(100, Math.min(600, resizeStartWidth.current + delta));
    setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
  }, [resizingColumn]);

  const handleResizeEnd = useCallback(() => {
    setResizingColumn(null);
  }, []);

  // Attach global mouse events for resize
  useEffect(() => {
    if (resizingColumn) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }
  }, [resizingColumn, handleResizeMove, handleResizeEnd]);

  const handleBacklightToggle = useCallback(async (
    e: MouseEvent,
    ip: string,
    currentState: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!onSendCommand) return;
    
    const key = `${ip}-BL`;
    setPendingCommands(prev => new Set(prev).add(key));
    
    try {
      await onSendCommand(ip, { command: "backlight", state: !currentState });
    } finally {
      setPendingCommands(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [onSendCommand]);

  if (!data) {
    return null;
  }

  const { summary, results } = data;
  const canOpenPanelsView =
    typeof onPanelsSummaryClick === "function" && summary.panelsFound > 0;

  // Calculate the highest firmware version from panels in current discovery results only
  const highestVersion = (() => {
    if (!livePanelStates || !results) return null;
    let highest: string | null = null;
    // Only consider panels that are in the current discovery results
    const currentResultIps = new Set(results.map(r => r.ip));
    livePanelStates.forEach((state, ip) => {
      if (!currentResultIps.has(ip)) return; // Skip panels not in current discovery
      const version = state.fullState?.version;
      if (version) {
        if (!highest || compareVersions(version, highest) > 0) {
          highest = version;
        }
      }
    });
    return highest;
  })();

  // Calculate most common logging value and long press time for color coding
  const { mostCommonLogging, mostCommonLongPress } = (() => {
    const loggingCounts: Record<string, number> = { 'true': 0, 'false': 0 };
    const longPressCounts: Record<number, number> = {};
    
    results.forEach(result => {
      if (result.status !== "panel" || !result.settings) return;
      
      if (result.settings.logging !== undefined) {
        loggingCounts[String(result.settings.logging)]++;
      }
      
      if (result.settings.longPressMs !== undefined) {
        longPressCounts[result.settings.longPressMs] = (longPressCounts[result.settings.longPressMs] || 0) + 1;
      }
    });
    
    // Determine most common logging
    let mostCommonLogging: boolean | null = null;
    if (loggingCounts['true'] > 0 || loggingCounts['false'] > 0) {
      mostCommonLogging = loggingCounts['true'] >= loggingCounts['false'];
    }
    
    // Determine most common long press
    let mostCommonLongPress: number | null = null;
    let maxCount = 0;
    for (const [time, count] of Object.entries(longPressCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonLongPress = parseInt(time, 10);
      }
    }
    
    return { mostCommonLogging, mostCommonLongPress };
  })();

  // Helper to check if a panel has at least one configured light relay that is ON
  // Uses settings-based classification for robust device type detection
  const hasLightOn = (ip: string): boolean => {
    const liveState = livePanelStates?.get(ip);
    if (!liveState?.fullState?.relays) return false;
    
    // Get panel result to access settings
    const panelResult = data?.results.find(r => r.ip === ip);
    const relayPairs = panelResult?.settings?.relayPairs;
    
    // Find light relays using settings-based classification
    const lightRelays = liveState.fullState.relays.filter(relay => 
      getRelayDeviceType(relay.index, relay.name, relayPairs) === "light"
    );
    
    // Return true if any light relay is ON
    return lightRelays.some(r => r.state === true);
  };

  // Helper to check if a panel has any devices matching the switch search query
  const hasSwitchMatch = (ip: string, query: string): boolean => {
    if (!query) return true;
    const liveState = livePanelStates?.get(ip);
    if (!liveState?.fullState) return false;
    
    const normalizedQuery = query.toLowerCase();
    
    // Check relay names
    const relayMatch = liveState.fullState.relays?.some(relay => 
      relay.name?.toLowerCase().includes(normalizedQuery)
    );
    if (relayMatch) return true;
    
    // Check curtain names
    const curtainMatch = liveState.fullState.curtains?.some(curtain =>
      curtain.name?.toLowerCase().includes(normalizedQuery)
    );
    if (curtainMatch) return true;
    
    return false;
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const normalizedSwitchQuery = switchSearchQuery.trim().toLowerCase();
  const filteredResults = results.filter((result) => {
    const metadata = panelInfoMap[result.ip];
    const isCubixx = metadata?.isCubixx ?? (result.status === "panel");

    if (showOnlyCubixx && !isCubixx) {
      return false;
    }

    if (showOnlyTouched && !metadata?.touched) {
      return false;
    }

    if (showOnlyLightActive && !hasLightOn(result.ip)) {
      return false;
    }

    // Switch search filter
    if (normalizedSwitchQuery && !hasSwitchMatch(result.ip, normalizedSwitchQuery)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const name =
      metadata?.name?.toLowerCase() ?? result.name?.toLowerCase() ?? "";
    return (
      result.ip.toLowerCase().includes(normalizedQuery) ||
      name.includes(normalizedQuery)
    );
  });

  // Get only the Cubixx panel IPs from the filtered results (for select-all functionality)
  const filteredCubixxIps = filteredResults
    .filter(result => result.status === "panel")
    .map(result => result.ip);

  // Calculate if all filtered Cubixx panels are selected (for the header checkbox)
  const allFilteredSelected = filteredCubixxIps.length > 0 && 
    filteredCubixxIps.every(ip => selectedPanelIps?.has(ip));
  const someFilteredSelected = filteredCubixxIps.some(ip => selectedPanelIps?.has(ip));
  const isIndeterminate = someFilteredSelected && !allFilteredSelected;

  const handleSelectAllChange = (checked: boolean) => {
    if (checked) {
      // Add all filtered panels to current selection (merge with existing)
      const newSelection = new Set(selectedPanelIps);
      filteredCubixxIps.forEach(ip => newSelection.add(ip));
      onSelectAll?.([...newSelection]);
    } else {
      // Remove only the filtered panels from selection (keep others)
      const newSelection = new Set(selectedPanelIps);
      filteredCubixxIps.forEach(ip => newSelection.delete(ip));
      if (newSelection.size === 0) {
        onDeselectAll?.();
      } else {
        onSelectAll?.([...newSelection]);
      }
    }
  };

  // Sort filtered results
  const sortedResults = [...filteredResults].sort((a, b) => {
    if (!sortColumn) return 0;
    
    const liveStateA = livePanelStates?.get(a.ip);
    const liveStateB = livePanelStates?.get(b.ip);
    const metadataA = panelInfoMap[a.ip];
    const metadataB = panelInfoMap[b.ip];
    
    let comparison = 0;
    
    switch (sortColumn) {
      case "ip": {
        // Sort IP addresses numerically by last octet
        const lastOctetA = parseInt(a.ip.split('.').pop() ?? "0", 10);
        const lastOctetB = parseInt(b.ip.split('.').pop() ?? "0", 10);
        comparison = lastOctetA - lastOctetB;
        break;
      }
      case "name": {
        const nameA = liveStateA?.fullState?.hostname ?? metadataA?.name ?? a.name ?? "";
        const nameB = liveStateB?.fullState?.hostname ?? metadataB?.name ?? b.name ?? "";
        comparison = nameA.localeCompare(nameB);
        break;
      }
      case "status": {
        const statusOrder = { panel: 0, "not-panel": 1, error: 2, "no-response": 3, pending: 4, initial: 5 };
        const statusA = liveStateA?.connectionStatus === "connected" ? -1 : (statusOrder[a.status as keyof typeof statusOrder] ?? 5);
        const statusB = liveStateB?.connectionStatus === "connected" ? -1 : (statusOrder[b.status as keyof typeof statusOrder] ?? 5);
        comparison = statusA - statusB;
        break;
      }
      case "version": {
        const versionA = liveStateA?.fullState?.version ?? "";
        const versionB = liveStateB?.fullState?.version ?? "";
        if (!versionA && !versionB) comparison = 0;
        else if (!versionA) comparison = 1;
        else if (!versionB) comparison = -1;
        else comparison = compareVersions(versionA, versionB);
        break;
      }
      case "signal": {
        const signalA = liveStateA?.fullState?.wifiQuality ?? -1;
        const signalB = liveStateB?.fullState?.wifiQuality ?? -1;
        comparison = signalA - signalB;
        break;
      }
      case "backlight": {
        // Sort by statusLedOn: true > false > unknown
        const backlightA = liveStateA?.fullState?.statusLedOn;
        const backlightB = liveStateB?.fullState?.statusLedOn;
        if (backlightA === backlightB) comparison = 0;
        else if (backlightA === undefined) comparison = 1;
        else if (backlightB === undefined) comparison = -1;
        else comparison = (backlightA ? 1 : 0) - (backlightB ? 1 : 0);
        break;
      }
      case "logging": {
        // Sort by logging: true > false > unknown
        const loggingA = a.settings?.logging;
        const loggingB = b.settings?.logging;
        if (loggingA === loggingB) comparison = 0;
        else if (loggingA === undefined) comparison = 1;
        else if (loggingB === undefined) comparison = -1;
        else comparison = (loggingA ? 1 : 0) - (loggingB ? 1 : 0);
        break;
      }
      case "longpress": {
        // Sort by longPressMs: numeric, unknown at end
        const longPressA = a.settings?.longPressMs;
        const longPressB = b.settings?.longPressMs;
        if (longPressA === longPressB) comparison = 0;
        else if (longPressA === undefined) comparison = 1;
        else if (longPressB === undefined) comparison = -1;
        else comparison = longPressA - longPressB;
        break;
      }
      case "touched": {
        const touchedA = metadataA?.touched === true ? 1 : 0;
        const touchedB = metadataB?.touched === true ? 1 : 0;
        comparison = touchedA - touchedB;
        break;
      }
    }
    
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const handlePanelsSummaryKeyDown = (
    event: KeyboardEvent<HTMLDivElement>
  ) => {
    if (!canOpenPanelsView || !onPanelsSummaryClick) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPanelsSummaryClick();
    }
  };

  return (
    <>
      <div className={styles.summaryGrid}>
        <div className={styles.summaryItem}>
          <h4>
            <span className={styles.desktopText}>Total IPs checked</span>
            <span className={styles.mobileText}>Total</span>
          </h4>
          <p className={styles.summaryAccent}>{summary.totalChecked}</p>
        </div>
        <div
          className={`${styles.summaryItem} ${
            canOpenPanelsView ? styles.summaryItemInteractive : ""
          }`}
          onClick={canOpenPanelsView ? onPanelsSummaryClick : undefined}
          onKeyDown={handlePanelsSummaryKeyDown}
          role={canOpenPanelsView ? "button" : undefined}
          tabIndex={canOpenPanelsView ? 0 : undefined}
          aria-disabled={!canOpenPanelsView}
        >
          <h4>
            <span className={styles.desktopText}>Panels found</span>
            <span className={styles.mobileText}>Online</span>
          </h4>
          <p className={styles.summaryPanel}>{summary.panelsFound}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>
            <span className={styles.desktopText}>Non Cubixx (HTTP 200)</span>
            <span className={styles.mobileText}>Other</span>
          </h4>
          <p className={styles.summaryNeutral}>{summary.notPanels}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>
            <span className={styles.desktopText}>No response</span>
            <span className={styles.mobileText}>Offline</span>
          </h4>
          <p className={styles.summaryWarn}>{summary.noResponse}</p>
        </div>
        <div className={styles.summaryItem}>
          <h4>
            <span className={styles.desktopText}>Errors</span>
            <span className={styles.mobileText}>Errors</span>
          </h4>
          <p className={styles.summaryWarn}>{summary.errors}</p>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <div className={styles.searchRow}>
          <div className={styles.searchGroup}>
            <label className={styles.searchLabel} htmlFor="results-search">
              <span className={styles.desktopText}>Search Panels</span>
              <span className={styles.mobileText}>Panels</span>
            </label>
            <input
              id="results-search"
              type="text"
              className={styles.searchInput}
              placeholder="IP or name..."
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <div className={styles.searchGroup}>
            <label className={styles.searchLabel} htmlFor="switch-search">
              <span className={styles.desktopText}>Search Switches</span>
              <span className={styles.mobileText}>Switches</span>
            </label>
            <input
              id="switch-search"
              type="text"
              className={styles.searchInput}
              placeholder="Switch name..."
              value={switchSearchQuery}
              onChange={(event) => setSwitchSearchQuery(event.target.value)}
            />
          </div>
        </div>
        <div className={styles.filtersRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showOnlyCubixx}
              onChange={(event) =>
                onShowOnlyCubixxChange(event.target.checked)
              }
            />
            <span className={styles.desktopText}>Show only Live Cubixx panels</span>
            <span className={styles.mobileText}>Live</span>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showOnlyTouched}
              onChange={(event) =>
                onShowOnlyTouchedChange(event.target.checked)
              }
            />
            <span className={styles.desktopText}>Show only touched panels</span>
            <span className={styles.mobileText}>Touched</span>
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showOnlyLightActive}
              onChange={(event) =>
                onShowOnlyLightActiveChange(event.target.checked)
              }
            />
            <span className={styles.desktopText}>Show only light-active panels</span>
            <span className={styles.mobileText}>Lights On</span>
          </label>
          <div className={styles.selectAllWrapper}>
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) el.indeterminate = isIndeterminate;
              }}
              onChange={(e) => handleSelectAllChange(e.target.checked)}
              className={styles.selectAllCheckboxInline}
              title={allFilteredSelected ? "Deselect all" : "Select all"}
              aria-label={allFilteredSelected ? "Deselect all panels" : "Select all panels"}
            />
          </div>
        </div>
        <table className={`${styles.table} ${isSwipeSelecting ? styles.swipeSelecting : ""}`}>
          <thead>
            <tr>
              <th className={styles.checkboxHeader}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isIndeterminate;
                  }}
                  onChange={(e) => handleSelectAllChange(e.target.checked)}
                  title={allFilteredSelected ? "Deselect all filtered panels" : "Select all filtered panels"}
                  className={styles.selectAllCheckbox}
                />
              </th>
              <th className={styles.expandHeader}></th>
              <th 
                className={styles.sortableHeader} 
                onClick={() => handleSort("ip")}
              >
                IP
                <span className={`${styles.sortIndicator} ${sortColumn === "ip" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "ip" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={styles.sortableHeader} 
                onClick={() => handleSort("name")}
              >
                Name
                <span className={`${styles.sortIndicator} ${sortColumn === "name" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "name" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={styles.sortableHeader} 
                onClick={() => handleSort("status")}
              >
                Status
                <span className={`${styles.sortIndicator} ${sortColumn === "status" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "status" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("version")}
              >
                FW
                <span className={`${styles.sortIndicator} ${sortColumn === "version" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "version" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("signal")}
              >
                Signal
                <span className={`${styles.sortIndicator} ${sortColumn === "signal" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "signal" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("backlight")}
              >
                BL
                <span className={`${styles.sortIndicator} ${sortColumn === "backlight" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "backlight" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("logging")}
              >
                Log
                <span className={`${styles.sortIndicator} ${sortColumn === "logging" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "logging" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("longpress")}
              >
                LP
                <span className={`${styles.sortIndicator} ${sortColumn === "longpress" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "longpress" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
              <th className={`${styles.directLinkHeader} ${styles.resizableHeader}`} style={{ width: columnWidths.direct }}>
                Direct
                <div
                  className={`${styles.resizeHandle} ${resizingColumn === "direct" ? styles.resizing : ""}`}
                  onMouseDown={(e) => handleResizeStart(e, "direct")}
                />
              </th>
              <th className={`${styles.directLinkHeader} ${styles.resizableHeader}`} style={{ width: columnWidths.link }}>
                Link
                <div
                  className={`${styles.resizeHandle} ${resizingColumn === "link" ? styles.resizing : ""}`}
                  onMouseDown={(e) => handleResizeStart(e, "link")}
                />
              </th>
              <th 
                className={`${styles.sortableHeader} ${styles.centeredColumn}`} 
                onClick={() => handleSort("touched")}
              >
                Touch
                <span className={`${styles.sortIndicator} ${sortColumn === "touched" ? styles.sortIndicatorActive : ""}`}>
                  {sortColumn === "touched" ? (sortDirection === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.length === 0 ? (
              <tr>
                <td colSpan={14}>No entries match that search.</td>
              </tr>
            ) : (
              sortedResults.map((result) => {
                const metadata = panelInfoMap[result.ip];
                const liveState = livePanelStates?.get(result.ip);
                const touched = metadata?.touched === true;
                const touchedClass = touched
                  ? styles.touchedYes
                  : styles.touchedNo;
                const isPanel = result.status === "panel";
                const isSelected = selectedPanelIps?.has(result.ip) ?? false;
                const isExpanded = expandedPanels.has(result.ip);

                // Handle row click for expand/collapse (mobile)
                const handleRowClick = (e: React.MouseEvent) => {
                  // Don't expand if clicking on interactive elements
                  const target = e.target as HTMLElement;
                  if (
                    target.tagName === 'BUTTON' ||
                    target.tagName === 'INPUT' ||
                    target.tagName === 'A' ||
                    target.closest('button') ||
                    target.closest('input') ||
                    target.closest('a')
                  ) {
                    return;
                  }
                  if (isPanel) {
                    togglePanelExpanded(result.ip, e);
                  }
                };

                return (
                  <tr 
                    key={result.ip} 
                    className={`${isSelected ? styles.selectedRow : ""} ${isExpanded ? styles.expandedRow : ""} ${isPanel ? styles.clickableRow : ""}`}
                    onClick={handleRowClick}
                  >
                    <td 
                      className={styles.checkboxCell} 
                      data-label=""
                      data-swipe-ip={isPanel ? result.ip : undefined}
                      onMouseEnter={() => isPanel && handleSwipeEnter(result.ip, isSelected)}
                      onTouchMove={isPanel ? (e) => handleSwipeTouchMove(e, selectedPanelIps) : undefined}
                    >
                      {isPanel ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleCheckboxChange(result.ip, e.target.checked)}
                          onMouseDown={(e) => handleSwipeStart(result.ip, isSelected, e)}
                          onTouchStart={(e) => handleSwipeStart(result.ip, isSelected, e)}
                          className={styles.rowCheckbox}
                          aria-label={`Select ${result.name ?? result.ip}`}
                        />
                      ) : (
                        <span className={styles.noCheckbox}></span>
                      )}
                    </td>
                    {/* Hidden expand column - kept for layout consistency */}
                    <td className={styles.expandCell} data-label=""></td>
                    <td data-label="IP">
                      {result.status === "panel" ? (
                        <a
                          href={`http://${result.ip}/`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.panelLink}
                        >
                          {result.ip}
                        </a>
                      ) : (
                        result.ip
                      )}
                    </td>
                    <td data-label="Name">
                      {liveState?.fullState?.hostname ?? metadata?.name ?? result.name ?? "—"}
                    </td>
                    <td data-label="Status">
                      {liveState?.connectionStatus === "connected" ? (
                        <span className={styles.statusLive}>● LIVE</span>
                      ) : (
                        <span className={styles[statusConfig[result.status]?.className ?? "statusNone"]}>
                          {statusConfig[result.status]?.icon ?? "○"} {statusConfig[result.status]?.label ?? "—"}
                        </span>
                      )}
                    </td>
                    {/* Expandable extra info section - hidden on mobile unless expanded */}
                    <td className={`${styles.centeredColumn} ${styles.extraInfoCell}`} data-label="FW">
                      {liveState?.fullState?.version ? (
                        <span className={
                          highestVersion && compareVersions(liveState.fullState.version, highestVersion) === 0
                            ? styles.versionLatest
                            : styles.versionOutdated
                        }>
                          {liveState.fullState.version}
                        </span>
                      ) : result.status === "panel" ? (
                        <span className={styles.versionUnknown}>...</span>
                      ) : (
                        <span className={styles.versionUnknown}>—</span>
                      )}
                    </td>
                    <td className={`${styles.centeredColumn} ${styles.extraInfoCell}`} data-label="Signal">
                      {liveState?.fullState?.wifiQuality != null ? (
                        <span className={
                          liveState.fullState.wifiQuality >= 70
                            ? styles.signalGood
                            : liveState.fullState.wifiQuality >= 40
                            ? styles.signalMedium
                            : styles.signalWeak
                        }>
                          {liveState.fullState.wifiQuality}%
                        </span>
                      ) : result.status === "panel" ? (
                        <span className={styles.signalUnknown}>...</span>
                      ) : (
                        <span className={styles.signalUnknown}>—</span>
                      )}
                    </td>
                    <td className={`${styles.centeredColumn} ${styles.extraInfoCell}`} data-label="BL">
                      {liveState?.fullState?.statusLedOn != null ? (
                        (() => {
                          const isOn = liveState.fullState.statusLedOn;
                          const isPending = pendingCommands.has(`${result.ip}-BL`);
                          return (
                            <button
                              className={`${styles.backlightButton} ${isOn ? styles.backlightOn : styles.backlightOff} ${isPending ? styles.pending : ""}`}
                              title={`Backlight ${isOn ? "On" : "Off"} - Click to toggle`}
                              onClick={(e) => handleBacklightToggle(e, result.ip, isOn)}
                              disabled={isPending || !onSendCommand}
                            >
                              {isOn ? "On" : "Off"}
                            </button>
                          );
                        })()
                      ) : result.status === "panel" ? (
                        <span className={styles.backlightUnknown}>...</span>
                      ) : (
                        <span className={styles.backlightUnknown}>—</span>
                      )}
                    </td>
                    <td className={`${styles.centeredColumn} ${styles.extraInfoCell}`} data-label="Log">
                      {result.settings?.logging !== undefined ? (
                        <span className={
                          result.settings.logging === mostCommonLogging
                            ? styles.settingCommon
                            : styles.settingDifferent
                        }>
                          {result.settings.logging ? "On" : "Off"}
                        </span>
                      ) : result.status === "panel" ? (
                        <span className={styles.settingUnknown}>—</span>
                      ) : (
                        <span className={styles.settingUnknown}>—</span>
                      )}
                    </td>
                    <td className={`${styles.centeredColumn} ${styles.extraInfoCell}`} data-label="LP">
                      {result.settings?.longPressMs !== undefined ? (
                        <span className={
                          result.settings.longPressMs === mostCommonLongPress
                            ? styles.settingCommon
                            : styles.settingDifferent
                        }>
                          {result.settings.longPressMs}
                        </span>
                      ) : result.status === "panel" ? (
                        <span className={styles.settingUnknown}>—</span>
                      ) : (
                        <span className={styles.settingUnknown}>—</span>
                      )}
                    </td>
                    {/* Direct Live State Column */}
                    <td className={styles.directLinkCell} style={{ width: columnWidths.direct }} data-label="Direct">
                      {liveState?.fullState ? (
                        (() => {
                          // Get relay pair configuration from settings (for robust classification)
                          const relayPairs = result.settings?.relayPairs;
                          
                          // Classify relays by device type using settings-based classification
                          const classifiedRelays = liveState.fullState.relays
                            .filter(r => !isLinkDevice(r.name)) // Direct only
                            .map(relay => ({
                              ...relay,
                              deviceType: getRelayDeviceType(relay.index, relay.name, relayPairs),
                            }))
                            .filter(r => r.deviceType !== "hidden");
                          
                          const lightRelays = classifiedRelays.filter(r => r.deviceType === "light");
                          const momentaryRelays = classifiedRelays.filter(r => r.deviceType === "momentary");
                          
                          // Classify curtains by device type
                          const classifiedCurtains = liveState.fullState.curtains
                            .filter(c => !isLinkDevice(c.name)) // Direct only
                            .map(curtain => ({
                              ...curtain,
                              deviceType: getCurtainDeviceType(curtain.index, curtain.name, relayPairs),
                            }))
                            .filter(c => c.deviceType !== "hidden");
                          
                          const curtainDevices = classifiedCurtains.filter(c => c.deviceType === "curtain");
                          const venetianDevices = classifiedCurtains.filter(c => c.deviceType === "venetian");
                          
                          // Helper to get display name (strip -Link suffix if present)
                          const getDisplayName = (name?: string) => {
                            if (!name) return "?";
                            return name.replace(/[-_\s]?link$/i, "").trim() || "?";
                          };
                          
                          // Helper to get compact name (L1, S1, D1, etc.)
                          const getCompactName = (type: "light" | "door" | "shade" | "venetian", index: number, direction?: "up" | "down") => {
                            const prefix = type === "light" ? "L" : type === "door" ? "D" : "S";
                            const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "";
                            return `${prefix}${index}${arrow}`;
                          };
                          
                          // Check if a device is currently being edited
                          const isEditing = (type: "relay" | "curtain", index: number) =>
                            editingDevice?.ip === result.ip &&
                            editingDevice?.type === type &&
                            editingDevice?.index === index;
                          
                          return (
                            <div className={styles.entityStates}>
                              {/* Lights (Normal -> Switch mode) - Direct only */}
                              {lightRelays.map((relay) => {
                                const isPending = pendingCommands.has(`${result.ip}-L${relay.index}`);
                                const editing = isEditing("relay", relay.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "relay", relay.index, relay.name);
                                return (
                                  <span key={`L${relay.index}`} className={styles.deviceButtonWrapper}>
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <button
                                        className={`${styles.switchButton} ${styles.lightSwitch} ${relay.state ? styles.switchOn : styles.switchOff} ${isPending ? styles.pending : ""} ${highlightClass}`}
                                        onClick={(e) => handleLightToggle(e, result.ip, relay.index)}
                                        onContextMenu={(e) => handleRightClickRename(e, result.ip, "relay", relay.index, relay.name || "")}
                                        onMouseEnter={() => handleDeviceMouseEnter(result.ip, "relay", relay.index, relay.name)}
                                        onMouseLeave={handleDeviceMouseLeave}
                                        onTouchStart={() => handleDeviceTouchStart(result.ip, "relay", relay.index, relay.name)}
                                        onTouchEnd={handleDeviceTouchEnd}
                                        onTouchMove={handleDeviceTouchMove}
                                        disabled={isPending || !onSendCommand}
                                        title={`${relay.name || ""} (long-press to highlight)`}
                                      >
                                        <span className={styles.deviceCompactName}>{getCompactName("light", relay.index)}</span>
                                        <span className={styles.deviceFullName}>{getDisplayName(relay.name)}</span>
                                      </button>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Door locks / Momentary (Normal -> Momentary mode) - Direct only */}
                              {momentaryRelays.map((relay) => {
                                const isPending = pendingCommands.has(`${result.ip}-L${relay.index}`);
                                const editing = isEditing("relay", relay.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "relay", relay.index, relay.name);
                                return (
                                  <span key={`D${relay.index}`} className={styles.deviceButtonWrapper}>
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <button
                                        className={`${styles.switchButton} ${styles.doorSwitch} ${relay.state ? styles.switchOn : styles.switchOff} ${isPending ? styles.pending : ""} ${highlightClass}`}
                                        onClick={(e) => handleLightToggle(e, result.ip, relay.index)}
                                        onContextMenu={(e) => handleRightClickRename(e, result.ip, "relay", relay.index, relay.name || "")}
                                        onMouseEnter={() => handleDeviceMouseEnter(result.ip, "relay", relay.index, relay.name)}
                                        onMouseLeave={handleDeviceMouseLeave}
                                        onTouchStart={() => handleDeviceTouchStart(result.ip, "relay", relay.index, relay.name)}
                                        onTouchEnd={handleDeviceTouchEnd}
                                        onTouchMove={handleDeviceTouchMove}
                                        disabled={isPending || !onSendCommand}
                                        title={`${relay.name || ""} (long-press to highlight)`}
                                      >
                                        <span className={styles.deviceCompactName}>{getCompactName("door", relay.index)}</span>
                                        <span className={styles.deviceFullName}>{getDisplayName(relay.name)}</span>
                                      </button>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Curtains (Curtain pair mode) - Direct only */}
                              {curtainDevices.map((curtain) => {
                                const openPending = pendingCommands.has(`${result.ip}-S${curtain.index}-open`);
                                const closePending = pendingCommands.has(`${result.ip}-S${curtain.index}-close`);
                                const isOpen = curtain.state === "open";
                                const isClosed = curtain.state === "closed";
                                const isMoving = curtain.state === "opening" || curtain.state === "closing";
                                const editing = isEditing("curtain", curtain.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "curtain", curtain.index, curtain.name);
                                return (
                                  <span
                                    key={`S${curtain.index}`}
                                    className={`${styles.shadePairGroup} ${styles.deviceButtonWrapper} ${highlightClass}`}
                                    title={`${curtain.name || ""} (long-press to highlight)`}
                                    onMouseEnter={() => handleDeviceMouseEnter(result.ip, "curtain", curtain.index, curtain.name)}
                                    onMouseLeave={handleDeviceMouseLeave}
                                    onTouchStart={() => handleDeviceTouchStart(result.ip, "curtain", curtain.index, curtain.name)}
                                    onTouchEnd={handleDeviceTouchEnd}
                                    onTouchMove={handleDeviceTouchMove}
                                  >
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.shadeSwitch} ${styles.shadeUpButton} ${isOpen ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${openPending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "open", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={openPending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{isMoving ? "■" : getCompactName("shade", curtain.index, "up")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↑"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.shadeSwitch} ${styles.shadeDownButton} ${isClosed ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${closePending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "close", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={closePending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{isMoving ? "■" : getCompactName("shade", curtain.index, "down")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↓"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Venetian blinds (Venetian pair mode) - Direct only */}
                              {venetianDevices.map((curtain) => {
                                const openPending = pendingCommands.has(`${result.ip}-S${curtain.index}-open`);
                                const closePending = pendingCommands.has(`${result.ip}-S${curtain.index}-close`);
                                const isOpen = curtain.state === "open";
                                const isClosed = curtain.state === "closed";
                                const isMoving = curtain.state === "opening" || curtain.state === "closing";
                                const editing = isEditing("curtain", curtain.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "curtain", curtain.index, curtain.name);
                                return (
                                  <span
                                    key={`V${curtain.index}`}
                                    className={`${styles.shadePairGroup} ${styles.deviceButtonWrapper} ${highlightClass}`}
                                    title={`${curtain.name || ""} - Venetian (long-press to highlight)`}
                                    onMouseEnter={() => handleDeviceMouseEnter(result.ip, "curtain", curtain.index, curtain.name)}
                                    onMouseLeave={handleDeviceMouseLeave}
                                    onTouchStart={() => handleDeviceTouchStart(result.ip, "curtain", curtain.index, curtain.name)}
                                    onTouchEnd={handleDeviceTouchEnd}
                                    onTouchMove={handleDeviceTouchMove}
                                  >
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.venetianSwitch} ${styles.shadeUpButton} ${isOpen ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${openPending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "open", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={openPending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{isMoving ? "■" : getCompactName("venetian", curtain.index, "up")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↑"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.venetianSwitch} ${styles.shadeDownButton} ${isClosed ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${closePending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "close", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={closePending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{isMoving ? "■" : getCompactName("venetian", curtain.index, "down")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↓"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Show dash if no Direct entities */}
                              {lightRelays.length === 0 && momentaryRelays.length === 0 && curtainDevices.length === 0 && venetianDevices.length === 0 && (
                                <span style={{ color: "var(--muted)" }}>—</span>
                              )}
                            </div>
                          );
                        })()
                      ) : result.status === "panel" ? (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          ...
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {/* Link Live State Column */}
                    <td className={styles.directLinkCell} style={{ width: columnWidths.link }} data-label="Link">
                      {liveState?.fullState ? (
                        (() => {
                          // Get relay pair configuration from settings (for robust classification)
                          const relayPairs = result.settings?.relayPairs;
                          
                          // Classify relays by device type using settings-based classification
                          // Link devices only - pass skipLinkHiding=true since we're showing Link devices
                          const classifiedRelays = liveState.fullState.relays
                            .filter(r => isLinkDevice(r.name))
                            .map(relay => ({
                              ...relay,
                              deviceType: getRelayDeviceType(relay.index, relay.name, relayPairs, true),
                            }))
                            .filter(r => r.deviceType !== "hidden");
                          
                          const lightRelays = classifiedRelays.filter(r => r.deviceType === "light");
                          const momentaryRelays = classifiedRelays.filter(r => r.deviceType === "momentary");
                          
                          // Classify curtains by device type
                          const classifiedCurtains = liveState.fullState.curtains
                            .filter(c => isLinkDevice(c.name)) // Link only
                            .map(curtain => ({
                              ...curtain,
                              deviceType: getCurtainDeviceType(curtain.index, curtain.name, relayPairs),
                            }))
                            .filter(c => c.deviceType !== "hidden");
                          
                          const curtainDevices = classifiedCurtains.filter(c => c.deviceType === "curtain");
                          const venetianDevices = classifiedCurtains.filter(c => c.deviceType === "venetian");
                          
                          // Helper to get display name (strip -Link suffix if present)
                          const getDisplayName = (name?: string) => {
                            if (!name) return "?";
                            return name.replace(/[-_\s]?link$/i, "").trim() || "?";
                          };
                          
                          // Helper to get compact name (L1, S1, D1, etc.)
                          const getCompactName = (type: "light" | "door" | "shade" | "venetian", index: number, direction?: "up" | "down") => {
                            const prefix = type === "light" ? "L" : type === "door" ? "D" : "S";
                            const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "";
                            return `${prefix}${index}${arrow}`;
                          };
                          
                          // Check if a device is currently being edited (Link column)
                          const isEditingLink = (type: "relay" | "curtain", index: number) =>
                            editingDevice?.ip === result.ip &&
                            editingDevice?.type === type &&
                            editingDevice?.index === index;
                          
                          return (
                            <div className={styles.entityStates}>
                              {/* Link Lights (Normal -> Switch mode) */}
                              {lightRelays.map((relay) => {
                                const isPending = pendingCommands.has(`${result.ip}-L${relay.index}`);
                                const editing = isEditingLink("relay", relay.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "relay", relay.index, relay.name);
                                return (
                                  <span key={`LL${relay.index}`} className={styles.deviceButtonWrapper}>
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <button
                                        className={`${styles.switchButton} ${styles.lightSwitch} ${styles.linkButton} ${relay.state ? styles.switchOn : styles.switchOff} ${isPending ? styles.pending : ""} ${highlightClass}`}
                                        onClick={(e) => handleLightToggle(e, result.ip, relay.index)}
                                        onContextMenu={(e) => handleRightClickRename(e, result.ip, "relay", relay.index, relay.name || "")}
                                        onMouseEnter={() => handleDeviceMouseEnter(result.ip, "relay", relay.index, relay.name)}
                                        onMouseLeave={handleDeviceMouseLeave}
                                        onTouchStart={() => handleDeviceTouchStart(result.ip, "relay", relay.index, relay.name)}
                                        onTouchEnd={handleDeviceTouchEnd}
                                        onTouchMove={handleDeviceTouchMove}
                                        disabled={isPending || !onSendCommand}
                                        title={`${relay.name || ""} (long-press to highlight)`}
                                      >
                                        <span className={styles.deviceCompactName}>{getCompactName("light", relay.index)}</span>
                                        <span className={styles.deviceFullName}>{getDisplayName(relay.name)}</span>
                                      </button>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Link Door locks / Momentary (Normal -> Momentary mode) */}
                              {momentaryRelays.map((relay) => {
                                const isPending = pendingCommands.has(`${result.ip}-L${relay.index}`);
                                const editing = isEditingLink("relay", relay.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "relay", relay.index, relay.name);
                                return (
                                  <span key={`LD${relay.index}`} className={styles.deviceButtonWrapper}>
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <button
                                        className={`${styles.switchButton} ${styles.doorSwitch} ${styles.linkButton} ${relay.state ? styles.switchOn : styles.switchOff} ${isPending ? styles.pending : ""} ${highlightClass}`}
                                        onClick={(e) => handleLightToggle(e, result.ip, relay.index)}
                                        onContextMenu={(e) => handleRightClickRename(e, result.ip, "relay", relay.index, relay.name || "")}
                                        onMouseEnter={() => handleDeviceMouseEnter(result.ip, "relay", relay.index, relay.name)}
                                        onMouseLeave={handleDeviceMouseLeave}
                                        onTouchStart={() => handleDeviceTouchStart(result.ip, "relay", relay.index, relay.name)}
                                        onTouchEnd={handleDeviceTouchEnd}
                                        onTouchMove={handleDeviceTouchMove}
                                        disabled={isPending || !onSendCommand}
                                        title={`${relay.name || ""} (long-press to highlight)`}
                                      >
                                        <span className={styles.deviceCompactName}>{getCompactName("door", relay.index)}</span>
                                        <span className={styles.deviceFullName}>{getDisplayName(relay.name)}</span>
                                      </button>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Link Curtains (Curtain pair mode) */}
                              {curtainDevices.map((curtain) => {
                                const openPending = pendingCommands.has(`${result.ip}-S${curtain.index}-open`);
                                const closePending = pendingCommands.has(`${result.ip}-S${curtain.index}-close`);
                                const isOpen = curtain.state === "open";
                                const isClosed = curtain.state === "closed";
                                const isMoving = curtain.state === "opening" || curtain.state === "closing";
                                const editing = isEditingLink("curtain", curtain.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "curtain", curtain.index, curtain.name);
                                return (
                                  <span
                                    key={`LS${curtain.index}`}
                                    className={`${styles.shadePairGroup} ${styles.deviceButtonWrapper} ${highlightClass}`}
                                    title={`${curtain.name || ""} (long-press to highlight)`}
                                    onMouseEnter={() => handleDeviceMouseEnter(result.ip, "curtain", curtain.index, curtain.name)}
                                    onMouseLeave={handleDeviceMouseLeave}
                                    onTouchStart={() => handleDeviceTouchStart(result.ip, "curtain", curtain.index, curtain.name)}
                                    onTouchEnd={handleDeviceTouchEnd}
                                    onTouchMove={handleDeviceTouchMove}
                                  >
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.shadeSwitch} ${styles.shadeUpButton} ${styles.linkButton} ${isOpen ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${openPending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "open", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={openPending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{getCompactName("shade", curtain.index, "up")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↑"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.shadeSwitch} ${styles.shadeDownButton} ${styles.linkButton} ${isClosed ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${closePending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "close", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={closePending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{getCompactName("shade", curtain.index, "down")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↓"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Link Venetian blinds (Venetian pair mode) */}
                              {venetianDevices.map((curtain) => {
                                const openPending = pendingCommands.has(`${result.ip}-S${curtain.index}-open`);
                                const closePending = pendingCommands.has(`${result.ip}-S${curtain.index}-close`);
                                const isOpen = curtain.state === "open";
                                const isClosed = curtain.state === "closed";
                                const isMoving = curtain.state === "opening" || curtain.state === "closing";
                                const editing = isEditingLink("curtain", curtain.index);
                                const highlightClass = getDeviceHighlightClass(result.ip, "curtain", curtain.index, curtain.name);
                                return (
                                  <span
                                    key={`LV${curtain.index}`}
                                    className={`${styles.shadePairGroup} ${styles.deviceButtonWrapper} ${highlightClass}`}
                                    title={`${curtain.name || ""} - Venetian (long-press to highlight)`}
                                    onMouseEnter={() => handleDeviceMouseEnter(result.ip, "curtain", curtain.index, curtain.name)}
                                    onMouseLeave={handleDeviceMouseLeave}
                                    onTouchStart={() => handleDeviceTouchStart(result.ip, "curtain", curtain.index, curtain.name)}
                                    onTouchEnd={handleDeviceTouchEnd}
                                    onTouchMove={handleDeviceTouchMove}
                                  >
                                    {editing ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        className={styles.inlineEditInput}
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveRename}
                                        disabled={savingRename}
                                      />
                                    ) : (
                                      <>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.venetianSwitch} ${styles.shadeUpButton} ${styles.linkButton} ${isOpen ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${openPending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "open", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={openPending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{getCompactName("venetian", curtain.index, "up")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↑"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                        <button
                                          className={`${styles.shadeNameButton} ${styles.venetianSwitch} ${styles.shadeDownButton} ${styles.linkButton} ${isClosed ? styles.switchOn : styles.switchOff} ${isMoving ? styles.shadeMoving : ""} ${closePending ? styles.pending : ""}`}
                                          onClick={(e) => handleShadeAction(e, result.ip, curtain.index, "close", curtain.state)}
                                          onContextMenu={(e) => handleRightClickRename(e, result.ip, "curtain", curtain.index, curtain.name || "")}
                                          disabled={closePending || !onSendCommand}
                                        >
                                          <span className={styles.deviceCompactName}>{getCompactName("venetian", curtain.index, "down")}</span>
                                          <span className={styles.deviceFullName}>{isMoving ? "■" : "↓"} {getDisplayName(curtain.name)}</span>
                                        </button>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
                              {/* Show dash if no Link entities */}
                              {lightRelays.length === 0 && momentaryRelays.length === 0 && curtainDevices.length === 0 && venetianDevices.length === 0 && (
                                <span style={{ color: "var(--muted)" }}>—</span>
                              )}
                            </div>
                          );
                        })()
                      ) : result.status === "panel" ? (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          ...
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={styles.centeredColumn} data-label="Touch">
                      <span className={`${styles.touchedBadge} ${touchedClass}`}>
                        {touched ? "Yes" : "No"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

