/**
 * Server-side Action Executor
 * 
 * Manages execution of multi-stage SmartActions entirely on the server.
 * This allows actions to complete even if the browser is closed.
 */

import { getPanelRegistry } from '../discovery/panel-registry';
import type { PanelCommand, CurtainState } from '../discovery/types';
import type {
  SmartAction,
  StageAction,
  ActionExecutionProgress,
  ActionExecutionState,
} from '../types/smart-actions';

// =============================================================================
// Types
// =============================================================================

interface RunningAction {
  /** Unique execution ID */
  id: string;
  /** Profile ID that started this action */
  profileId: number;
  /** The action definition */
  action: SmartAction;
  /** Current execution state */
  state: ActionExecutionState;
  /** Current stage index */
  currentStage: number;
  /** Whether waiting for scheduling */
  isWaiting: boolean;
  /** Type of wait if waiting */
  waitType?: 'delay' | 'curtains';
  /** Remaining delay in ms */
  remainingDelayMs?: number;
  /** When execution started */
  startedAt: number;
  /** When execution completed */
  completedAt?: number;
  /** Error message if failed */
  error?: string;
  /** Timer for delays */
  delayTimer?: ReturnType<typeof setTimeout>;
  /** Timer for curtain polling */
  pollTimer?: ReturnType<typeof setTimeout>;
  /** Interval for delay countdown updates */
  countdownInterval?: ReturnType<typeof setInterval>;
  /** Actions from current stage (for stopping curtains) */
  currentStageActions: StageAction[];
  /** Abort flag */
  aborted: boolean;
}

type ProgressListener = (progress: ActionExecutionProgress) => void;

// =============================================================================
// Action Executor Implementation
// =============================================================================

class ActionExecutorImpl {
  /** Currently running actions by execution ID */
  private runningActions: Map<string, RunningAction> = new Map();
  
  /** Progress listeners by execution ID */
  private progressListeners: Map<string, Set<ProgressListener>> = new Map();
  
  /** Counter for generating unique IDs */
  private idCounter = 0;
  
  /**
   * Start executing a SmartAction
   * @returns Execution ID to track progress
   */
  async startAction(profileId: number, action: SmartAction): Promise<string> {
    // Generate unique execution ID
    const executionId = `action_${Date.now()}_${++this.idCounter}`;
    
    console.log(`[ActionExecutor] Starting action "${action.name}" (${executionId})`);
    
    // Create running action record
    const running: RunningAction = {
      id: executionId,
      profileId,
      action,
      state: 'running',
      currentStage: 0,
      isWaiting: false,
      startedAt: Date.now(),
      currentStageActions: [],
      aborted: false,
    };
    
    this.runningActions.set(executionId, running);
    
    // Broadcast initial progress
    this.broadcastProgress(running);
    
    // Start execution loop (don't await - let it run in background)
    this.executeActionLoop(executionId).catch(error => {
      console.error(`[ActionExecutor] Unhandled error in action loop:`, error);
      const r = this.runningActions.get(executionId);
      if (r) {
        r.state = 'failed';
        r.error = (error as Error).message;
        r.completedAt = Date.now();
        this.broadcastProgress(r);
      }
    });
    
    return executionId;
  }
  
  /**
   * Stop a running action
   * @param stopCurtains If true, also send stop commands to any curtains in progress
   */
  async stopAction(executionId: string, stopCurtains = true): Promise<boolean> {
    const running = this.runningActions.get(executionId);
    if (!running) {
      console.log(`[ActionExecutor] Action not found: ${executionId}`);
      return false;
    }
    
    console.log(`[ActionExecutor] Stopping action "${running.action.name}" (${executionId})`);
    
    // Set abort flag
    running.aborted = true;
    
    // Clear any pending timers
    if (running.delayTimer) {
      clearTimeout(running.delayTimer);
      running.delayTimer = undefined;
    }
    if (running.pollTimer) {
      clearTimeout(running.pollTimer);
      running.pollTimer = undefined;
    }
    if (running.countdownInterval) {
      clearInterval(running.countdownInterval);
      running.countdownInterval = undefined;
    }
    
    // Stop curtains if requested
    if (stopCurtains && running.currentStageActions.length > 0) {
      await this.stopCurtainsInActions(running.currentStageActions);
    }
    
    // Update state
    running.state = 'stopped';
    running.completedAt = Date.now();
    this.broadcastProgress(running);
    
    // Clean up after a delay
    setTimeout(() => {
      this.runningActions.delete(executionId);
      this.progressListeners.delete(executionId);
    }, 5000);
    
    return true;
  }
  
  /**
   * Get current progress of an action
   */
  getProgress(executionId: string): ActionExecutionProgress | null {
    const running = this.runningActions.get(executionId);
    if (!running) return null;
    return this.buildProgress(running);
  }
  
  /**
   * Get all running actions
   */
  getAllRunningActions(): ActionExecutionProgress[] {
    return Array.from(this.runningActions.values()).map(r => this.buildProgress(r));
  }
  
