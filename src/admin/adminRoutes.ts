import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../sessions/SessionManager";
import type { EventRouter } from "../EventRouter";
import type { StateManager } from "../state/StateManager";

export function registerAdminRoutes(
	fastify: FastifyInstance,
	sessionManager: SessionManager,
	eventRouter: EventRouter,
	stateManager: StateManager
) {
	// Create new session
	fastify.post("/api/admin/session", async (request, reply) => {
		const session = sessionManager.createSession();

		// Reset server state for fresh session
		stateManager.reset();

		return {
			success: true,
			session: {
				id: session.id,
				createdAt: session.createdAt.toISOString(),
			},
		};
	});

	// Get current session state
	fastify.get("/api/admin/state", async (request, reply) => {
		const session = sessionManager.getActiveSession();
		const players = Object.values(stateManager.getPlayers());
		const activity = stateManager.getActivity();

		return {
			session: session ? {
				id: session.id,
				createdAt: session.createdAt.toISOString(),
				isActive: session.isActive,
				activity,
				playerCount: players.filter(p => p.role === "client").length,
				entertainerConnected: players.some(p => p.role === "entertainer"),
			} : null,
			players: players.map(p => ({
				id: p.id,
				nickname: p.nickname,
				role: p.role,
			})),
		};
	});

	// Switch activity
	fastify.post<{ Body: { activity: string } }>("/api/admin/session/activity", async (request, reply) => {
		const { activity } = request.body;

		if (!sessionManager.getActiveSession()) {
			return reply.status(400).send({ error: "No active session" });
		}

		const validActivities = ["lobby", "beats", "ar", "instruments", "energizer", "start"];
		if (!validActivities.includes(activity)) {
			return reply.status(400).send({ error: `Invalid activity: ${activity}` });
		}

		eventRouter.switchActivity(activity);

		return { success: true, activity };
	});

	// End session
	fastify.delete("/api/admin/session", async (request, reply) => {
		sessionManager.endSession();
		stateManager.reset();

		return { success: true };
	});

	// Health check (useful for k8s probes)
	fastify.get("/api/health", async () => {
		return { status: "ok" };
	});
}
