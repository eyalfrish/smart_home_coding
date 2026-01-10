import { NextRequest, NextResponse } from 'next/server';
import { getActionExecutor } from '@/lib/actions/action-executor';
import type { StopActionResponse } from '@/lib/types/smart-actions';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/actions/:id
 * 
 * Get the current status/progress of a running action
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;
  
  const executor = getActionExecutor();
  const progress = executor.getProgress(id);
  
  if (!progress) {
    return NextResponse.json(
      { error: 'Action not found', executionId: id },
      { status: 404 }
    );
  }
  
  return NextResponse.json(progress);
}

/**
 * DELETE /api/actions/:id
 * 
 * Stop a running action
 * Query params:
 *   - stopCurtains: "true" or "false" (default: "true")
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;
  const url = new URL(request.url);
  const stopCurtains = url.searchParams.get('stopCurtains') !== 'false';
  
  console.log(`[API] Stopping action ${id} (stopCurtains=${stopCurtains})`);
  
  const executor = getActionExecutor();
  const success = await executor.stopAction(id, stopCurtains);
  
  if (!success) {
    return NextResponse.json(
      { success: false, error: 'Action not found or already completed' } satisfies StopActionResponse,
      { status: 404 }
    );
  }
  
  return NextResponse.json({
    success: true,
    curtainsStopped: stopCurtains,
  } satisfies StopActionResponse);
}
