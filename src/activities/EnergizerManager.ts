import {
	CLIENT_ENERGIZER_EVENTS,
	type ClientEnergizerEvent,
	type ClientEvent,
	type ClientGlobalEvent,
	type ClientServiceEvent,
	type EnergizerCell,
	type EnergizerPattern,
	type PlayerEnergy,
	type ServerEnergizerEvent,
} from "@mikiwikipolvoron/wilco-lib/events";
import type { Socket } from "socket.io";
import { ActivityManager } from "./ActivityManager";

type PendingSubmission = {
	playerId: string;
	cells: EnergizerCell[];
};

export class EnergizerManager extends ActivityManager {
	private playerCharge = new Map<string, number>();
	private lastMotion = new Map<string, number>();
	private lastActive = new Map<string, number>();
	private currentPhase:
		| "instructions1"
		| "movement"
		| "send_energy"
		| "instructions2"
		| "sequence_show"
		| "sequence_input"
		| "results" = "instructions1";
	private entertainerInterval: NodeJS.Timeout | null = null;
	private instructionsTimer: NodeJS.Timeout | null = null;
	private movementTimer: NodeJS.Timeout | null = null;
	private movementEndTimer: NodeJS.Timeout | null = null;
	private sequenceTimer: NodeJS.Timeout | null = null;
	private spotlightTimers: NodeJS.Timeout[] = [];

	private currentPattern: EnergizerPattern | null = null;
	private allowSequenceInput = false;
	private pendingSubmissions: PendingSubmission[] = [];
	private displayDurationMs = 5000;
	private sequenceAttempts = 0;

	private readonly movementDurationMs = 60_000;
	private readonly spotlightDurationMs = 10_000;
	private readonly sendDurationMs = 12_000;
	private readonly inputWindowMs = 20_000;

	private readonly instructionSlides1 = [
		"Energizer challenge",
		"The artist will soon come out, but the stage has run out of energy.",
		"In order to recharge the energy and get the lights working again, we need your help.",
		"Please click \"accept movement\" on your phones and when the music starts dance and move as much as you can.",
		"Dance with each other, be considerate, and you will help charge the stage!",
	];

	private readonly instructionSlides2 = [
		"Great, we have enough energy to set the light show, but we need your help to lock it down.",
		"We will show the pattern on screen, memorize the placement and the color and copy it on your phones.",
	];

	private spotlightActive = false;

	onActivityStart(): void {
		this.resetState();
		this.runInstructionSet("instructions1", this.instructionSlides1, () =>
			this.startMovement(),
		);
	}

	onActivityEnd(): void {
		this.clearTimers();
		this.resetState();
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (this.isServiceEvent(event)) {
			this.handleServiceEvent(socket, event);
			return;
		}

		if (this.isGlobalEvent(event)) {
			this.handleGlobalEvent(socket, event);
			return;
		}

		if (!this.isEnergizerEvent(event)) return;

		switch (event.type) {
			case "energizer_motion": {
				this.handleMotion(socket.id, event.magnitude);
				break;
			}
			case "energizer_swipe_send": {
				const charge = this.playerCharge.get(socket.id) ?? 0;
				this.playerCharge.set(socket.id, 0);
				this.broadcast({
					type: "energizer_energy_sent",
					playerId: socket.id,
					charge,
				});
				this.broadcastToPlayer(socket.id, {
					type: "energizer_player_update",
					charge: 0,
					idle: false,
				});
				break;
			}
			case "energizer_sequence_submit": {
				if (!this.allowSequenceInput) return;
				this.pendingSubmissions.push({
					playerId: socket.id,
					cells: event.cells,
				});
				break;
			}
		}
	}

