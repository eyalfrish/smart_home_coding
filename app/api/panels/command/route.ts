import { NextRequest, NextResponse } from "next/server";
import { getPanelRegistry } from "@/lib/discovery/panel-registry";
import type { PanelCommand, PanelCommandType } from "@/lib/discovery/types";

export const runtime = "nodejs";

interface CommandRequest {
  /** Target panel IPs. If empty or "*", sends to all connected panels. */
  ips?: string[] | "*";
  /** The command to send */
  command: PanelCommandType;
  /** Optional index for relay/curtain/scene commands */
  index?: number;
  /** Optional state for set_relay, backlight, lock_buttons */
  state?: boolean;
  /** Optional action for curtain commands */
  action?: "open" | "close" | "stop";
}

interface CommandResult {
  ip: string;
  success: boolean;
}

interface CommandResponse {
  results: CommandResult[];
  totalSent: number;
  successCount: number;
}

const VALID_COMMANDS: PanelCommandType[] = [
  "request_state",
  "set_relay",
  "toggle_relay",
  "toggle_all",
  "curtain",
  "scene_activate",
  "all_off",
  "backlight",
  "lock_buttons",
  "restart",
  "update",
];

/**
 * POST /api/panels/command
 * 
 * Send a command to one or more panels.
 * 
 * Request body:
 * {
 *   "ips": ["10.88.99.201"] | "*",  // Target panels, "*" for all connected
 *   "command": "toggle_relay",       // Command type
 *   "index": 0,                      // Optional: relay/curtain/scene index
 *   "state": true,                   // Optional: for set_relay, backlight, lock_buttons
 *   "action": "open"                 // Optional: for curtain commands
 * }
 */
export async function POST(request: NextRequest) {
  let body: CommandRequest;

  try {
    body = (await request.json()) as CommandRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 }
    );
  }

  // Validate command
  if (!body.command || !VALID_COMMANDS.includes(body.command)) {
    return NextResponse.json(
      {
        error: `Invalid command. Must be one of: ${VALID_COMMANDS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Build the command payload
  const panelCommand: PanelCommand = {
    command: body.command,
  };

  if (body.index !== undefined) {
    panelCommand.index = body.index;
  }
  if (body.state !== undefined) {
    panelCommand.state = body.state;
  }
  if (body.action !== undefined) {
    panelCommand.action = body.action;
  }

  const registry = getPanelRegistry();

  // Determine target IPs
  let targetIps: string[];
  if (!body.ips || body.ips === "*") {
    targetIps = registry.getConnectedPanelIps();
  } else if (Array.isArray(body.ips)) {
    targetIps = body.ips;
  } else {
    return NextResponse.json(
      { error: "ips must be an array of IP addresses or '*'" },
      { status: 400 }
    );
  }

  if (targetIps.length === 0) {
    return NextResponse.json(
      { error: "No target panels available or connected" },
      { status: 400 }
    );
  }

  // Debug: log connected panels in registry
  const connectedIps = registry.getConnectedPanelIps();
  console.log(`[Command] Target IPs: ${targetIps.join(", ")}`);
  console.log(`[Command] Connected in registry: ${connectedIps.join(", ") || "(none)"}`);
  console.log(`[Command] Sending: ${JSON.stringify(panelCommand)}`);

  // Send the command
  const resultMap = registry.sendCommandToMany(targetIps, panelCommand);

  // Build response
  const results: CommandResult[] = [];
  let successCount = 0;

  Array.from(resultMap.entries()).forEach(([ip, success]) => {
    results.push({ ip, success });
    if (success) successCount++;
  });

  const response: CommandResponse = {
    results,
    totalSent: results.length,
    successCount,
  };

  return NextResponse.json(response);
}