  /**
   * Subscribe to progress updates for an action
   */
  addProgressListener(executionId: string, listener: ProgressListener): void {
    let listeners = this.progressListeners.get(executionId);
    if (!listeners) {
      listeners = new Set();
      this.progressListeners.set(executionId, listeners);
    }
    listeners.add(listener);
    
    // Immediately send current progress
    const running = this.runningActions.get(executionId);
    if (running) {
      listener(this.buildProgress(running));
    }
  }
  
  /**
   * Unsubscribe from progress updates
   */
  removeProgressListener(executionId: string, listener: ProgressListener): void {
    const listeners = this.progressListeners.get(executionId);
    if (listeners) {
      listeners.delete(listener);
    }
  }
  
  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------
  
  private async executeActionLoop(executionId: string): Promise<void> {
    const running = this.runningActions.get(executionId);
    if (!running) return;
    
    const { action } = running;
    
    try {
      for (let stageIdx = 0; stageIdx < action.stages.length; stageIdx++) {
        // Check for abort
        if (running.aborted) {
          console.log(`[ActionExecutor] Action aborted at stage ${stageIdx}`);
          break;
        }
        
        const stage = action.stages[stageIdx];
        console.log(`[ActionExecutor] Executing stage ${stageIdx + 1}/${action.stages.length}:`,
          stage.actions.map(a => `${a.switchId} → ${a.action}`).join(', '));
        
        // Update state
        running.currentStage = stageIdx;
        running.isWaiting = false;
        running.currentStageActions = stage.actions;
        this.broadcastProgress(running);
        
        // Execute all actions in this stage concurrently
        await Promise.all(stage.actions.map(a => this.executeSingleAction(a)));
        
        // Check for abort after stage execution
        if (running.aborted) {
          console.log(`[ActionExecutor] Action aborted after stage ${stageIdx}`);
          break;
        }
        
        // Wait for scheduling if not the last stage
        if (stageIdx < action.stages.length - 1 && action.scheduling[stageIdx]) {
          const sched = action.scheduling[stageIdx];
          
          if (sched.type === 'delay' && sched.delayMs && sched.delayMs > 0) {
            // Delay scheduling
            console.log(`[ActionExecutor] Waiting ${sched.delayMs}ms...`);
            await this.waitDelay(running, sched.delayMs);
          } else if (sched.type === 'waitForCurtains') {
            // Wait for curtains to finish
            console.log(`[ActionExecutor] Waiting for curtains to stop...`);
            await this.waitForCurtains(running, stage.actions);
          }
        }
      }
      
      // Completed
      if (!running.aborted) {
        console.log(`[ActionExecutor] Action completed: "${action.name}"`);
        running.state = 'completed';
        running.currentStage = action.stages.length;
        running.isWaiting = false;
        running.completedAt = Date.now();
        this.broadcastProgress(running);
      }
      
    } catch (error) {
      console.error(`[ActionExecutor] Action error:`, error);
      running.state = 'failed';
      running.error = (error as Error).message;
      running.completedAt = Date.now();
      this.broadcastProgress(running);
    }
    
    // Clean up after completion (keep around briefly for status queries)
    setTimeout(() => {
      this.runningActions.delete(executionId);
      this.progressListeners.delete(executionId);
    }, 30000); // Keep for 30 seconds after completion
  }
  
  private async executeSingleAction(action: StageAction): Promise<boolean> {
    const [ip, type, indexStr] = action.switchId.split(':');
    const index = parseInt(indexStr, 10);
    
    const registry = getPanelRegistry();
    let command: PanelCommand;
    
    if (type === 'light') {
      // Relay action
      switch (action.action) {
        case 'on':
          command = { command: 'set_relay', index, state: true };
          break;
        case 'off':
          command = { command: 'set_relay', index, state: false };
          break;
        case 'toggle':
          command = { command: 'toggle_relay', index };
          break;
        default:
          console.warn(`[ActionExecutor] Invalid action for light: ${action.action}`);
          return false;
      }
    } else if (type === 'shade' || type === 'venetian') {
      // Curtain action
      const curtainAction = action.action as 'open' | 'close' | 'stop';
      if (!['open', 'close', 'stop'].includes(curtainAction)) {
        console.warn(`[ActionExecutor] Invalid action for curtain: ${action.action}`);
        return false;
      }
      command = { command: 'curtain', index, action: curtainAction };
    } else {
      console.warn(`[ActionExecutor] Unknown switch type: ${type}`);
      return false;
    }
    
    const success = registry.sendCommand(ip, command);
    if (!success) {
      console.warn(`[ActionExecutor] Failed to send command to ${ip}`);
    }
    return success;
  }
  