	private handleGlobalEvent(socket: Socket, event: ClientGlobalEvent): void {
		console.debug("[Lobby] ClientGlobalEvent: ", event);
		switch (event.type) {
			case "reaction": {
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

	private handleServiceEvent(socket: Socket, event: ClientServiceEvent): void {
		console.debug("[Lobby] ClientServiceEvent: ", event);
		switch (event.type) {
			case "register": {
				const player = {
					id: socket.id,
					nickname: event.nickname ?? `Player-${socket.id.slice(0, 4)}`,
					role: event.role,
					groupId:
						event.role === "client" ? this.state.assignGroup() : undefined,
					lastSeen: new Date(),
				};
				this.state.addPlayer(player);
				break;
			}
			case "request_state": {
				this.state.broadcastState();
				break;
			}
		}
	}

	// Flow helpers
	private runInstructionSet(
		phase: "instructions1" | "instructions2",
		slides: string[],
		onComplete: () => void,
	): void {
		this.broadcast({
			type: "energizer_phase_change",
			phase,
		});
		this.currentPhase = phase;

		let delay = 0;
		slides.forEach((text, idx) => {
			const durationMs = this.computeReadingDurationMs(text);
			const slide = idx + 1;
			delay += idx === 0 ? 0 : this.computeReadingDurationMs(slides[idx - 1]);
			this.instructionsTimer = setTimeout(() => {
				this.broadcast({
					type: "energizer_instruction",
					phase,
					slide,
					totalSlides: slides.length,
					text,
					durationMs,
				});
			}, delay);
		});

		const totalDuration =
			slides.reduce(
				(acc, text) => acc + this.computeReadingDurationMs(text),
				0,
			) + 500;
		this.instructionsTimer = setTimeout(() => onComplete(), totalDuration);
	}

	private startMovement(): void {
		this.broadcast({
			type: "energizer_phase_change",
			phase: "movement",
			durationMs: this.movementDurationMs,
		});
		this.currentPhase = "movement";

		this.scheduleSpotlights();

		this.movementEndTimer = setTimeout(() => {
			this.endMovement();
		}, this.movementDurationMs);

		if (this.entertainerInterval) clearInterval(this.entertainerInterval);
		this.entertainerInterval = setInterval(() => {
			this.pushEntertainerUpdate();
			this.pushPlayerIdleUpdates();
		}, 750);
	}

	private endMovement(): void {
		this.clearSpotlights();
		if (this.entertainerInterval) {
			clearInterval(this.entertainerInterval);
			this.entertainerInterval = null;
		}
		this.startSendStage();
	}

	private startSendStage(): void {
		this.broadcast({
			type: "energizer_phase_change",
			phase: "send_energy",
			durationMs: this.sendDurationMs,
		});
		this.currentPhase = "send_energy";

		setTimeout(() => {
			this.runInstructionSet("instructions2", this.instructionSlides2, () =>
				this.startSequence(),
			);
		}, this.sendDurationMs);
	}

	private startSequence(): void {
		this.allowSequenceInput = false;
		this.pendingSubmissions = [];
		this.sequenceAttempts = 0;
		this.currentPattern = this.generatePattern(this.displayDurationMs);
		if (!this.currentPattern) return;

		this.sequenceAttempts += 1;

		this.broadcast({
			type: "energizer_phase_change",
			phase: "sequence_show",
			durationMs: this.currentPattern.displayMs,
		});
		this.currentPhase = "sequence_show";

		this.broadcast({
			type: "energizer_sequence_show",
			pattern: this.currentPattern,
		});

		this.sequenceTimer = setTimeout(() => {
			this.broadcast({ type: "energizer_sequence_hide" });
			this.broadcast({
				type: "energizer_phase_change",
				phase: "sequence_input",
				durationMs: this.inputWindowMs,
			});
			this.currentPhase = "sequence_input";
			this.allowSequenceInput = true;
			this.sequenceTimer = setTimeout(
				() => this.evaluateSubmissions(),
				this.inputWindowMs,
			);
		}, this.currentPattern.displayMs);
	}

	private evaluateSubmissions(): void {
		this.allowSequenceInput = false;

		const totalParticipants = this.countClientPlayers();
		const correctCount = this.pendingSubmissions.filter((submission) =>
			this.isSubmissionCorrect(submission.cells),
		).length;

		const success = correctCount > totalParticipants / 2;

		this.broadcast({
			type: "energizer_sequence_result",
			success,
			correctCount,
			totalParticipants,
			nextDisplayMs: success
				? undefined
				: Math.round(this.displayDurationMs * 1.5),
		});

		if (success && this.currentPattern) {
			this.broadcast(this.buildLedPayload(this.currentPattern));
			this.broadcast({
				type: "energizer_phase_change",
				phase: "results",
			});
			this.currentPhase = "results";
			// Return to lobby after a short pause
			setTimeout(() => this.state.setActivity("lobby"), 5000);
		} else {
			this.displayDurationMs = Math.round(this.displayDurationMs * 1.5);
			if (this.sequenceAttempts >= 2) {
				this.broadcast({
					type: "energizer_phase_change",
					phase: "results",
				});
				this.currentPhase = "results";
				setTimeout(() => this.state.setActivity("lobby"), 5000);
			} else {
				this.startSequence();
			}
		}
	}

	// Motion handling
	private handleMotion(playerId: string, magnitude: number): void {
		if (this.currentPhase !== "movement") return;

		const now = Date.now();
		this.lastMotion.set(playerId, now);
		if (magnitude >= 1.2) {
			this.lastActive.set(playerId, now);
		}

		// Normalize magnitude so subtle moves add less than big moves
		const normalized = Math.min(Math.max(magnitude / 8, 0), 1);
		const baseDelta = 0.004 * normalized; // faster charge: ~16% per ~5s steady movement
		const delta = this.spotlightActive ? baseDelta * 1.5 : baseDelta;

		const current = this.playerCharge.get(playerId) ?? 0;
		const next = Math.min(1, current + delta);
		this.playerCharge.set(playerId, next);

		this.broadcastToPlayer(playerId, {
			type: "energizer_player_update",
			charge: next,
			idle: false,
		});
	}

	// Utilities
	private computeReadingDurationMs(text: string): number {
		const words = text.trim().split(/\s+/).filter(Boolean).length;
		const minutes = words / 150;
		return Math.max(3000, Math.round(minutes * 60_000));
	}

	private pushEntertainerUpdate(): void {
		const players: PlayerEnergy[] = [];
		for (const [playerId, charge] of this.playerCharge.entries()) {
			const player = this.state.getPlayer(playerId);
			if (!player) continue;
			players.push({
				playerId,
				nickname: player.nickname,
				charge,
				idle: false,
			});
		}

		this.broadcast({
			type: "energizer_entertainer_update",
			players: players.sort((a, b) => b.charge - a.charge),
		});
	}

	private pushPlayerIdleUpdates(): void {
		for (const [playerId] of this.playerCharge.entries()) {
			const last = this.lastActive.get(playerId) ?? 0;
			const idle = Date.now() - last > 2_000;
			if (idle) {
				this.broadcastToPlayer(playerId, {
					type: "energizer_player_update",
					charge: this.playerCharge.get(playerId) ?? 0,
					idle: true,
				});
			}
		}
	}

	private scheduleSpotlights(): void {
		this.clearSpotlights();
		const startWindow = 10_000;
		const endWindow = 50_000;

		const times: number[] = [];
		for (let i = 0; i < 2; i++) {
			let time: number;
			do {
				time =
					startWindow +
					Math.floor(
						Math.random() *
							(endWindow - startWindow - this.spotlightDurationMs),
					);
			} while (
				times.some((t) => Math.abs(t - time) < this.spotlightDurationMs + 2_000)
			);
			times.push(time);
		}

		times.forEach((delay) => {
			const startTimer = setTimeout(() => {
				this.spotlightActive = true;
				this.broadcast({
					type: "energizer_spotlight",
					active: true,
					durationMs: this.spotlightDurationMs,
				});
				const endTimer = setTimeout(() => {
					this.spotlightActive = false;
					this.broadcast({
						type: "energizer_spotlight",
						active: false,
						durationMs: 0,
					});
				}, this.spotlightDurationMs);
				this.spotlightTimers.push(endTimer);
			}, delay);
			this.spotlightTimers.push(startTimer);
		});
	}

	private clearSpotlights(): void {
		this.spotlightTimers.forEach((t) => clearTimeout(t));
		this.spotlightTimers = [];
		this.spotlightActive = false;
	}

	private generatePattern(displayMs: number): EnergizerPattern {
		const palette = ["#ff63c3", "#ffa347", "#44a0ff", "#3ed17a"];
		const rows = 2;
		const cols = 4;
		const cells: EnergizerCell[] = [];
		const chosen = new Set<number>();

		while (cells.length < 5) {
			const index = Math.floor(Math.random() * rows * cols);
			if (chosen.has(index)) continue;
			chosen.add(index);
			const color = palette[Math.floor(Math.random() * palette.length)];
			cells.push({ index, color });
		}

		const sequenceId = Math.floor(Math.random() * 10_000);

		return { rows, cols, cells, displayMs, sequenceId };
	}

	private isSubmissionCorrect(cells: EnergizerCell[]): boolean {
		if (!this.currentPattern) return false;
		const expected = new Map<number, string>();
		this.currentPattern.cells.forEach((cell) =>
			expected.set(cell.index, cell.color.toLowerCase()),
		);

		const submitted = new Map<number, string>();
		cells.forEach((cell) =>
			submitted.set(cell.index, cell.color.toLowerCase()),
		);

		if (submitted.size !== expected.size) return false;
		for (const [index, color] of expected.entries()) {
			if (submitted.get(index) !== color) return false;
		}
		return true;
	}

	private buildLedPayload(pattern: EnergizerPattern): ServerEnergizerEvent {
		const steps: { time: number; leds: { id: number; color: string }[] }[] = [];
		const baseColor = "#000000";
		const totalLeds = pattern.rows * pattern.cols;

		for (let i = 0; i < 8; i++) {
			const leds = Array.from({ length: totalLeds }, (_, idx) => ({
				id: idx,
				color: baseColor,
			}));

			const cell = pattern.cells[i % pattern.cells.length];
			leds[cell.index].color = cell.color;
			steps.push({ time: i * 200, leds });
		}

		return {
			type: "led_sequence",
			sequence: pattern.sequenceId,
			pattern: steps,
		};
	}

	private countClientPlayers(): number {
		return Object.values(this.state.getPlayers()).filter(
			(p) => p.role === "client",
		).length;
	}

	private resetState(): void {
		this.playerCharge.clear();
		this.lastMotion.clear();
		this.lastActive.clear();
		this.pendingSubmissions = [];
		this.allowSequenceInput = false;
		this.currentPattern = null;
		this.displayDurationMs = 5000;
		this.sequenceAttempts = 0;
	}

	private clearTimers(): void {
		[
			this.instructionsTimer,
			this.movementTimer,
			this.movementEndTimer,
			this.sequenceTimer,
		].forEach((timer) => {
			if (timer) clearTimeout(timer);
		});

		if (this.entertainerInterval) clearInterval(this.entertainerInterval);
		this.entertainerInterval = null;

		this.clearSpotlights();
	}

	private isEnergizerEvent(event: ClientEvent): event is ClientEnergizerEvent {
		return CLIENT_ENERGIZER_EVENTS.some((type) => type === event.type);
	}
}
