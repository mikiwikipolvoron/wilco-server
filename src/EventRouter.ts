import type { Server as IOServer, Socket } from "socket.io";
import type { ActivityId, ClientEvent } from "wilco-msgs";
import type { ActivityManager } from "./activities/ActivityManager";
import { BeatsManager } from "./activities/BeatsManager";
import { LobbyManager } from "./activities/LobbyManager";
import type { StateManager } from "./state/StateManager";
// import other activity managers

export class EventRouter {
	private activities: Record<ActivityId, ActivityManager>;
	private state: StateManager;

	constructor(io: IOServer, state: StateManager) {
		this.state = state;

		// Initialize activity managers
		this.activities = {
			lobby: new LobbyManager(io, state),
			beats: new BeatsManager(io, state),
			ar: new LobbyManager(io, state),
			energizer: new LobbyManager(io, state),
			instruments: new LobbyManager(io, state),
			start: new LobbyManager(io, state),
		};
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		const currentActivity = this.state.getActivity();
		const manager = this.activities[currentActivity];

		if (!manager) {
			console.warn(`[EventRouter] No manager for activity: ${currentActivity}`);
			return;
		}

		manager.handleClientEvent(socket, event);
	}

	switchActivity(newActivity: string): void {
		const currentActivity = this.state.getActivity();

		// End current activity
		const currentManager = this.activities[currentActivity];
		if (currentManager) {
			currentManager.onActivityEnd();
		}

		// Start new activity
		this.state.setActivity(newActivity as ActivityId);
		const newManager = this.activities[newActivity as ActivityId];
		if (newManager) {
			newManager.onActivityStart();
		}
	}
}
