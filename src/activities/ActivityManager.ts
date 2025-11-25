// activities/ActivityManager.ts
import type { Server as IOServer, Socket } from "socket.io";
import type { ClientEvent, ServerEvent } from "wilco-msgs";
import type { StateManager } from "../state/StateManager";

export abstract class ActivityManager {
	protected io: IOServer;
	protected state: StateManager;


	constructor(io: IOServer, state: StateManager) {
		this.io = io;
		this.state = state;
	}

	// Called when activity starts
	abstract onActivityStart(): void;

	// Called when activity ends
	abstract onActivityEnd(): void;

	// Handle client events for this activity
	abstract handleClientEvent(socket: Socket, event: ClientEvent): void;

	// Utility to broadcast activity-specific events
	protected broadcast(event: ServerEvent): void {
		this.io.emit("server_event", event);
	}

	protected broadcastToPlayer(playerId: string, event: ServerEvent): void {
		this.io.to(playerId).emit("server_event", event);
	}
}
