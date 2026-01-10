import { NextRequest } from 'next/server';
import { getActionExecutor } from '@/lib/actions/action-executor';
import type { ActionExecutionProgress } from '@/lib/types/smart-actions';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/actions/:id/stream
 * 
 * SSE endpoint for real-time progress updates on a running action.
 * Streams ActionExecutionProgress events as the action executes.
 * 
 * Events:
 *   - progress: ActionExecutionProgress object
 *   - error: Error message if something goes wrong
 *   - complete: Sent when action completes (includes final progress)
 */
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
) {
  const { id } = await params;
  
  const executor = getActionExecutor();
  
  // Check if action exists
  const initialProgress = executor.getProgress(id);
  if (!initialProgress) {
    return new Response(
      JSON.stringify({ error: 'Action not found', executionId: id }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
  
  // Create SSE stream
  const encoder = new TextEncoder();
  let listenerCleanedUp = false;
  
  const stream = new ReadableStream({
    start(controller) {
      // Helper to send SSE events
      const sendEvent = (event: string, data: unknown) => {
        try {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        } catch {
          // Stream might be closed
        }
      };
      
      // Progress listener
      const onProgress = (progress: ActionExecutionProgress) => {
        sendEvent('progress', progress);
        
        // If action completed/stopped/failed, send complete event and close
        if (progress.state === 'completed' || 
            progress.state === 'stopped' || 
            progress.state === 'failed') {
          sendEvent('complete', progress);
          cleanup();
        }
      };
      
      const cleanup = () => {
        if (!listenerCleanedUp) {
          listenerCleanedUp = true;
          executor.removeProgressListener(id, onProgress);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };
      
      // Register listener
      executor.addProgressListener(id, onProgress);
      
      // Send heartbeat every 15 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          sendEvent('heartbeat', { timestamp: Date.now() });
        } catch {
          clearInterval(heartbeatInterval);
          cleanup();
        }
      }, 15000);
      
      // Cleanup on stream cancellation
      return () => {
        clearInterval(heartbeatInterval);
        cleanup();
      };
    },
    
    cancel() {
      // Stream was cancelled by client
      if (!listenerCleanedUp) {
        listenerCleanedUp = true;
        executor.removeProgressListener(id, () => {});
      }
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
