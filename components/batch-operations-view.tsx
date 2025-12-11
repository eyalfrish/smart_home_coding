'use client';

import { useCallback, useMemo, useState, useRef, type DragEvent, type ChangeEvent } from "react";
import styles from "./discovery-dashboard.module.css";
import type { DiscoveryResult, PanelInfo, LivePanelState, PanelCommand } from "@/lib/discovery/types";

interface BatchOperationsViewProps {
  selectedPanelIps: Set<string>;
  panelResults: DiscoveryResult[];
  panelInfoMap: Record<string, PanelInfo>;
  livePanelStates?: Map<string, LivePanelState>;
  onBack: () => void;
  onSelectionChange: (ip: string, selected: boolean) => void;
  onSendCommand?: (ip: string, command: PanelCommand) => Promise<boolean>;
  onPanelSettingsUpdate?: (ip: string, settings: { logging?: boolean; longPressMs?: number }) => void;
}

// Sub-view types
type BatchSubView = "main" | "firmware-update";

// Status for each panel during batch operation
type PanelBatchStatus = "idle" | "in-progress" | "success" | "failed";

// Types of operations
type DirectOperationType = "restart" | "scenes-all-off" | "toggle-all" | "toggle-backlight";
type VirtualOperationType = "virtual-backlight-on" | "virtual-backlight-off" | "virtual-all-lights-on" | "virtual-all-lights-off" | "virtual-all-switches-off";
type SettingsOperationType = "set-logging-on" | "set-logging-off" | "set-longpress";
type BatchOperationType = DirectOperationType | VirtualOperationType | SettingsOperationType;

interface BatchOperation {
  id: BatchOperationType;
  label: string;
  command?: PanelCommand; // Direct operations have a single command
  isVirtual?: boolean; // Virtual operations are computed
  confirmMessage?: string;
  variant?: "default" | "warning" | "danger";
  tooltip?: string;
}

// Direct operations - map directly to panel commands (no group titles, just buttons with their names)
const DIRECT_OPERATIONS: BatchOperation[] = [
  {
    id: "restart",
    label: "Restart",
    command: { command: "restart" },
    confirmMessage: "Are you sure you want to restart all selected panels? They will be temporarily unavailable.",
    variant: "danger",
  },
  {
    id: "scenes-all-off",
    label: "Scenes All Off",
    command: { command: "all_off" },
    variant: "danger",
  },
  {
    id: "toggle-all",
    label: "Toggle All",
    command: { command: "toggle_all" },
    variant: "default",
    tooltip: "If ANY relay is ON → turns all OFF. Only if ALL relays are OFF → turns all ON.",
  },
  {
    id: "toggle-backlight",
    label: "Toggle Backlight",
    // No fixed command - determined per panel based on current state
    variant: "default",
    tooltip: "Toggles backlight on each panel based on its current state",
  },
];

// Virtual operations - our implementation using multiple commands
const VIRTUAL_OPERATIONS: BatchOperation[] = [
  {
    id: "virtual-backlight-on",
    label: "Backlight On",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns ON backlight on all selected panels",
  },
  {
    id: "virtual-backlight-off",
    label: "Backlight Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns OFF backlight on all selected panels",
  },
  {
    id: "virtual-all-lights-on",
    label: "All Lights On",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns ON all configured light relays on each panel",
  },
  {
    id: "virtual-all-lights-off",
    label: "All Lights Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns OFF all configured light relays on each panel",
  },
  {
    id: "virtual-all-switches-off",
    label: "All Switches Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Turns OFF ALL relays (lights + unconfigured switches) on each panel",
  },
];

// Settings operations - HTTP-based configuration changes
const SETTINGS_OPERATIONS: BatchOperation[] = [
  {
    id: "set-logging-on",
    label: "Logging On",
    isVirtual: true,
    variant: "default",
    tooltip: "Enable logging on all selected panels",
  },
  {
    id: "set-logging-off",
    label: "Logging Off",
    isVirtual: true,
    variant: "default",
    tooltip: "Disable logging on all selected panels",
  },
  {
    id: "set-longpress",
    label: "Set Long Press",
    isVirtual: true,
    variant: "default",
    tooltip: "Set long press time on all selected panels",
  },
];

// Compare two semver-like version strings
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

// Check if a relay is a configured light (not a generic "Relay N" name)
function isConfiguredRelay(relay: { name?: string }): boolean {
  if (!relay.name || relay.name.trim() === "") return false;
  if (/^Relay\s+\d+$/i.test(relay.name.trim())) return false;
  return true;
}

// Check if a relay is a door (has door/lock/unlock in name)
function isDoorRelay(relay: { name?: string }): boolean {
  if (!relay.name) return false;
  const name = relay.name.toLowerCase();
  return name.includes("door") || name.includes("lock") || name.includes("unlock");
}

