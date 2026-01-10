import { NextRequest, NextResponse } from 'next/server';
import { getActionExecutor } from '@/lib/actions/action-executor';
import type { StartActionRequest, StartActionResponse } from '@/lib/types/smart-actions';

export const runtime = 'nodejs';

/**
 * POST /api/actions/run
 * 
 * Start executing a SmartAction on the server.
 * The action will continue running even if the client disconnects.
 * 
 * Request body: StartActionRequest
 * Response: StartActionResponse
 */
export async function POST(request: NextRequest) {
  let body: StartActionRequest;
  
  try {
    body = await request.json() as StartActionRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON in request body' } satisfies StartActionResponse,
      { status: 400 }
    );
  }
  
  // Validate request
  if (!body.action) {
    return NextResponse.json(
      { success: false, error: 'Missing action in request body' } satisfies StartActionResponse,
      { status: 400 }
    );
  }
  
  if (!body.action.name || !Array.isArray(body.action.stages)) {
    return NextResponse.json(
      { success: false, error: 'Invalid action format: must have name and stages' } satisfies StartActionResponse,
      { status: 400 }
    );
  }
  
  if (body.action.stages.length === 0) {
    return NextResponse.json(
      { success: false, error: 'Action must have at least one stage' } satisfies StartActionResponse,
      { status: 400 }
    );
  }
  
  const profileId = body.profileId ?? 0;
  
  console.log(`[API] Starting action "${body.action.name}" for profile ${profileId}`);
  
  try {
    const executor = getActionExecutor();
    const executionId = await executor.startAction(profileId, body.action);
    
    return NextResponse.json({
      success: true,
      executionId,
    } satisfies StartActionResponse);
    
  } catch (error) {
    console.error('[API] Error starting action:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message } satisfies StartActionResponse,
      { status: 500 }
    );
  }
}

/**
 * GET /api/actions/run
 * 
 * Get all currently running actions
 */
export async function GET() {
  const executor = getActionExecutor();
  const runningActions = executor.getAllRunningActions();
  
  return NextResponse.json({
    actions: runningActions,
    count: runningActions.length,
  });
}
