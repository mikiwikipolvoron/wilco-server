// state/StateManager.ts

import type { ActivityId, Player, ServerState } from "@mikiwikipolvoron/wilco-lib/data";
import type { ServerEvent } from "packages/wilco-shared";
import type { Server as IOServer } from "socket.io";

export class StateManager {
	private state: ServerState;
	private io: IOServer;
	private groupNames: string[] = ["A", "B", "C", "D"];
	private groupIndex: number = 0;

	constructor(io: IOServer) {
		this.io = io;
		this.state = {
			currentActivity: "start",
			players: {},
			groups: undefined,
		};
	}

	// State queries
	getState(): ServerState {
		return this.state;
	}

	getActivity(): ActivityId {
		return this.state.currentActivity;
	}

	getPlayers(): Record<string, Player> {
		return this.state.players;
	}

	getPlayer(id: string): Player | undefined {
		return this.state.players[id];
	}

	// State mutations
	addPlayer(player: Player): void {
		this.state.players[player.id] = player;
		this.broadcastState();
		this.broadcastEvent({
			type: "player_joined",
			player,
		});
	}

	removePlayer(playerId: string): void {
		delete this.state.players[playerId];
		this.broadcastState();
		this.broadcastEvent({
			type: "player_left",
			playerId,
		});
	}

	setActivity(activity: ActivityId): void {
		this.state.currentActivity = activity;
		this.broadcastEvent({
			type: "activity_started",
			activity,
		});
		this.broadcastState();
	}

	assignGroup(): string {
		const groupId = this.groupNames[this.groupIndex % this.groupNames.length];
		this.groupIndex += 1;
		return groupId;
	}

	reset(): void {
		this.state.players = {};
		this.groupIndex = 0;
		this.setActivity("lobby");
	}

	// Broadcasting
	broadcastState(): void {
		const msg: ServerEvent = { type: "state_broadcast", state: this.state };
		this.io.emit("server_event", msg);
		console.log("[StateManager] Broadcast state:", this.state.currentActivity);
		console.debug("[StateManager][D] State: ", this.getState())
	}

	broadcastEvent(event: ServerEvent): void {
		this.io.emit("server_event", event);
		console.log("[StateManager] Broadcast event:", event.type);
		console.debug("[StateManager][D] ", event)
	}
}
