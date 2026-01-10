/**
 * Shared types for Smart Actions
 * Used by both client and server for action execution
 */

// =============================================================================
// Action Definition Types
// =============================================================================

/**
 * Type of favorite item: light (relay), shade (curtain), or venetian
 */
export type FavoriteType = 'light' | 'shade' | 'venetian';

/**
 * Action type for a switch in an action stage
 */
export type StageActionType = 'on' | 'off' | 'toggle' | 'open' | 'close' | 'stop';

/**
 * Scheduling type between stages
 */
export type SchedulingType = 'delay' | 'waitForCurtains';

/**
 * A single switch action within an action stage
 */
export interface StageAction {
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform */
  action: StageActionType;
}

/**
 * A stage in a smart action - one or more switch actions executed simultaneously
 */
export interface ActionStage {
  /** Actions to execute in this stage (all run in parallel) */
  actions: StageAction[];
}

/**
 * Scheduling configuration between action stages
 */
export interface ActionScheduling {
  /** Type of scheduling: fixed delay or wait for curtains to finish */
  type: SchedulingType;
  /** Delay in milliseconds (only used when type is 'delay') */
  delayMs?: number;
}

/**
 * A single step in a smart action sequence (legacy format - for backward compatibility)
 */
export interface ActionStep {
  /** ID of the switch to control (format: "ip:type:index") */
  switchId: string;
  /** Action to perform: "on", "off", "toggle", "open", "close", "stop" */
  action: StageActionType;
  /** Delay in milliseconds before executing this step */
  delayMs: number;
}

/**
 * A smart action - a user-programmed sequence with stages and scheduling.
 * New format: stages[] with scheduling[] between them
 */
export interface SmartAction {
  /** Display name for this smart action */
  name: string;
  /** Action stages - each contains 1+ switch actions executed together */
  stages: ActionStage[];
  /** Scheduling between stages - scheduling[i] is between stages[i] and stages[i+1] */
  scheduling: ActionScheduling[];
  /** Legacy steps format (for backward compatibility) - deprecated */
  steps?: ActionStep[];
}

// =============================================================================
// Action Execution Types
// =============================================================================

/**
 * Action execution state
 */
export type ActionExecutionState = 'idle' | 'running' | 'waiting' | 'stopped' | 'completed' | 'failed';

/**
 * Current action execution progress (shared between client and server)
 */
export interface ActionExecutionProgress {
  /** Unique ID for this execution */
  executionId: string;
  /** Name of the action being executed */
  actionName: string;
  /** Current execution state */
  state: ActionExecutionState;
  /** Total number of stages */
  totalStages: number;
  /** Currently executing stage index (0-based, -1 if not started) */
  currentStage: number;
  /** Whether waiting for scheduling (delay/curtains) */
  isWaiting: boolean;
  /** Type of wait if waiting */
  waitType?: 'delay' | 'curtains';
  /** Remaining delay time in ms (if waiting on delay) */
  remainingDelayMs?: number;
  /** Started at timestamp (ms since epoch) */
  startedAt: number;
  /** Completed at timestamp (ms since epoch) */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Request to start an action execution
 */
export interface StartActionRequest {
  /** Profile ID (for context/logging) */
  profileId: number;
  /** The action to execute */
  action: SmartAction;
}

/**
 * Response from starting an action
 */
export interface StartActionResponse {
  /** Whether the action was started successfully */
  success: boolean;
  /** Execution ID (use this to track progress or stop) */
  executionId?: string;
  /** Error message if failed to start */
  error?: string;
}

/**
 * Response from stopping an action
 */
export interface StopActionResponse {
  /** Whether the stop was successful */
  success: boolean;
  /** Whether curtains were also stopped */
  curtainsStopped?: boolean;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Smart Switches Data Types
// =============================================================================

/**
 * Smart switches data structure with groups.
 * Stored in profile.smart_switches.groups
 */
export interface SmartSwitchesData {
  groups: Record<string, SmartAction[]>;
}
