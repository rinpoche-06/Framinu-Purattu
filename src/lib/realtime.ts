/**
 * Browser side of the realtime link.
 *
 * We talk to our own Node server, not to Azure directly, because the API key is
 * long-lived and must never reach client code. The server owns the Voice Live
 * session; this socket carries PCM16 audio as binary frames and small JSON
 * control messages.
 */

/** Azure offers exactly two Malayalam voices, so this is the whole palette. */
export type VoiceChoice = "male" | "female";

/** How hard the character goes after the user. */
export type RoastLevel = "savage" | "normal";

export type SessionState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error"
  | "ended";

export type ServerMessage =
  | { type: "state"; state: Exclude<SessionState, "speaking" | "reconnecting"> }
  | { type: "captionText"; text: string }
  | { type: "userTranscript"; text: string }
  | { type: "responseStart"; itemId: string }
  | { type: "interrupted" }
  /** The server no longer knows this character, most likely after a restart. */
  | { type: "characterMissing" }
  | { type: "error"; message: string };

export interface RealtimeHandlers {
  onAudio: (pcm16: ArrayBuffer) => void;
  onMessage: (message: ServerMessage) => void;
  /** Connection dropped and a retry is scheduled. */
  onReconnecting: (attempt: number, delayMs: number) => void;
  /** A retry succeeded. The provider session is new, so context is lost. */
  onReconnected: () => void;
  /** Gave up, or the caller closed us deliberately. */
  onClosed: () => void;
}

/** Backoff schedule in ms. Runs out rather than retrying forever. */
const RETRY_DELAYS = [400, 900, 2000, 4000, 6000];

export class RealtimeLink {
  private socket: WebSocket | null = null;
  private target: {
    characterId?: string;
    voice: VoiceChoice;
    roast: RoastLevel;
    /** Lets a reconnected session be replayed back into context. */
    conversationId?: string;
  } | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  /** False once the caller closes us, so a deliberate stop is not retried. */
  private wantConnection = false;
  private everConnected = false;

  constructor(private readonly handlers: RealtimeHandlers) {}

  /**
   * @param characterId id returned by /api/analyse. Omitted means the built-in
   *   demo chair.
   * @param voice which of the two Malayalam voices to use.
   *
   * Both are passed at connect time so the session is configured on its first
   * update. That also means the voice never changes mid-session, which matters
   * because mid-session voice switching is untested against this provider.
   */
  connect(
    characterId?: string,
    voice: VoiceChoice = "male",
    roast: RoastLevel = "savage",
    conversationId?: string,
  ): void {
    if (this.socket) return;
    this.target = { characterId, voice, roast, conversationId };
    this.wantConnection = true;
    this.attempt = 0;
    this.open();
  }

  /**
   * Reconnect to a different character id.
   *
   * Used after the server reports it has forgotten the character, typically
   * because it restarted while the page stayed open. Without this the session
   * silently comes back as the demo chair instead of the uploaded picture.
   */
  reconnectAs(characterId: string): void {
    if (!this.target) return;
    this.target = { ...this.target, characterId };
    this.attempt = 0;
    this.closeSocket();
    this.open();
  }

  private open(): void {
    if (!this.target) return;

    const params = new URLSearchParams({
      voice: this.target.voice,
      roast: this.target.roast,
    });
    if (this.target.characterId) params.set("character", this.target.characterId);
    if (this.target.conversationId) {
      params.set("conversation", this.target.conversationId);
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/realtime?${params}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      const wasRetrying = this.attempt > 0;
      this.attempt = 0;
      if (wasRetrying) this.handlers.onReconnected();
      this.everConnected = true;
    };

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handlers.onAudio(event.data);
        return;
      }
      try {
        this.handlers.onMessage(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // Ignore anything we cannot parse rather than killing the session.
      }
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.wantConnection) {
        this.handlers.onClosed();
        return;
      }
      this.scheduleRetry();
    };

    // onerror always precedes onclose, so the retry is driven from onclose alone
    // to avoid counting a single failure twice.
    socket.onerror = () => {};
  }

  private scheduleRetry(): void {
    if (this.attempt >= RETRY_DELAYS.length) {
      this.wantConnection = false;
      this.handlers.onMessage({
        type: "error",
        message: this.everConnected
          ? "Lost the connection and could not get it back. Press Stop, then wake the picture again."
          : "Could not reach the server. Is it running?",
      });
      this.handlers.onClosed();
      return;
    }

    const delay = RETRY_DELAYS[this.attempt];
    this.attempt += 1;
    this.handlers.onReconnecting(this.attempt, delay);

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.wantConnection) this.open();
    }, delay);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
    }
  }

  private get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendAudio(frame: ArrayBuffer): void {
    if (this.isOpen) this.socket!.send(frame);
  }

  send(
    message:
      | { type: "greet" | "interrupt" | "escape" }
      | { type: "ask"; text: string }
      | { type: "played"; itemId: string; ms: number },
  ): void {
    if (this.isOpen) this.socket!.send(JSON.stringify(message));
  }

  close(): void {
    // Set before closing so onclose knows this was deliberate and does not retry.
    this.wantConnection = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.closeSocket();
  }
}
