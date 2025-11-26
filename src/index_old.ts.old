import Fastify from 'fastify';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import type { ClientEvent, ServerEvent, ServerState, Player } from 'shared-types';

const fastify = Fastify();
const httpServer = createServer(fastify.server);

const io = new IOServer(httpServer, {
  cors: {
    origin: '*',
  },
});

const groups = ['A', 'B', 'C', 'D'];
let groupIndex = 0;

const state: ServerState = {
  activity: 'lobby',
  players: {},
  groups,
};

function assignGroup(): string {
  const groupId = groups[groupIndex % groups.length];
  groupIndex += 1;
  return groupId;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('client_event', (event: ClientEvent) => {
    switch (event.type) {
      case 'register': {
        const player: Player = {
          id: socket.id,
          nickname: event.nickname ?? `Player-${socket.id.slice(0, 4)}`,
          role: event.role,
          groupId: event.role === 'client' ? assignGroup() : undefined,
        };
        state.players[socket.id] = player;
        broadcastState();
        break;
      }
      case 'request_start_beats': {
        state.activity = 'beats';
        broadcastEvent({ type: 'activity_changed', activity: 'beats' });
        broadcastState();
        break;
      }
      case 'tap_beat': {
        // For now, just log. Later you can track counts.
        console.log('Beat tap from', socket.id, 'at', event.timestamp);
        break;
      }
      case 'tap_reaction': {
        console.log('Reaction tap from', socket.id, 'emoji:', event.emoji);

        // broadcast to entertainer and any listeners
        broadcastEvent({
          type: 'reaction',
          emoji: event.emoji,
          playerId: socket.id,
          timestamp: Date.now(),
        });

        break;
      }

    }
  });

  socket.on('disconnect', () => {
    delete state.players[socket.id];
    broadcastState();
    console.log('Client disconnected:', socket.id);
  });
});

function broadcastState() {
  const msg: ServerEvent = { type: 'state_update', state };
  console.log("Sending state: ", msg);
  io.emit('server_event', msg);
}

function broadcastEvent(event: ServerEvent) {
  io.emit('server_event', event);
  console.log("Sending state: ", event);
}

const PORT = Number.parseInt(process.env.PORT || "4000");

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});

// --- Console Commands for Controlling Activities ---
process.stdin.setEncoding("utf8");

process.stdin.on("data", (data) => {
  const cmd = data.toString().trim().toLowerCase();
  console.log("Received command: ", cmd)

  if (cmd === "beats") {
    broadcastEvent({ type: "activity_changed", activity: "beats" });
    state.activity = "beats";
    broadcastState();
  }

  if (cmd === "lobby") {
    broadcastEvent({ type: "activity_changed", activity: "lobby" });
    state.activity = "lobby";
    broadcastState();
  }

  if (cmd === "ar") {
    broadcastEvent({ type: "activity_changed", activity: "ar" });
 state.activity = "ar";
    broadcastState();
  }

  if (cmd === "instruments") {
    broadcastEvent({ type: "activity_changed", activity: "instruments" });
    state.activity = "instruments";
    broadcastState();
  }

  if (cmd === "energizer") {
    broadcastEvent({ type: "activity_changed", activity: "energizer" });
    state.activity = "energizer";
    broadcastState();
  }

  if (cmd === "start") {
    broadcastEvent({ type: "activity_changed", activity: "start" });
    state.activity = "start";
    broadcastState();
  }

  if (cmd === "reset") {
    // RESET = clear server state + return to lobby
    Object.keys(state.players).forEach((id) => {
      delete state.players[id];
    });
    broadcastEvent({ type: "activity_changed", activity: "lobby" });
    state.activity = "lobby";
    broadcastState();
  }
});


