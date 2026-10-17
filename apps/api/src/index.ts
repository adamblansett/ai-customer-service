import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { getDatabase } from '@customer-service/db';
import { MediaStreamGateway } from '@customer-service/core';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3001);

async function startServer() {
  try {
    const db = await getDatabase();
    const app = createApp(db);
    const server = createServer(app);

    // Attach WebSocket server for real-time media streams
    const wss = new WebSocketServer({ server, path: '/api/v1/voice/stream' });
    const gateway = new MediaStreamGateway();

    wss.on('connection', (ws) => {
      const socketAdapter = {
        send: (data: string) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(data);
          }
        },
        close: (code?: number, reason?: string) => ws.close(code, reason),
      };

      ws.on('message', (message) => {
        gateway.handleMessage(socketAdapter, message.toString());
      });
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[API Server] Running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      console.log(`[API Server] WebSocket Media Streams enabled at ws://0.0.0.0:${PORT}/api/v1/voice/stream`);
    });

    const shutdown = async () => {
      console.log('[API Server] Gracefully shutting down...');
      gateway.closeAll();
      wss.close();
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
