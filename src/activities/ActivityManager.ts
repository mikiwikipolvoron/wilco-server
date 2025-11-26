// activities/ActivityManager.ts

import {
	CLIENT_GLOBAL_EVENTS,
	CLIENT_SERVICE_EVENTS,
	type ClientEvent,
	type ClientGlobalEvent,
	type ClientServiceEvent,
	type ServerEvent,
} from "@wilco/shared/events";
import type { Server as IOServer, Socket } from "socket.io";
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

	protected isGlobalEvent(event: ClientEvent): event is ClientGlobalEvent {
		return CLIENT_GLOBAL_EVENTS.some((t) => t === event.type);
	}

	protected isServiceEvent(event: ClientEvent): event is ClientServiceEvent {
		return CLIENT_SERVICE_EVENTS.some((t) => t === event.type);
	}

	protected broadcastToPlayer(playerId: string, event: ServerEvent): void {
		this.io.to(playerId).emit("server_event", event);
	}
}
