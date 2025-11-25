// activities/LobbyManager.ts

import type { Socket } from "socket.io";
import {
	CLIENT_LOBBY_EVENTS,
	CLIENT_SERVICE_EVENTS,
	type ClientEvent,
	type ClientLobbyEvent,
	type ClientServiceEvent,
} from "wilco-msgs";
import { ActivityManager } from "./ActivityManager";

export class LobbyManager extends ActivityManager {
	onActivityStart(): void {
		console.log("[LobbyManager] Lobby started");
	}

	onActivityEnd(): void {
		console.log("[LobbyManager] Lobby ended");
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		// Handle service events
		if (this.isServiceEvent(event)) {
			this.handleServiceEvent(socket, event);
			return;
		}

		// Handle lobby-specific events
		if (this.isLobbyEvent(event)) {
			this.handleLobbyEvent(socket, event);
			return;
		}
	}

	private isServiceEvent(event: ClientEvent): event is ClientServiceEvent {
		return CLIENT_SERVICE_EVENTS.some((t) => t === event.type);
	}

	private isLobbyEvent(event: ClientEvent): event is ClientLobbyEvent {
		return CLIENT_LOBBY_EVENTS.some((t) => t === event.type);
	}

	private handleServiceEvent(socket: Socket, event: ClientServiceEvent): void {
		switch (event.type) {
			case "register": {
				const player = {
					id: socket.id,
					nickname: event.nickname ?? `Player-${socket.id.slice(0, 4)}`,
					role: event.role,
					groupId:
						event.role === "client" ? this.state.assignGroup() : undefined,
					lastSeen: new Date(),
				};
				this.state.addPlayer(player);
				break;
			}
			case "request_state": {
				this.state.broadcastState();
				break;
			}
		}
	}

	private handleLobbyEvent(socket: Socket, event: ClientLobbyEvent): void {
		switch (event.type) {
			case "request_start_beats": {
				console.log("[LobbyManager] Client requested beats activity");
				this.state.setActivity("beats");
				break;
			}
		}
	}
}
