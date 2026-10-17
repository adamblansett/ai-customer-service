import dotenv from 'dotenv';
dotenv.config();

import { getDatabase } from '@customer-service/db';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT || 3001);

async function startServer() {
  try {
    const db = await getDatabase();
    const app = createApp(db);

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`[API Server] Running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    });

    const shutdown = async () => {
      console.log('[API Server] Gracefully shutting down...');
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
