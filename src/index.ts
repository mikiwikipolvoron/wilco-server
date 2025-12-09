import { createServer } from "node:http";
import type { ClientEvent } from "@mikiwikipolvoron/wilco-lib/events";
import Fastify from "fastify";
import { Server as IOServer } from "socket.io";
import { EventRouter } from "./EventRouter";
import { StateManager } from "./state/StateManager";

const fastify = Fastify();
const httpServer = createServer(fastify.server);

const io = new IOServer(
	httpServer,
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

// Socket connection handling
io.on("connection", (socket) => {
	console.log("[Server] Client connected:", socket.id);

	socket.on("client_event", (event: ClientEvent) => {
		console.debug("[Server][DEBUG] ClientEvent recv: ", event);
		eventRouter.handleClientEvent(socket, event);
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
		console.log("[Server] Client disconnected:", socket.id);
	});
});

// Start server
const PORT = Number.parseInt(process.env.PORT || "4000", 10);
httpServer.listen(PORT, "0.0.0.0", () => {
	console.log(`[Server] Listening on http://0.0.0.0:${PORT}`);
});

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
});
