import type { Server as IOServer } from "socket.io";

export interface ActiveSession {
	id: string;
	createdAt: Date;
	isActive: boolean;
}

export class SessionManager {
	private activeSession: ActiveSession | null = null;
	private socketToSession = new Map<string, string>();
	private deviceToSocketId = new Map<string, string>();

	constructor(private io: IOServer) {}

	// Create a new session (ends any existing session)
	createSession(): ActiveSession {
		// End existing session if any
		if (this.activeSession) {
			this.endSession();
		}

		const id = this.generateSessionId();
		this.activeSession = {
			id,
			createdAt: new Date(),
			isActive: true,
		};

		console.log(`[SessionManager] Created session: ${id}`);
		return this.activeSession;
	}

	// Validate and register a socket to the session
	validateAndRegister(socketId: string, sessionId: string | undefined, deviceId?: string): boolean {
		// No active session = reject all
		if (!this.activeSession || !this.activeSession.isActive) {
			console.log(`[SessionManager] Rejected ${socketId}: no active session`);
			return false;
		}

		// Session ID must match
		if (sessionId !== this.activeSession.id) {
			console.log(`[SessionManager] Rejected ${socketId}: invalid session ID "${sessionId}" (expected "${this.activeSession.id}")`);
			return false;
		}

		// Register socket to session
		this.socketToSession.set(socketId, sessionId);

		// Track device for reconnection
		if (deviceId) {
			this.deviceToSocketId.set(deviceId, socketId);
		}

		console.log(`[SessionManager] Registered ${socketId} to session ${sessionId}`);
		return true;
	}

	// Handle socket disconnect
	handleDisconnect(socketId: string): void {
		this.socketToSession.delete(socketId);
		// Note: keep deviceToSocketId for reconnection
	}

	// Get previous socket ID for a device (for reconnection)
	getPreviousSocketId(deviceId: string): string | undefined {
		return this.deviceToSocketId.get(deviceId);
	}

	// Check if a socket is registered to the active session
	isSocketRegistered(socketId: string): boolean {
		if (!this.activeSession) return false;
		const sessionId = this.socketToSession.get(socketId);
		return sessionId === this.activeSession.id;
	}

	// End the current session
	endSession(): void {
		if (!this.activeSession) return;

		console.log(`[SessionManager] Ending session: ${this.activeSession.id}`);

		// Disconnect all sockets in this session
		for (const [socketId, sessionId] of this.socketToSession) {
			if (sessionId === this.activeSession.id) {
				const socket = this.io.sockets.sockets.get(socketId);
				if (socket) {
					socket.emit("session_ended", { message: "Session has ended" });
					socket.disconnect(true);
				}
			}
		}

		this.socketToSession.clear();
		this.deviceToSocketId.clear();
		this.activeSession = null;
	}

	// Get current session info
	getActiveSession(): ActiveSession | null {
		return this.activeSession;
	}

	// Get connected socket count for current session
	getConnectedCount(): number {
		if (!this.activeSession) return 0;
		return Array.from(this.socketToSession.values())
			.filter(sid => sid === this.activeSession?.id).length;
	}

	private generateSessionId(): string {
		const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars: I,O,0,1
		let result = "";
		for (let i = 0; i < 8; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}
}
