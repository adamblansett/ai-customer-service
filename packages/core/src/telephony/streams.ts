import { EventEmitter } from 'node:events';

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type StreamProtocol = 'twilio' | 'freeswitch' | 'generic';

export interface StreamMediaFormat {
  encoding: 'audio/x-mulaw' | 'audio/x-alaw' | 'audio/l16' | 'opus';
  sampleRate: number;
  channels: number;
}

export interface TwilioStartPayload {
  streamSid: string;
  accountSid: string;
  callSid: string;
  tracks: string[];
  customParameters?: Record<string, string>;
  mediaFormat?: StreamMediaFormat;
}

export interface TwilioMediaPayload {
  track: string;
  chunk: string;
  timestamp: string;
  payload: string; // base64 encoded audio
}

export interface TwilioInboundMessage {
  event: 'connected' | 'start' | 'media' | 'stop' | 'mark';
  sequenceNumber?: string;
  protocol?: string;
  version?: string;
  streamSid?: string;
  start?: TwilioStartPayload;
  media?: TwilioMediaPayload;
  stop?: { accountSid: string; callSid: string };
  mark?: { name: string };
}

export interface TwilioOutboundMediaMessage {
  event: 'media';
  streamSid: string;
  media: {
    payload: string; // base64 encoded mulaw
  };
}

export interface TwilioOutboundClearMessage {
  event: 'clear';
  streamSid: string;
}

export interface TwilioOutboundMarkMessage {
  event: 'mark';
  streamSid: string;
  mark: {
    name: string;
  };
}

export type TwilioOutboundMessage =
  | TwilioOutboundMediaMessage
  | TwilioOutboundClearMessage
  | TwilioOutboundMarkMessage;

export interface StreamSessionConfig {
  streamSid: string;
  callSid: string;
  tenantId: string;
  protocol: StreamProtocol;
  socket: WebSocketLike;
  mediaFormat?: StreamMediaFormat;
  customParameters?: Record<string, string>;
}

export class MediaStreamSession extends EventEmitter {
  public readonly streamSid: string;
  public readonly callSid: string;
  public readonly tenantId: string;
  public readonly protocol: StreamProtocol;
  public readonly mediaFormat: StreamMediaFormat;
  public readonly customParameters: Record<string, string>;
  private socket: WebSocketLike;
  private isClosed: boolean = false;
  private isStreamingToCaller: boolean = false;
  private inboundChunkCount: number = 0;
  private outboundChunkCount: number = 0;

  constructor(config: StreamSessionConfig) {
    super();
    this.streamSid = config.streamSid;
    this.callSid = config.callSid;
    this.tenantId = config.tenantId;
    this.protocol = config.protocol;
    this.socket = config.socket;
    this.customParameters = config.customParameters || {};
    this.mediaFormat = config.mediaFormat || {
      encoding: 'audio/x-mulaw',
      sampleRate: 8000,
      channels: 1,
    };
  }

