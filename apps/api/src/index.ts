import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getDatabase } from '@customer-service/db';
import { MediaStreamGateway, type ParticipantRole, type SupervisorMode } from '@customer-service/core';
import { createApp } from './app.js';
import { sharedAudioBridgeManager } from './routes/calls.js';

const PORT = Number(process.env.PORT || 3001);

async function startServer() {
  try {
    const db = await getDatabase();
    const app = createApp(db);
    const server = createServer(app);

    // 1. WebSocket server for carrier media streams (/api/v1/voice/stream)
    const mediaWss = new WebSocketServer({ noServer: true });
    const gateway = new MediaStreamGateway();

    mediaWss.on('connection', (ws) => {
      const socketAdapter = {
        send: (data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        },
        close: (code?: number, reason?: string) => ws.close(code, reason),
      };

      ws.on('message', (message) => {
        gateway.handleMessage(socketAdapter, message.toString());
      });
    });

    // 2. WebSocket server for live supervisor coaching & WebRTC audio bridge (/api/v1/voice/coaching)
    const coachingWss = new WebSocketServer({ noServer: true });
    const bridgeSockets = new Map<string, Map<string, WebSocket>>();

    coachingWss.on('connection', (ws, request) => {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      const bridgeId = url.searchParams.get('callSid') || 'default_call';
      const participantId = url.searchParams.get('participantId') || `part_${Date.now()}`;
      const role = (url.searchParams.get('role') as ParticipantRole) || 'supervisor';
      const mode = (url.searchParams.get('mode') as SupervisorMode) || 'silent_monitor';

      sharedAudioBridgeManager.joinParticipant(bridgeId, participantId, role, mode);

      if (!bridgeSockets.has(bridgeId)) {
        bridgeSockets.set(bridgeId, new Map());
      }
      bridgeSockets.get(bridgeId)!.set(participantId, ws);

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'set_mode' && parsed.mode) {
            sharedAudioBridgeManager.setSupervisorMode(bridgeId, participantId, parsed.mode);
            ws.send(JSON.stringify({ type: 'mode_updated', mode: parsed.mode }));
            return;
          }
          if (parsed.type === 'audio' && parsed.payload) {
            const routed = sharedAudioBridgeManager.routeAudioFrame(
              bridgeId,
              participantId,
              parsed.payload
            );
            const peers = bridgeSockets.get(bridgeId);
            if (peers) {
              for (const [recipientId, audioPayload] of routed.entries()) {
                const peerWs = peers.get(recipientId);
                if (peerWs && peerWs.readyState === WebSocket.OPEN) {
                  peerWs.send(
                    JSON.stringify({
                      type: 'audio',
                      from: participantId,
                      role,
                      payload: audioPayload,
                    })
                  );
                }
              }
            }
          }
        } catch {
          // Ignore malformed frames
        }
      });

      ws.on('close', () => {
        sharedAudioBridgeManager.leaveParticipant(bridgeId, participantId);
        bridgeSockets.get(bridgeId)?.delete(participantId);
      });
    });

    // Route HTTP Upgrade requests to the matching WebSocket server
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`).pathname;

      if (pathname === '/api/v1/voice/stream') {
        mediaWss.handleUpgrade(request, socket, head, (ws) => {
          mediaWss.emit('connection', ws, request);
        });
      } else if (pathname === '/api/v1/voice/coaching') {
        coachingWss.handleUpgrade(request, socket, head, (ws) => {
          coachingWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[API Server] Running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      console.log(`[API Server] WebSocket Media Streams enabled at ws://0.0.0.0:${PORT}/api/v1/voice/stream`);
      console.log(`[API Server] WebSocket Supervisor Coaching Bridge enabled at ws://0.0.0.0:${PORT}/api/v1/voice/coaching`);
    });

    const shutdown = async () => {
      console.log('[API Server] Gracefully shutting down...');
      gateway.closeAll();
      mediaWss.close();
      coachingWss.close();
      server.close(() => {
        console.log('[API Server] Closed HTTP listener.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('[API Server] Failed to start:', err);
    process.exit(1);
  }
}

startServer();