  private async waitDelay(running: RunningAction, delayMs: number): Promise<void> {
    running.isWaiting = true;
    running.waitType = 'delay';
    running.remainingDelayMs = delayMs;
    this.broadcastProgress(running);
    
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      // Update countdown every 100ms
      running.countdownInterval = setInterval(() => {
        if (running.aborted) {
          if (running.countdownInterval) clearInterval(running.countdownInterval);
          resolve();
          return;
        }
        
        const elapsed = Date.now() - startTime;
        running.remainingDelayMs = Math.max(0, delayMs - elapsed);
        this.broadcastProgress(running);
      }, 100);
      
      // Set timer for completion
      running.delayTimer = setTimeout(() => {
        if (running.countdownInterval) {
          clearInterval(running.countdownInterval);
          running.countdownInterval = undefined;
        }
        running.isWaiting = false;
        running.remainingDelayMs = undefined;
        running.waitType = undefined;
        resolve();
      }, delayMs);
    });
  }
  
  private async waitForCurtains(running: RunningAction, stageActions: StageAction[]): Promise<void> {
    running.isWaiting = true;
    running.waitType = 'curtains';
    running.remainingDelayMs = undefined;
    this.broadcastProgress(running);
    
    const maxWait = 300000; // 5 minutes max
    const pollInterval = 500; // Check every 500ms
    const startTime = Date.now();
    
    // Small initial delay to let curtain state update
    await new Promise(r => setTimeout(r, 1000));
    
    return new Promise((resolve) => {
      const checkCurtains = () => {
        if (running.aborted) {
          console.log(`[ActionExecutor] Aborted while waiting for curtains`);
          resolve();
          return;
        }
        
        const elapsed = Date.now() - startTime;
        const stillMoving = this.areCurtainsStillMoving(stageActions);
        
        console.log(`[ActionExecutor] Checking curtains: stillMoving=${stillMoving}, elapsed=${elapsed}ms`);
        
        if (elapsed >= maxWait) {
          console.log(`[ActionExecutor] Max wait time reached, continuing action`);
          running.isWaiting = false;
          running.waitType = undefined;
          resolve();
        } else if (!stillMoving) {
          console.log(`[ActionExecutor] Curtains stopped, continuing action`);
          running.isWaiting = false;
          running.waitType = undefined;
          resolve();
        } else {
          running.pollTimer = setTimeout(checkCurtains, pollInterval);
        }
      };
      
      checkCurtains();
    });
  }
  
  private areCurtainsStillMoving(actions: StageAction[]): boolean {
    const registry = getPanelRegistry();
    
    for (const action of actions) {
      const [ip, type, indexStr] = action.switchId.split(':');
      if (type === 'shade' || type === 'venetian') {
        const index = parseInt(indexStr, 10);
        const panelState = registry.getPanelState(ip);
        const curtain = panelState?.fullState?.curtains?.find(
          (c: CurtainState) => c.index === index
        );
        if (curtain?.state === 'opening' || curtain?.state === 'closing') {
          return true;
        }
      }
    }
    return false;
  }
  
  private async stopCurtainsInActions(actions: StageAction[]): Promise<void> {
    const registry = getPanelRegistry();
    const stopPromises: Promise<void>[] = [];
    
    for (const action of actions) {
      const [ip, type, indexStr] = action.switchId.split(':');
      if (type === 'shade' || type === 'venetian') {
        const index = parseInt(indexStr, 10);
        console.log(`[ActionExecutor] Sending stop to ${action.switchId}`);
        stopPromises.push(
          new Promise((resolve) => {
            registry.sendCommand(ip, { command: 'curtain', index, action: 'stop' });
            resolve();
          })
        );
      }
    }
    
    // Wait for all stop commands (max 2 seconds)
    if (stopPromises.length > 0) {
      await Promise.race([
        Promise.all(stopPromises),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    }
  }
  
  private buildProgress(running: RunningAction): ActionExecutionProgress {
    return {
      executionId: running.id,
      actionName: running.action.name,
      state: running.state,
      totalStages: running.action.stages.length,
      currentStage: running.currentStage,
      isWaiting: running.isWaiting,
      waitType: running.waitType,
      remainingDelayMs: running.remainingDelayMs,
      startedAt: running.startedAt,
      completedAt: running.completedAt,
      error: running.error,
    };
  }
  
  private broadcastProgress(running: RunningAction): void {
    const progress = this.buildProgress(running);
    const listeners = this.progressListeners.get(running.id);
    
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(progress);
        } catch (error) {
          console.error(`[ActionExecutor] Error in progress listener:`, error);
        }
      }
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const EXECUTOR_KEY = Symbol.for('smart_home_action_executor');

interface GlobalWithExecutor {
  [EXECUTOR_KEY]?: ActionExecutorImpl;
}

/** Get the global action executor instance */
export function getActionExecutor(): ActionExecutorImpl {
  const globalObj = globalThis as GlobalWithExecutor;
  if (!globalObj[EXECUTOR_KEY]) {
    console.log('[ActionExecutor] Creating new global action executor instance');
    globalObj[EXECUTOR_KEY] = new ActionExecutorImpl();
  }
  return globalObj[EXECUTOR_KEY];
}

export type ActionExecutor = ActionExecutorImpl;