export default function BatchOperationsView({
  selectedPanelIps,
  panelResults,
  panelInfoMap,
  livePanelStates,
  onBack,
  onSelectionChange,
  onSendCommand,
  onPanelSettingsUpdate,
}: BatchOperationsViewProps) {
  // Track batch operation status per panel
  const [panelStatuses, setPanelStatuses] = useState<Map<string, PanelBatchStatus>>(new Map());
  // Track if a batch operation is currently running
  const [isRunning, setIsRunning] = useState(false);
  // Track the last operation that was run (for re-run functionality)
  const [lastOperation, setLastOperation] = useState<BatchOperation | null>(null);
  // Long press time input value
  const [longPressInput, setLongPressInput] = useState<string>("1000");
  // Current sub-view (main or firmware-update)
  const [subView, setSubView] = useState<BatchSubView>("main");
  // Firmware file for upload
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  // Drag state for drop zone
  const [isDragging, setIsDragging] = useState(false);
  // File input refs
  const firmwareInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  // Credentials for backup (HTTP Basic Auth)
  const [backupCredentials, setBackupCredentials] = useState<{ username: string; password: string } | null>(null);
  const [showCredentialsPrompt, setShowCredentialsPrompt] = useState(false);
  const [credentialsInput, setCredentialsInput] = useState({ username: "", password: "" });

  // Filter to only show selected panels that are actual panels
  const selectedPanels = useMemo(() => {
    return panelResults.filter(
      (result) => result.status === "panel" && selectedPanelIps.has(result.ip)
    );
  }, [panelResults, selectedPanelIps]);

  // Calculate the highest firmware version from selected panels
  const highestVersion = useMemo(() => {
    if (!livePanelStates) return null;
    let highest: string | null = null;
    selectedPanels.forEach((panel) => {
      const state = livePanelStates.get(panel.ip);
      const version = state?.fullState?.version;
      if (version) {
        if (!highest || compareVersions(version, highest) > 0) {
          highest = version;
        }
      }
    });
    return highest;
  }, [selectedPanels, livePanelStates]);

  // Calculate statistics
  const stats = useMemo(() => {
    let success = 0;
    let failed = 0;
    let inProgress = 0;
    
    selectedPanels.forEach((panel) => {
      const status = panelStatuses.get(panel.ip);
      if (status === "success") success++;
      else if (status === "failed") failed++;
      else if (status === "in-progress") inProgress++;
    });

    return { success, failed, inProgress, total: selectedPanels.length };
  }, [selectedPanels, panelStatuses]);

  // Calculate most common logging value and long press time for color coding
  const { mostCommonLogging, mostCommonLongPress } = useMemo(() => {
    const loggingCounts: Record<string, number> = { 'true': 0, 'false': 0 };
    const longPressCounts: Record<number, number> = {};
    
    selectedPanels.forEach(result => {
      if (!result.settings) return;
      
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
  }, [selectedPanels]);

  const hasFailures = stats.failed > 0;
  const hasAnyStatus = stats.success > 0 || stats.failed > 0 || stats.inProgress > 0;

  const handleRemovePanel = useCallback((ip: string) => {
    onSelectionChange(ip, false);
  }, [onSelectionChange]);

  // Execute a direct batch operation (single command per panel)
  const executeDirectOperation = useCallback(async (
    operation: BatchOperation,
    targetIps: string[]
  ) => {
    if (!onSendCommand || targetIps.length === 0) return;

    setIsRunning(true);
    setLastOperation(operation);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // Execute commands in parallel but update status as each completes
    const promises = targetIps.map(async (ip) => {
      try {
        let command = operation.command;
        
        // Special case: Toggle Backlight needs to read current state
        if (operation.id === "toggle-backlight") {
          const panelState = livePanelStates?.get(ip);
          const currentBacklight = panelState?.fullState?.statusLedOn ?? false;
          command = { command: "backlight", state: !currentBacklight };
        }

        if (!command) {
          throw new Error("No command defined");
        }

        const success = await onSendCommand(ip, command);
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, success ? "success" : "failed");
          return next;
        });
        return { ip, success };
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
        return { ip, success: false };
      }
    });

    await Promise.all(promises);
    setIsRunning(false);
  }, [onSendCommand, livePanelStates]);

  // Execute a settings operation via HTTP
  const executeSettingsOperation = useCallback(async (
    operation: BatchOperation,
    targetIps: string[],
    longPressValue?: number
  ) => {
    if (targetIps.length === 0) return;

    setIsRunning(true);
    setLastOperation(operation);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // Execute on each panel
    const promises = targetIps.map(async (ip) => {
      try {
        const response = await fetch(`/api/panels/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ip,
            operation: operation.id,
            longPressMs: longPressValue,
          }),
        });

        const success = response.ok;
        
        // On success, update panel settings in the parent state
        if (success && onPanelSettingsUpdate) {
          try {
            const data = await response.json();
            if (data.settings) {
              onPanelSettingsUpdate(ip, data.settings);
            }
          } catch {
            // Ignore JSON parse errors - the operation still succeeded
          }
        }
        
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, success ? "success" : "failed");
          return next;
        });
        return { ip, success };
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
        return { ip, success: false };
      }
    });

    await Promise.all(promises);
    setIsRunning(false);
  }, [onPanelSettingsUpdate]);

  // Execute a virtual batch operation (multiple commands per panel or computed commands)
  const executeVirtualOperation = useCallback(async (
    operation: BatchOperation,
    targetIps: string[]
  ) => {
    if (!onSendCommand || targetIps.length === 0) return;

    setIsRunning(true);
    setLastOperation(operation);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // Execute on each panel
    const promises = targetIps.map(async (ip) => {
      try {
        // Handle backlight operations
        if (operation.id === "virtual-backlight-on" || operation.id === "virtual-backlight-off") {
          const targetState = operation.id === "virtual-backlight-on";
          const success = await onSendCommand(ip, { command: "backlight", state: targetState });
          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, success ? "success" : "failed");
            return next;
          });
          return { ip, success };
        }

        // Handle all lights operations (configured relays only)
        if (operation.id === "virtual-all-lights-on" || operation.id === "virtual-all-lights-off") {
          const targetState = operation.id === "virtual-all-lights-on";
          const panelState = livePanelStates?.get(ip);
          const relays = panelState?.fullState?.relays ?? [];
          const configuredRelays = relays.filter(isConfiguredRelay);

          if (configuredRelays.length === 0) {
            // No configured relays, mark as success (nothing to do)
            setPanelStatuses(prev => {
              const next = new Map(prev);
              next.set(ip, "success");
              return next;
            });
            return { ip, success: true };
          }

          // Send set_relay command for each configured relay
          const relayPromises = configuredRelays.map(relay =>
            onSendCommand(ip, { command: "set_relay", index: relay.index, state: targetState })
          );

          const results = await Promise.all(relayPromises);
          const allSuccess = results.every(r => r);

          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, allSuccess ? "success" : "failed");
            return next;
          });
          return { ip, success: allSuccess };
        }

        // Handle all switches off (ALL relays, including unconfigured)
        if (operation.id === "virtual-all-switches-off") {
          const panelState = livePanelStates?.get(ip);
          const relays = panelState?.fullState?.relays ?? [];

          if (relays.length === 0) {
            // No relays, mark as success (nothing to do)
            setPanelStatuses(prev => {
              const next = new Map(prev);
              next.set(ip, "success");
              return next;
            });
            return { ip, success: true };
          }

          // Send set_relay OFF command for ALL relays
          const relayPromises = relays.map(relay =>
            onSendCommand(ip, { command: "set_relay", index: relay.index, state: false })
          );

          const results = await Promise.all(relayPromises);
          const allSuccess = results.every(r => r);

          setPanelStatuses(prev => {
            const next = new Map(prev);
            next.set(ip, allSuccess ? "success" : "failed");
            return next;
          });
          return { ip, success: allSuccess };
        }

        // Unknown operation
        throw new Error("Unknown virtual operation");
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
        return { ip, success: false };
      }
    });

    await Promise.all(promises);
    setIsRunning(false);
  }, [onSendCommand, livePanelStates]);

  // Check if operation is a settings operation
  const isSettingsOperation = useCallback((id: BatchOperationType) => {
    return id.startsWith("set-");
  }, []);

  // Handle clicking any batch operation button
  const handleOperationClick = useCallback((operation: BatchOperation, longPressValue?: number) => {
    // If there's a confirm message, show confirmation
    if (operation.confirmMessage) {
      const confirmed = window.confirm(operation.confirmMessage);
      if (!confirmed) return;
    }

    // Reset all statuses before starting new operation
    setPanelStatuses(new Map());

    // Execute on all selected panels
    const targetIps = selectedPanels.map(p => p.ip);

    if (isSettingsOperation(operation.id)) {
      executeSettingsOperation(operation, targetIps, longPressValue);
    } else if (operation.isVirtual) {
      executeVirtualOperation(operation, targetIps);
    } else {
      executeDirectOperation(operation, targetIps);
    }
  }, [selectedPanels, executeDirectOperation, executeVirtualOperation, executeSettingsOperation, isSettingsOperation]);

  // Handle re-run on failed panels
  const handleRerunFailed = useCallback(() => {
    if (!lastOperation || !hasFailures) return;

    // Get only the failed panel IPs
    const failedIps = selectedPanels
      .filter(p => panelStatuses.get(p.ip) === "failed")
      .map(p => p.ip);

    // Only reset status for failed panels (keep success statuses)
    setPanelStatuses(prev => {
      const next = new Map(prev);
      failedIps.forEach(ip => next.delete(ip));
      return next;
    });

    // Re-run on failed panels only
    if (isSettingsOperation(lastOperation.id)) {
      const longPressValue = lastOperation.id === "set-longpress" ? parseInt(longPressInput, 10) : undefined;
      executeSettingsOperation(lastOperation, failedIps, longPressValue);
    } else if (lastOperation.isVirtual) {
      executeVirtualOperation(lastOperation, failedIps);
    } else {
      executeDirectOperation(lastOperation, failedIps);
    }
  }, [lastOperation, hasFailures, selectedPanels, panelStatuses, executeDirectOperation, executeVirtualOperation, executeSettingsOperation, isSettingsOperation, longPressInput]);

  // Firmware file drag handlers
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFirmwareDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith(".bin")) {
        setFirmwareFile(file);
      } else {
        alert("Please select a .bin firmware file");
      }
    }
  }, []);

  const handleFirmwareFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFirmwareFile(files[0]);
    }
  }, []);

  // Execute config operation (backup, restore)
  const executeConfigOperation = useCallback(async (
    operation: "backup" | "restore",
    targetIps: string[],
    options?: { configData?: string; credentials?: { username: string; password: string } }
  ) => {
    if (targetIps.length === 0) return;

    setIsRunning(true);
    
    // Create a pseudo-operation for tracking
    const pseudoOp: BatchOperation = {
      id: `config-${operation}` as BatchOperationType,
      label: operation === "backup" ? "Backup Config" : "Restore Config",
      isVirtual: true,
    };
    setLastOperation(pseudoOp);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // For backup, collect all configs
    const backups: Array<{ ip: string; data: string; success: boolean }> = [];

    // Execute on each panel
    const promises = targetIps.map(async (ip) => {
      try {
        const response = await fetch("/api/panels/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ip,
            operation,
            configData: options?.configData,
            credentials: options?.credentials,
          }),
        });

        const result = await response.json();
        const success = response.ok && result.success;

        if (operation === "backup" && success && result.configData) {
          backups.push({ ip, data: result.configData, success: true });
        }

        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, success ? "success" : "failed");
          return next;
        });
        return { ip, success };
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
        return { ip, success: false };
      }
    });

    await Promise.all(promises);

    // For backup operation, trigger downloads
    if (operation === "backup" && backups.length > 0) {
      for (const backup of backups) {
        try {
          // Convert base64 to Uint8Array (browser-compatible)
          const binaryString = atob(backup.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `config_${backup.ip.replace(/\./g, "_")}.bin`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error("Failed to download backup for", backup.ip, e);
        }
      }
    }

    setIsRunning(false);
  }, []);

  // Execute firmware upload
  const executeFirmwareUpload = useCallback(async (
    file: File,
    targetIps: string[]
  ) => {
    if (!file || targetIps.length === 0) return;

    setIsRunning(true);
    
    const pseudoOp: BatchOperation = {
      id: "firmware-upload" as BatchOperationType,
      label: "Firmware Upload",
      isVirtual: true,
      confirmMessage: `Are you sure you want to upload firmware "${file.name}" to ${targetIps.length} panel(s)? This cannot be undone.`,
      variant: "danger",
    };
    setLastOperation(pseudoOp);

    // Set all target panels to in-progress
    setPanelStatuses(prev => {
      const next = new Map(prev);
      targetIps.forEach(ip => next.set(ip, "in-progress"));
      return next;
    });

    // Execute on each panel (sequentially to avoid overwhelming the network)
    for (const ip of targetIps) {
      try {
        const formData = new FormData();
        formData.append("ip", ip);
        formData.append("firmware", file);

        const response = await fetch("/api/panels/firmware", {
          method: "POST",
          body: formData,
        });

        const success = response.ok;
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, success ? "success" : "failed");
          return next;
        });
      } catch {
        setPanelStatuses(prev => {
          const next = new Map(prev);
          next.set(ip, "failed");
          return next;
        });
      }
    }

    setIsRunning(false);
  }, []);

  // Handle backup button click - show credentials prompt
  const handleBackupClick = useCallback(() => {
    if (backupCredentials) {
      // Already have credentials, run backup
      const targetIps = selectedPanels.map(p => p.ip);
      setPanelStatuses(new Map());
      executeConfigOperation("backup", targetIps, { credentials: backupCredentials });
    } else {
      // Show credentials prompt
      setShowCredentialsPrompt(true);
    }
  }, [selectedPanels, backupCredentials, executeConfigOperation]);

  // Handle credentials submit
  const handleCredentialsSubmit = useCallback(() => {
    if (!credentialsInput.username || !credentialsInput.password) {
      alert("Please enter both username and password.");
      return;
    }
    const creds = { username: credentialsInput.username, password: credentialsInput.password };
    setBackupCredentials(creds);
    setShowCredentialsPrompt(false);
    
    // Run the backup with credentials
    const targetIps = selectedPanels.map(p => p.ip);
    setPanelStatuses(new Map());
    executeConfigOperation("backup", targetIps, { credentials: creds });
  }, [credentialsInput, selectedPanels, executeConfigOperation]);

  // Handle restore - triggered after file selection
  const handleRestoreFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const targetIps = selectedPanels.map(p => p.ip);

    const confirmed = window.confirm(
      `Are you sure you want to restore configuration from "${file.name}" to ${targetIps.length} panel(s)?\n\nPanels will restart after restore.`
    );
    if (!confirmed) {
      // Clear the file input
      e.target.value = "";
      return;
    }

    setPanelStatuses(new Map());

    // Read file and convert to base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      executeConfigOperation("restore", targetIps, { configData: base64 });
    };
    reader.readAsDataURL(file);

    // Clear the file input for future selections
    e.target.value = "";
  }, [selectedPanels, executeConfigOperation]);

  // Handle firmware upload button click
  const handleFirmwareUpload = useCallback(() => {
    if (!firmwareFile) {
      alert("Please select a firmware file first.");
      return;
    }

    const targetIps = selectedPanels.map(p => p.ip);
    const confirmed = window.confirm(
      `Are you sure you want to upload firmware "${firmwareFile.name}" to ${targetIps.length} panel(s)?\n\nThis operation cannot be undone. Panels will restart after upload.`
    );
    if (!confirmed) return;

    setPanelStatuses(new Map());
    executeFirmwareUpload(firmwareFile, targetIps);
  }, [firmwareFile, selectedPanels, executeFirmwareUpload]);

  const count = selectedPanels.length;

  // Get status icon for a panel
  const getStatusIcon = (ip: string) => {
    const status = panelStatuses.get(ip);
    switch (status) {
      case "in-progress":
        return <span className={styles.batchStatusInProgress} title="In progress">⏳</span>;
      case "success":
        return <span className={styles.batchStatusSuccess} title="Success">✓</span>;
      case "failed":
        return <span className={styles.batchStatusFailed} title="Failed">✗</span>;
      default:
        return <span className={styles.batchStatusIdle}></span>;
    }
  };

  // Find operations by ID
  const getDirectOp = (id: DirectOperationType) => DIRECT_OPERATIONS.find(op => op.id === id)!;
  const getVirtualOp = (id: VirtualOperationType) => VIRTUAL_OPERATIONS.find(op => op.id === id)!;
  const getSettingsOp = (id: SettingsOperationType) => SETTINGS_OPERATIONS.find(op => op.id === id)!;

  // Render firmware update sub-view
  if (subView === "firmware-update") {
    return (
      <div className={styles.batchView}>
        <button 
          type="button" 
          className={styles.backButton} 
          onClick={() => {
            setSubView("main");
            setFirmwareFile(null);
            setPanelStatuses(new Map());
            setBackupCredentials(null);
            setCredentialsInput({ username: "", password: "" });
          }}
        >
          ⬅️ Back to Batch Operations
        </button>
        
        <div className={styles.batchHeader}>
          <h2>Firmware Update <span className={styles.batchCount}>(batching {count} {count === 1 ? "panel" : "panels"})</span></h2>
          <p className={`${styles.batchProgress} ${hasAnyStatus ? "" : styles.batchProgressHidden}`}>
            {stats.inProgress > 0 && <span className={styles.progressInProgress}>⏳ {stats.inProgress} in progress</span>}
            {stats.success > 0 && <span className={styles.progressSuccess}>✓ {stats.success} succeeded</span>}
            {stats.failed > 0 && <span className={styles.progressFailed}>✗ {stats.failed} failed</span>}
            {!hasAnyStatus && <span className={styles.progressPlaceholder}>&nbsp;</span>}
          </p>
        </div>

        <div className={styles.batchControlsSections}>
          {/* Configuration Operations */}
          <div className={styles.batchControlsSection}>
            <div className={styles.batchSectionHeader}>
              <h3>Configuration</h3>
              <span className={styles.batchSectionHint}>Backup or restore panel configuration</span>
            </div>
            <div className={styles.batchControlsArea}>
              <div className={styles.batchControlsRow}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={handleBackupClick}
                  disabled={isRunning || count === 0}
                  title="Download configuration from all selected panels (requires authentication)"
                >
                  📥 Backup Config {backupCredentials ? "✓" : ""}
                </button>
                <span className={styles.buttonGroupSpacer}></span>
                <input
                  type="file"
                  ref={configInputRef}
                  onChange={handleRestoreFileSelect}
                  style={{ display: "none" }}
                  accept=".bin,.json"
                />
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => configInputRef.current?.click()}
                  disabled={isRunning || count === 0}
                  title="Select and restore configuration to all selected panels"
                >
                  📤 Restore Config
                </button>
              </div>
              {backupCredentials && (
                <div className={styles.credentialsInfo}>
                  Using credentials for user: <strong>{backupCredentials.username}</strong>
                  <button
                    type="button"
                    className={styles.credentialsClearButton}
                    onClick={() => setBackupCredentials(null)}
                    disabled={isRunning}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Credentials Prompt Modal */}
          {showCredentialsPrompt && (
            <div className={styles.modalOverlay}>
              <div className={styles.modalContent}>
                <h3>Panel Authentication</h3>
                <p>The backup endpoint requires authentication. Enter the panel credentials:</p>
                <div className={styles.modalForm}>
                  <div className={styles.modalField}>
                    <label htmlFor="backup-username">Username</label>
                    <input
                      id="backup-username"
                      type="text"
                      value={credentialsInput.username}
                      onChange={(e) => setCredentialsInput(prev => ({ ...prev, username: e.target.value }))}
                      placeholder="admin"
                      autoFocus
                    />
                  </div>
                  <div className={styles.modalField}>
                    <label htmlFor="backup-password">Password</label>
                    <input
                      id="backup-password"
                      type="password"
                      value={credentialsInput.password}
                      onChange={(e) => setCredentialsInput(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="password"
                      onKeyDown={(e) => e.key === "Enter" && handleCredentialsSubmit()}
                    />
                  </div>
                </div>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.modalButtonSecondary}
                    onClick={() => {
                      setShowCredentialsPrompt(false);
                      setCredentialsInput({ username: "", password: "" });
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.modalButtonPrimary}
                    onClick={handleCredentialsSubmit}
                  >
                    Continue with Backup
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Firmware Upload */}
          <div className={styles.batchControlsSection}>
            <div className={styles.batchSectionHeader}>
              <h3>Firmware Upload</h3>
              <span className={styles.batchSectionHint}>Upload firmware .bin file to all selected panels</span>
            </div>
            <div className={styles.batchControlsArea}>
              <div 
                className={`${styles.firmwareDropZone} ${isDragging ? styles.firmwareDropZoneDragging : ""} ${firmwareFile ? styles.firmwareDropZoneHasFile : ""} ${isRunning ? styles.firmwareDropZoneDisabled : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleFirmwareDrop}
                onClick={() => !isRunning && firmwareInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={firmwareInputRef}
                  onChange={handleFirmwareFileSelect}
                  style={{ display: "none" }}
                  accept=".bin"
                />
                {firmwareFile ? (
                  <div className={styles.firmwareFileInfo}>
                    <span className={styles.firmwareFileName}>📦 {firmwareFile.name}</span>
                    <span className={styles.firmwareFileSize}>
                      ({(firmwareFile.size / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      className={styles.firmwareClearButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFirmwareFile(null);
                      }}
                      disabled={isRunning}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className={styles.firmwareDropPrompt}>
                    <span className={styles.firmwareDropIcon}>📁</span>
                    <span className={styles.firmwareDropText}>
                      Drag & drop firmware .bin file here
                    </span>
                    <span className={styles.firmwareDropHint}>
                      or click to browse
                    </span>
                  </div>
                )}
              </div>
              <div className={styles.firmwareUploadRow}>
                <button
                  type="button"
                  className={`${styles.batchControlButton} ${styles.batchControlDanger} ${styles.firmwareUploadButton} ${!firmwareFile ? styles.batchControlButtonDisabled : ""}`}
                  onClick={handleFirmwareUpload}
                  disabled={isRunning || count === 0 || !firmwareFile}
                >
                  🚀 Upload Firmware to {count} Panel{count !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Re-run on failed button */}
        <div className={styles.rerunSection}>
          {hasFailures && !isRunning && lastOperation ? (
            <button
              type="button"
              className={styles.rerunButton}
              onClick={handleRerunFailed}
              title={`Re-run "${lastOperation.label}" on ${stats.failed} failed panel${stats.failed > 1 ? 's' : ''}`}
            >
              🔁 Re-run on failed panels ({stats.failed})
            </button>
          ) : (
            <div className={styles.rerunPlaceholder}></div>
          )}
        </div>

        {/* Selected panels table */}
        {count === 0 ? (
          <div className={styles.emptyBatchState}>
            No panels selected. Go back and select panels to perform firmware operations.
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.statusHeader}>Status</th>
                  <th>IP</th>
                  <th>Name</th>
                  <th>Connection</th>
                  <th>FW Version</th>
                </tr>
              </thead>
              <tbody>
                {selectedPanels.map((panel) => {
                  const metadata = panelInfoMap[panel.ip];
                  const liveState = livePanelStates?.get(panel.ip);
                  const batchStatus = panelStatuses.get(panel.ip) ?? "idle";
                  const rowStatusClass = batchStatus === "success" 
                    ? styles.batchRowSuccess 
                    : batchStatus === "failed" 
                      ? styles.batchRowFailed 
                      : batchStatus === "in-progress"
                        ? styles.batchRowInProgress
                        : "";

                  return (
                    <tr key={panel.ip} className={`${styles.selectedRow} ${rowStatusClass}`}>
                      <td className={styles.batchStatusCell}>
                        {getStatusIcon(panel.ip)}
                      </td>
                      <td>
                        <a
                          href={`http://${panel.ip}/`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.panelLink}
                        >
                          {panel.ip}
                        </a>
                      </td>
                      <td>
                        {liveState?.fullState?.hostname ?? metadata?.name ?? panel.name ?? "—"}
                      </td>
                      <td>
                        {liveState?.connectionStatus === "connected" ? (
                          <span className={styles.statusLive}>● LIVE</span>
                        ) : (
                          <span className={styles.statusPanel}>● Panel</span>
                        )}
                      </td>
                      <td>
                        {liveState?.fullState?.version ? (
                          <span className={
                            highestVersion && compareVersions(liveState.fullState.version, highestVersion) === 0
                              ? styles.versionLatest
                              : styles.versionOutdated
                          }>
                            {liveState.fullState.version}
                          </span>
                        ) : (
                          <span className={styles.versionUnknown}>...</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.batchView}>
      <button type="button" className={styles.backButton} onClick={onBack}>
        ⬅️ Back to Discovery
      </button>
      
      <div className={styles.batchHeader}>
        <h2>Batch Operations <span className={styles.batchCount}>(batching {count} {count === 1 ? "panel" : "panels"})</span></h2>
        <p className={`${styles.batchProgress} ${hasAnyStatus ? "" : styles.batchProgressHidden}`}>
          {stats.inProgress > 0 && <span className={styles.progressInProgress}>⏳ {stats.inProgress} in progress</span>}
          {stats.success > 0 && <span className={styles.progressSuccess}>✓ {stats.success} succeeded</span>}
          {stats.failed > 0 && <span className={styles.progressFailed}>✗ {stats.failed} failed</span>}
          {!hasAnyStatus && <span className={styles.progressPlaceholder}>&nbsp;</span>}
        </p>
      </div>

      {/* Batch operation controls - two sections */}
      <div className={styles.batchControlsSections}>
        {/* Direct Operations */}
        <div className={styles.batchControlsSection}>
          <div className={styles.batchSectionHeader}>
            <h3>Direct Operations</h3>
            <span className={styles.batchSectionHint}>Native panel commands</span>
          </div>
          <div className={styles.batchControlsArea}>
            <div className={styles.batchControlsRow}>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(getDirectOp("toggle-backlight"))}
                disabled={isRunning || count === 0}
                title={getDirectOp("toggle-backlight").tooltip}
              >
                💡 Toggle Backlight
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(getDirectOp("toggle-all"))}
                disabled={isRunning || count === 0}
                title={getDirectOp("toggle-all").tooltip}
              >
                🔄 Toggle All
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlDanger}`}
                onClick={() => handleOperationClick(getDirectOp("scenes-all-off"))}
                disabled={isRunning || count === 0}
              >
                🚫 Scenes All Off
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlDanger}`}
                onClick={() => handleOperationClick(getDirectOp("restart"))}
                disabled={isRunning || count === 0}
              >
                🔃 Restart
              </button>
              <span className={styles.buttonGroupSpacer}></span>
              <button
                type="button"
                className={`${styles.batchControlButton} ${styles.batchControlWarning}`}
                onClick={() => {
                  setPanelStatuses(new Map());
                  setSubView("firmware-update");
                }}
                disabled={isRunning || count === 0}
              >
                ⬆️ Firmware Update
              </button>
            </div>
          </div>
        </div>

        {/* Virtual Operations */}
        <div className={styles.batchControlsSection}>
          <div className={styles.batchSectionHeader}>
            <h3>Virtual Operations</h3>
            <span className={styles.batchSectionHint}>Composed commands</span>
          </div>
          <div className={styles.batchControlsArea}>
            <div className={styles.batchControlsRow}>
              {/* Backlight group */}
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-backlight-on"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-backlight-on").tooltip}
                >
                  💡 Backlight On
                </button>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-backlight-off"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-backlight-off").tooltip}
                >
                  🔅 Backlight Off
                </button>
              </div>
              <span className={styles.buttonGroupSpacer}></span>
              {/* All Lights group */}
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-all-lights-on"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-all-lights-on").tooltip}
                >
                  🌟 Lights On
                </button>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getVirtualOp("virtual-all-lights-off"))}
                  disabled={isRunning || count === 0}
                  title={getVirtualOp("virtual-all-lights-off").tooltip}
                >
                  🌑 Lights Off
                </button>
              </div>
              <span className={styles.buttonGroupSpacer}></span>
              {/* All Switches Off (standalone) */}
              <button
                type="button"
                className={styles.batchControlButton}
                onClick={() => handleOperationClick(getVirtualOp("virtual-all-switches-off"))}
                disabled={isRunning || count === 0}
                title={getVirtualOp("virtual-all-switches-off").tooltip}
              >
                ⭕ All Switches Off
              </button>
            </div>
          </div>
        </div>

        {/* Settings Operations */}
        <div className={styles.batchControlsSection}>
          <div className={styles.batchSectionHeader}>
            <h3>Settings</h3>
            <span className={styles.batchSectionHint}>HTTP-based configuration</span>
          </div>
          <div className={styles.batchControlsArea}>
            <div className={styles.batchControlsRow}>
              {/* Logging group */}
              <div className={styles.buttonGroup}>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getSettingsOp("set-logging-on"))}
                  disabled={isRunning || count === 0}
                  title={getSettingsOp("set-logging-on").tooltip}
                >
                  📝 Log On
                </button>
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getSettingsOp("set-logging-off"))}
                  disabled={isRunning || count === 0}
                  title={getSettingsOp("set-logging-off").tooltip}
                >
                  📄 Log Off
                </button>
              </div>
              <span className={styles.buttonGroupSpacer}></span>
              {/* Long press group */}
              <div className={styles.settingsInputGroup}>
                <input
                  type="number"
                  className={styles.settingsInput}
                  value={longPressInput}
                  onChange={(e) => setLongPressInput(e.target.value)}
                  min="100"
                  max="5000"
                  step="100"
                  placeholder="ms"
                  disabled={isRunning}
                />
                <button
                  type="button"
                  className={styles.batchControlButton}
                  onClick={() => handleOperationClick(getSettingsOp("set-longpress"), parseInt(longPressInput, 10))}
                  disabled={isRunning || count === 0 || !longPressInput || parseInt(longPressInput, 10) < 100}
                  title={getSettingsOp("set-longpress").tooltip}
                >
                  ⏱️ Set Long Press
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Re-run on failed button - always reserve space */}
      <div className={styles.rerunSection}>
        {hasFailures && !isRunning && lastOperation ? (
          <button
            type="button"
            className={styles.rerunButton}
            onClick={handleRerunFailed}
            title={`Re-run "${lastOperation.label}" on ${stats.failed} failed panel${stats.failed > 1 ? 's' : ''}`}
          >
            🔁 Re-run on failed panels ({stats.failed})
          </button>
        ) : (
          <div className={styles.rerunPlaceholder}></div>
        )}
      </div>

      {/* Selected panels table */}
      {count === 0 ? (
        <div className={styles.emptyBatchState}>
          No panels selected. Go back and select panels to perform batch operations.
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkboxHeader}></th>
                <th className={styles.statusHeader}>Status</th>
                <th>IP</th>
                <th>Name</th>
                <th>Connection</th>
                <th>FW Version</th>
                <th>Signal</th>
                <th>Backlight</th>
                <th>Logging</th>
                <th>LongPress</th>
                <th>Live State</th>
              </tr>
            </thead>
            <tbody>
              {selectedPanels.map((panel) => {
                const metadata = panelInfoMap[panel.ip];
                const liveState = livePanelStates?.get(panel.ip);
                const batchStatus = panelStatuses.get(panel.ip) ?? "idle";
                const rowStatusClass = batchStatus === "success" 
                  ? styles.batchRowSuccess 
                  : batchStatus === "failed" 
                    ? styles.batchRowFailed 
                    : batchStatus === "in-progress"
                      ? styles.batchRowInProgress
                      : "";

                return (
                  <tr key={panel.ip} className={`${styles.selectedRow} ${rowStatusClass}`}>
                    <td className={styles.checkboxCell}>
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => handleRemovePanel(panel.ip)}
                        className={styles.rowCheckbox}
                        title="Uncheck to remove from batch"
                        disabled={isRunning}
                      />
                    </td>
                    <td className={styles.batchStatusCell}>
                      {getStatusIcon(panel.ip)}
                    </td>
                    <td>
                      <a
                        href={`http://${panel.ip}/`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.panelLink}
                      >
                        {panel.ip}
                      </a>
                    </td>
                    <td>
                      {liveState?.fullState?.hostname ?? metadata?.name ?? panel.name ?? "—"}
                    </td>
                    <td>
                      {liveState?.connectionStatus === "connected" ? (
                        <span className={styles.statusLive}>● LIVE</span>
                      ) : (
                        <span className={styles.statusPanel}>● Panel</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.version ? (
                        <span className={
                          highestVersion && compareVersions(liveState.fullState.version, highestVersion) === 0
                            ? styles.versionLatest
                            : styles.versionOutdated
                        }>
                          {liveState.fullState.version}
                        </span>
                      ) : (
                        <span className={styles.versionUnknown}>...</span>
                      )}
                    </td>
                    <td>
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
                      ) : (
                        <span className={styles.signalUnknown}>...</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState?.statusLedOn != null ? (
                        <span className={
                          liveState.fullState.statusLedOn
                            ? styles.backlightOnIndicator
                            : styles.backlightOffIndicator
                        }>
                          {liveState.fullState.statusLedOn ? "On" : "Off"}
                        </span>
                      ) : (
                        <span className={styles.backlightUnknown}>...</span>
                      )}
                    </td>
                    <td>
                      {panel.settings?.logging !== undefined ? (
                        <span className={
                          panel.settings.logging === mostCommonLogging
                            ? styles.settingCommon
                            : styles.settingDifferent
                        }>
                          {panel.settings.logging ? "On" : "Off"}
                        </span>
                      ) : (
                        <span className={styles.settingUnknown}>—</span>
                      )}
                    </td>
                    <td>
                      {panel.settings?.longPressMs !== undefined ? (
                        <span className={
                          panel.settings.longPressMs === mostCommonLongPress
                            ? styles.settingCommon
                            : styles.settingDifferent
                        }>
                          {panel.settings.longPressMs}
                        </span>
                      ) : (
                        <span className={styles.settingUnknown}>—</span>
                      )}
                    </td>
                    <td>
                      {liveState?.fullState ? (
                        (() => {
                          const configuredRelays = liveState.fullState.relays?.filter(isConfiguredRelay) ?? [];
                          const doorRelays = configuredRelays.filter(isDoorRelay);
                          const lightRelays = configuredRelays.filter(r => !isDoorRelay(r));
                          const curtainCount = liveState.fullState.curtains?.filter(
                            c => c.name && !/^Curtain\s+\d+$/i.test(c.name.trim())
                          ).length ?? 0;
                          const lightsOnCount = lightRelays.filter(r => r.state).length;
                          const doorsOnCount = doorRelays.filter(r => r.state).length;

                          if (lightRelays.length === 0 && doorRelays.length === 0 && curtainCount === 0) {
                            return <span style={{ color: "var(--muted)" }}>—</span>;
                          }

                          return (
                            <span className={styles.liveStateSummary}>
                              {lightRelays.length > 0 && (
                                <span className={styles.lightsSummary}>
                                  💡 {lightsOnCount}/{lightRelays.length}
                                </span>
                              )}
                              {doorRelays.length > 0 && (
                                <span className={styles.doorsSummary}>
                                  🚪 {doorsOnCount}/{doorRelays.length}
                                </span>
                              )}
                              {curtainCount > 0 && (
                                <span className={styles.shadesSummary}>
                                  🪟 {curtainCount}
                                </span>
                              )}
                            </span>
                          );
                        })()
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
                          Connecting...
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
