import type { ClientEvent } from "@mikiwikipolvoron/wilco-lib/events";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as IOServer } from "socket.io";
import { EventRouter } from "./EventRouter";
import { StateManager } from "./state/StateManager";
import { SessionManager } from "./sessions/SessionManager";
import { registerAdminRoutes } from "./admin/adminRoutes";

const fastify = Fastify();

// Enable CORS for admin API routes
await fastify.register(cors, {
	origin: true, // Allow all origins (same as Socket.IO config)
	credentials: true,
});

const io = new IOServer(
	fastify.server,
	{cors: {
		// origin: ["https://mikiwikipolvoron.github.io"],
        origin: true,
	// 	methods: ["GET", "POST"],
	// 	credentials: true,
	},}
);

// Initialize managers
const stateManager = new StateManager(io);
const eventRouter = new EventRouter(io, stateManager);

// Initialize session manager
const sessionManager = new SessionManager(io);

// Register admin API routes
registerAdminRoutes(fastify, sessionManager, eventRouter, stateManager);

// Socket connection handling
io.on("connection", (socket) => {
	console.log("[Server] Client connected:", socket.id);

	socket.on("client_event", (event: ClientEvent) => {
		console.debug("[Server][DEBUG] ClientEvent recv: ", event);
		eventRouter.handleClientEvent(socket, event, sessionManager);
	});

	socket.on("disconnect", () => {
		console.debug(
			"[Server][DEBUG] Disconnect recv: ",
			stateManager.getPlayer(socket.id),
		);

		// Notify activity BEFORE removing from state
		const currentActivity = stateManager.getActivity();
		const manager = eventRouter.getActivityManager(currentActivity);
		if (manager) {
			manager.onPlayerDisconnect(socket.id);
		}

		// Then remove from global state
		stateManager.removePlayer(socket.id);
		sessionManager.handleDisconnect(socket.id);
		console.log("[Server] Client disconnected:", socket.id);
	});
});

// Start server
const PORT = Number.parseInt(process.env.PORT || "4000", 10);
await fastify.listen({ port: PORT, host: "0.0.0.0" });
console.log(`[Server] Listening on port ${PORT}`);

// Console commands for activity control
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
	const cmd = data.toString().trim().toLowerCase();
	console.log("[Console] Command:", cmd);

	if (
		["lobby", "beats", "ar", "instruments", "energizer", "start"].includes(cmd)
	) {
		eventRouter.switchActivity(cmd);
	}

	if (cmd === "reset") {
		stateManager.reset();
	}

    if (cmd === "lightsoff") {
        stateManager.broadcastLightTestOff()
    }

    if (cmd === "lightson") {
        stateManager.broadcastLightTestOn()
    }
});
