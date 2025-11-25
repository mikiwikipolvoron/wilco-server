// activities/BeatsManager.ts

import type { Socket } from "socket.io";
import type { ClientBeatsEvent, ClientEvent } from "wilco-msgs";
import { ActivityManager } from "./ActivityManager";

export class BeatsManager extends ActivityManager {
	private startTimestamp: number | null = null;

	onActivityStart(): void {
		console.log("[BeatsManager] Beats activity started");
		this.startTimestamp = Date.now();

		// Broadcast start event to all clients
		this.broadcast({
			type: "start",
			timestamp: this.startTimestamp,
		});

		// Auto-finish after 30 seconds
		setTimeout(() => {
			this.finish();
		}, 30000);
	}

	onActivityEnd(): void {
		console.log("[BeatsManager] Beats activity ended");
		this.startTimestamp = null;
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (!this.isBeatsEvent(event)) return;

		switch (event.type) {
			case "tap": {
				console.log(
					"[BeatsManager] Tap from",
					socket.id,
					"at",
					event.timestamp,
				);
				// Could track score, validate timing, etc.
				break;
			}
			case "reaction": {
				console.log(
					"[BeatsManager] Reaction from",
					socket.id,
					":",
					event.emoji,
				);
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

	private isBeatsEvent(event: ClientEvent): event is ClientBeatsEvent {
		return event.type === "tap" || event.type === "reaction";
	}

	private finish(): void {
		const timestamp = Date.now();
		this.broadcast({
			type: "finish",
			timestamp,
		});

		// Return to lobby after 5 seconds
		setTimeout(() => {
			this.state.setActivity("lobby");
		}, 5000);
	}
}
