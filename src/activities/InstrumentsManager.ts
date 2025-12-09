import {
	CLIENT_INSTRUMENT_EVENTS,
	type ClientEvent,
	type ClientInstrumentsEvent,
	type InstrumentId,
	type InstrumentInfo,
} from "@mikiwikipolvoron/wilco-lib/events";
import type { Socket } from "socket.io";
import { ActivityManager } from "./ActivityManager";

type EnergyState = {
	total: number;
	byInstrument: Record<InstrumentId, number>;
};

export class InstrumentsManager extends ActivityManager {
	private readonly instruments: InstrumentInfo[] = [
		{
			id: "drums",
			name: "Drums",
			hint: "Big arm hits",
			tool: "Drumsticks",
			color: "#ef4444",
		},
		{
			id: "maracas",
			name: "Maracas",
			hint: "Shake",
			tool: "Maracas",
			color: "#f59e0b",
		},
		{
			id: "guitar",
			name: "Guitar",
			hint: "Strum",
			tool: "Guitar pick",
			color: "#22d3ee",
		},
		{
			id: "violin",
			name: "Violin",
			hint: "Bow",
			tool: "Violin bow",
			color: "#a855f7",
		},
	];

	private demoTimers: NodeJS.Timeout[] = [];
	private finaleTimer: NodeJS.Timeout | null = null;
	private energyTimer: NodeJS.Timeout | null = null;
	private spotlightTimers: NodeJS.Timeout[] = [];
	private assignments = new Map<string, InstrumentId>();
	private energy: EnergyState = { total: 0, byInstrument: { drums: 0, maracas: 0, guitar: 0, violin: 0 } };
	private currentPhase: "demo" | "finale" = "demo";

	private readonly demoStepMs = 8000;
	private readonly finaleDurationMs = 20000;

	onActivityStart(): void {
		this.reset();
		this.runDemoLoop();
	}

	onActivityEnd(): void {
		this.clearTimers();
		this.reset();
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (!this.isInstrumentEvent(event)) return;

		if (this.currentPhase === "demo" || this.currentPhase === "finale") {
			const assigned = this.assignments.get(socket.id);
			this.recordEnergy(event.magnitude, assigned);
		}
	}

	// Flow
	private runDemoLoop(): void {
		this.broadcast({ type: "instruments_phase", phase: "demo" });
		this.instruments.forEach((instrument, index) => {
			const timer = setTimeout(() => {
				this.broadcast({
					type: "instruments_demo_step",
					instrument,
					durationMs: this.demoStepMs,
				});
				// Also send the tool to all clients for demo
				this.broadcast({
					type: "instruments_assignment",
					instrument: instrument.id,
				});
			}, index * this.demoStepMs);
			this.demoTimers.push(timer);
		});

		const totalDemoTime = this.instruments.length * this.demoStepMs + 200;
		const startFinaleTimer = setTimeout(() => this.startFinale(), totalDemoTime);
		this.demoTimers.push(startFinaleTimer);
	}

	private startFinale(): void {
		this.currentPhase = "finale";
		this.assignInstruments();
		this.broadcast({
			type: "instruments_phase",
			phase: "finale",
		});
		this.broadcast({
			type: "instruments_finale_start",
			durationMs: this.finaleDurationMs,
		});

		this.energyTimer = setInterval(() => {
			this.decayEnergy();
			this.broadcast({
				type: "instruments_energy",
				level: Math.min(1, this.energy.total),
				instrumentLevels: this.energy.byInstrument,
			});
		}, 700);

		this.scheduleSpotlights();

		this.finaleTimer = setTimeout(() => {
			this.finish();
		}, this.finaleDurationMs);
	}

	private finish(): void {
		this.clearTimers();
		this.reset();
		this.state.setActivity("lobby");
	}

	// Energy handling
	private recordEnergy(magnitude: number, instrument?: InstrumentId): void {
		const gain = Math.min(1, Math.max(0, magnitude / 6)) * 0.08;
		this.energy.total = Math.min(1.5, this.energy.total + gain);
		if (instrument) {
			this.energy.byInstrument[instrument] = Math.min(
				1.5,
				(this.energy.byInstrument[instrument] ?? 0) + gain,
			);
		}
	}

	private decayEnergy(): void {
		this.energy.total = Math.max(0, this.energy.total * 0.85);
		(Object.keys(this.energy.byInstrument) as InstrumentId[]).forEach((id) => {
			this.energy.byInstrument[id] = Math.max(
				0,
				(this.energy.byInstrument[id] ?? 0) * 0.85,
			);
		});
	}

	// Assignments
	private assignInstruments(): void {
		const players = Object.values(this.state.getPlayers()).filter(
			(p) => p.role === "client",
		);
		players.forEach((p, idx) => {
			const instrument = this.instruments[idx % this.instruments.length].id;
			this.assignments.set(p.id, instrument);
			this.broadcastToPlayer(p.id, {
				type: "instruments_assignment",
				instrument,
			});
		});
	}

	// Spotlights
	private scheduleSpotlights(): void {
		this.clearSpotlights();
		const instruments = this.instruments.map((i) => i.id);
		instruments.forEach((inst, idx) => {
			const delay = 4000 + idx * 4500;
			const timerStart = setTimeout(() => {
				this.broadcast({
					type: "instruments_spotlight",
					instrument: inst,
					active: true,
					durationMs: 4000,
				});
				const timerEnd = setTimeout(() => {
					this.broadcast({
						type: "instruments_spotlight",
						instrument: inst,
						active: false,
						durationMs: 0,
					});
				}, 4000);
				this.spotlightTimers.push(timerEnd);
			}, delay);
			this.spotlightTimers.push(timerStart);
		});
	}

	private clearSpotlights(): void {
		this.spotlightTimers.forEach((t) => clearTimeout(t));
		this.spotlightTimers = [];
	}

	private reset(): void {
		this.assignments.clear();
		this.energy = {
			total: 0,
			byInstrument: { drums: 0, maracas: 0, guitar: 0, violin: 0 },
		};
		this.currentPhase = "demo";
	}

	private clearTimers(): void {
		this.demoTimers.forEach((t) => clearTimeout(t));
		this.demoTimers = [];
		if (this.finaleTimer) clearTimeout(this.finaleTimer);
		this.finaleTimer = null;
		if (this.energyTimer) clearInterval(this.energyTimer);
		this.energyTimer = null;
		this.clearSpotlights();
	}

	private isInstrumentEvent(event: ClientEvent): event is ClientInstrumentsEvent {
		return CLIENT_INSTRUMENT_EVENTS.some((t) => t === event.type);
	}

	onPlayerDisconnect(playerId: string): void {
		// Remove instrument assignment
		this.assignments.delete(playerId);

		console.log(
			`[InstrumentsManager] Player ${playerId} disconnected, removed instrument assignment`,
		);
	}
}
