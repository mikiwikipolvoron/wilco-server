import type { ActivityId } from "@mikiwikipolvoron/wilco-lib/data";
import type { ClientEvent } from "@mikiwikipolvoron/wilco-lib/events";
import type { Server as IOServer, Socket } from "socket.io";
import {
	ARManager,
	BeatsManager,
	EnergizerManager,
	InstrumentsManager,
	LobbyManager,
} from "./activities";
import type { ActivityManager } from "./activities/ActivityManager";
import type { StateManager } from "./state/StateManager";
import type { SessionManager } from "./sessions/SessionManager";

export class EventRouter {
	private activities: Record<string, ActivityManager>;
	private state: StateManager;

	constructor(io: IOServer, state: StateManager) {
		this.state = state;

		// Initialize activity managers
		this.activities = {
			start: new LobbyManager(io, state),
			lobby: new LobbyManager(io, state),
			beats: new BeatsManager(io, state),
			ar: new ARManager(io, state),
			energizer: new EnergizerManager(io, state),
			instruments: new InstrumentsManager(io, state),
		};
	}

	handleClientEvent(socket: Socket, event: ClientEvent, sessionManager?: SessionManager): void {
		// Session validation for registration
		if (event.type === "register" && sessionManager) {
			const isValid = sessionManager.validateAndRegister(
				socket.id,
				event.sessionId,
				event.deviceId
			);

			if (!isValid) {
				socket.emit("error", {
					type: "session_invalid",
					message: "Invalid or expired session ID"
				});
				socket.disconnect(true);
				return;
			}
		} else if (event.type !== "register" && sessionManager) {
			// For non-register events, verify socket is registered to active session
			if (!sessionManager.isSocketRegistered(socket.id)) {
				console.warn(`[EventRouter] Rejected event from unregistered socket: ${socket.id}`);
				socket.emit("error", {
					type: "not_registered",
					message: "You must register to the session first"
				});
				return;
			}
		}

		// Existing code continues here...
		const currentActivity = this.state.getActivity();
		const manager = this.activities[currentActivity];

		if (!manager) {
			console.warn(`[EventRouter] No manager for activity: ${currentActivity}`);
			return;
		}

		manager.handleClientEvent(socket, event);
	}

	switchActivity(newActivity: string): void {
		const currentActivity = this.state.getActivity() as string;

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

	getActivityManager(activityId: string): ActivityManager | undefined {
		return this.activities[activityId];
	}
}
