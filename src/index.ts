import { createServer } from "node:http";
import Fastify from "fastify";
import { Server as IOServer } from "socket.io";
import type { ClientEvent } from "@wilco/shared/events";
import { EventRouter } from "./EventRouter";
import { StateManager } from "./state/StateManager";

const fastify = Fastify();
const httpServer = createServer(fastify.server);

const io = new IOServer(httpServer, {
	cors: {
		origin: "*",
	},
});

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
        console.debug("[Server][DEBUG] Disconnect recv: ", stateManager.getPlayer(socket.id));
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
