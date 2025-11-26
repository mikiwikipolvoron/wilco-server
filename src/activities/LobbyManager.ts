// activities/LobbyManager.ts

import {
	CLIENT_LOBBY_EVENTS,
	type ClientEvent,
	type ClientGlobalEvent,
	type ClientLobbyEvent,
	type ClientServiceEvent,
} from "@wilco/shared/events";
import type { Socket } from "socket.io";
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

		if (this.isGlobalEvent(event)) {
			this.handleGlobalEvent(socket, event);
			return;
		}

		// Handle lobby-specific events
		if (this.isLobbyEvent(event)) {
			this.handleLobbyEvent(socket, event);
			return;
		}
	}

	private isLobbyEvent(event: ClientEvent): event is ClientLobbyEvent {
		return CLIENT_LOBBY_EVENTS.some((t) => t === event.type);
	}

	private handleGlobalEvent(socket: Socket, event: ClientGlobalEvent): void {
		console.debug("[Lobby] ClientGlobalEvent: ", event);
		switch (event.type) {
			case "reaction": {
				this.broadcast({
					type: "reaction",
					emoji: event.emoji,
					playerId: socket.id,
					timestamp: Date.now(),
				});
				break;
			}
		}
	}

	private handleServiceEvent(socket: Socket, event: ClientServiceEvent): void {
		console.debug("[Lobby] ClientServiceEvent: ", event);
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

	private handleLobbyEvent(_socket: Socket, event: ClientLobbyEvent): void {
		console.debug("[Lobby] ClientLobbyEvent: ", event);
		switch (event.type) {
			case "request_start_beats": {
				console.log("[LobbyManager] Client requested beats activity");
				this.state.setActivity("beats");
				break;
			}
		}
	}
}