  /**
   * Dispatches audio to caller over the stream.
   * Encodes audio chunk into provider-specific JSON frame.
   */
  public sendAudio(base64Payload: string): void {
    if (this.isClosed) return;
    this.isStreamingToCaller = true;
    this.outboundChunkCount++;

    if (this.protocol === 'twilio') {
      const msg: TwilioOutboundMediaMessage = {
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: base64Payload },
      };
      this.socket.send(JSON.stringify(msg));
    } else {
      // FreeSWITCH / Generic JSON audio frame
      const msg = {
        event: 'media',
        streamSid: this.streamSid,
        callSid: this.callSid,
        payload: base64Payload,
      };
      this.socket.send(JSON.stringify(msg));
    }
  }

  /**
   * CRITICAL BARGE-IN INTERRUPT:
   * When caller speaks while AI is playing audio, clear the telephony provider's buffer immediately.
   */
  public interrupt(): void {
    if (this.isClosed) return;
    this.isStreamingToCaller = false;

    if (this.protocol === 'twilio') {
      const msg: TwilioOutboundClearMessage = {
        event: 'clear',
        streamSid: this.streamSid,
      };
      this.socket.send(JSON.stringify(msg));
    } else {
      const msg = {
        event: 'clear',
        streamSid: this.streamSid,
        callSid: this.callSid,
      };
      this.socket.send(JSON.stringify(msg));
    }

    this.emit('bargeIn', { streamSid: this.streamSid, callSid: this.callSid });
  }

  /**
   * Sends a tracking mark to detect when caller has heard a specific audio segment.
   */
  public sendMark(name: string): void {
    if (this.isClosed) return;
    if (this.protocol === 'twilio') {
      const msg: TwilioOutboundMarkMessage = {
        event: 'mark',
        streamSid: this.streamSid,
        mark: { name },
      };
      this.socket.send(JSON.stringify(msg));
    }
  }

  /**
   * Internal ingestion of inbound media chunk from caller.
   */
  public handleInboundMedia(payload: string, track: string = 'inbound'): void {
    if (this.isClosed) return;
    this.inboundChunkCount++;

    // If caller produces audio while we are actively streaming outbound audio to them,
    // trigger automatic barge-in detection!
    if (this.isStreamingToCaller && payload.length > 50) {
      this.interrupt();
    }

    this.emit('audio', {
      payload,
      track,
      streamSid: this.streamSid,
      callSid: this.callSid,
      chunkIndex: this.inboundChunkCount,
    });
  }

  public getStats() {
    return {
      streamSid: this.streamSid,
      callSid: this.callSid,
      tenantId: this.tenantId,
      inboundChunkCount: this.inboundChunkCount,
      outboundChunkCount: this.outboundChunkCount,
      isStreamingToCaller: this.isStreamingToCaller,
      isClosed: this.isClosed,
    };
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.emit('close', { streamSid: this.streamSid, callSid: this.callSid });
  }
}

export class MediaStreamGateway extends EventEmitter {
  private activeSessions: Map<string, MediaStreamSession> = new Map();

  /**
   * Handles an incoming raw text message from a WebSocket client.
   */
  public handleMessage(socket: WebSocketLike, rawMessage: string): MediaStreamSession | null {
    let parsed: any;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return null;
    }

    const event = parsed.event;

    // Twilio Protocol Flow
    if (event === 'connected') {
      this.emit('connected', { protocol: parsed.protocol, version: parsed.version });
      return null;
    }

    if (event === 'start') {
      const start = parsed.start as TwilioStartPayload;
      if (!start) return null;

      const tenantId =
        start.customParameters?.tenantId ||
        parsed.tenantId ||
        'default_tenant';

      const session = new MediaStreamSession({
        streamSid: start.streamSid,
        callSid: start.callSid,
        tenantId,
        protocol: 'twilio',
        socket,
        mediaFormat: start.mediaFormat,
        customParameters: start.customParameters,
      });

      this.activeSessions.set(start.streamSid, session);
      session.on('close', () => {
        this.activeSessions.delete(start.streamSid);
      });

      this.emit('sessionStart', session);
      return session;
    }

    // Existing session routing
    const streamSid = parsed.streamSid;
    const session = streamSid ? this.activeSessions.get(streamSid) : null;

    if (!session) {
      return null;
    }

    if (event === 'media' && parsed.media?.payload) {
      session.handleInboundMedia(parsed.media.payload, parsed.media.track);
    } else if (event === 'mark' && parsed.mark?.name) {
      session.emit('markReceived', parsed.mark.name);
    } else if (event === 'stop') {
      session.close();
      this.emit('sessionStop', session);
    }

    return session;
  }

  public getSession(streamSid: string): MediaStreamSession | undefined {
    return this.activeSessions.get(streamSid);
  }

  public getActiveCount(): number {
    return this.activeSessions.size;
  }

  public closeAll(): void {
    for (const session of this.activeSessions.values()) {
      session.close();
    }
    this.activeSessions.clear();
  }
}
