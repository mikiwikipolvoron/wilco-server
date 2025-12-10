// activities/ARManager.ts

import type { ARItem, ARPhase } from "@mikiwikipolvoron/wilco-lib/data";
import {
	CLIENT_AR_EVENTS,
	type ClientAREvent,
	type ClientEvent,
} from "@mikiwikipolvoron/wilco-lib/events";
import type { Socket } from "socket.io";
import { ActivityManager } from "./ActivityManager";

export class ARManager extends ActivityManager {
	// State
	private phase: ARPhase = "anchoring";
	private anchoredPlayers: Set<string> = new Set();
	private items: ARItem[] = [];
	private totalTaps = 0;
	private playerTaps: Map<string, number> = new Map(); // Track taps per player
	private bossHealth = 0;
	private calibratedAlpha: number | null = null; // Store calibrated compass heading
	private calibratedBeta: number | null = null; // Store calibrated tilt angle

	// Constants
	private readonly ANCHORING_DURATION = 10000; // 30s to scan marker
	private readonly SMALL_ITEMS_COUNT = 1; // Only 1 item at a time
	private readonly TAPS_PER_PLAYER = 10; // Each player must tap 10 items
	private readonly BOSS_MAX_HEALTH = 30; // 30 taps to defeat boss
	private readonly RESULTS_DURATION = 10_000; // 1s quick transition to lobby
	private readonly BOSS_SCALE = 3.0;

	// Instruction slides
	private readonly instructionSlides = [
		"[AR] Dressing Room Challenge",
		"[AR] Use your phone camera to find and collect items around you.",
		"[AR] Point your camera at the screen to calibrate your device.",
	];

	// Timers
	private instructionsTimer: NodeJS.Timeout | null = null;

	// Calculated dynamically
	private getTotalTapsNeeded(): number {
		return this.anchoredPlayers.size * this.TAPS_PER_PLAYER;
	}

	onActivityStart(): void {
		this.anchoredPlayers.clear();
		this.items = [];
		this.totalTaps = 0;
		this.playerTaps.clear();
		this.calibratedAlpha = null;
		this.calibratedBeta = null;

		console.log("[ARManager] AR activity started - showing instructions");

		// Start with instructions
		this.runInstructionSet(() => this.startAnchoring());
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (!this.isAREvent(event)) {
			console.log(
				`[ARManager] Ignoring non-AR event: ${event.type} from ${socket.id}`,
			);
			return;
		}

		switch (event.type) {
			case "anchor_success": {
				console.log(
					`[ARManager] Received anchor_success from ${socket.id}, current phase: ${this.phase}`,
				);
				this.anchoredPlayers.add(socket.id);

				// Store the first player's calibration as the reference
				if (this.calibratedAlpha === null && this.calibratedBeta === null) {
					this.calibratedAlpha = event.alpha;
					this.calibratedBeta = event.beta;
					console.log(
						`[ARManager] Calibration set: Alpha=${event.alpha.toFixed(0)}°, Beta=${event.beta.toFixed(0)}°`,
					);
				}

				const player = this.state.getPlayer(socket.id);
				console.log(
					`[ARManager] ${player?.nickname || socket.id} anchored (${this.anchoredPlayers.size} total anchored players)`,
				);
				break;
			}

			case "tap_item": {
				if (!this.anchoredPlayers.has(socket.id)) {
					console.log(
						`[ARManager] Non-anchored player tried to tap: ${socket.id}`,
					);
					return;
				}
				// Ignore taps during results phase (prevents infinite loop after boss dies)
				if (this.phase === "results") {
					return;
				}
				this.handleItemTap(socket.id, event.itemId);
				break;
			}

			case "reaction": {
				console.log("[ARManager] Reaction from", socket.id, ":", event.emoji);
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

	private startHunting(): void {
		this.phase = "hunting";
		this.spawnSmallItems();

		this.broadcast({
			type: "ar_phase_change",
			phase: "hunting",
		});

		// Broadcast initial progress so entertainer knows tapsNeeded immediately
		const tapsNeeded = this.getTotalTapsNeeded();
		this.broadcast({
			type: "ar_item_collected",
			itemId: "", // No item collected yet, just initial state
			tapCount: 0,
			tapsNeeded: tapsNeeded,
		});

		console.log(
			`[ARManager] Hunting phase started with ${this.anchoredPlayers.size} anchored players (${tapsNeeded} taps needed)`,
		);
	}

	private spawnSmallItems(): void {
		this.items = [];

		for (let i = 0; i < this.SMALL_ITEMS_COUNT; i++) {
			this.items.push({
				id: `item-${Date.now()}-${i}`,
				type: "small",
				position: this.generateRandomPosition(),
				scale: 1.0,
			});
		}

		console.log(
			`[ARManager] Broadcasting ${this.items.length} items to clients:`,
			this.items.map((item) => `${item.id} at (${item.position.x.toFixed(1)}, ${item.position.y.toFixed(1)}, ${item.position.z.toFixed(1)})`),
		);

		this.broadcast({
			type: "ar_items_update",
			items: this.items,
		});
	}

	private generateRandomPosition(): { x: number; y: number; z: number } {
		// Semi-circle in front of marker
		const radius = 2 + Math.random() * 3; // 2-5 units from marker
		const angle = Math.random() * Math.PI - Math.PI / 2; // -90° to +90° (front hemisphere)
		const height = 0.5 + Math.random() * 1.5; // 0.5-2m height

		return {
			x: radius * Math.cos(angle),
			y: height,
			z: radius * Math.sin(angle),
		};
	}

	private handleItemTap(playerId: string, itemId: string): void {
		const item = this.items.find((i) => i.id === itemId);
		if (!item) return;

		if (item.type === "small") {
			this.totalTaps++;

			// Track individual player taps
			const currentPlayerTaps = this.playerTaps.get(playerId) || 0;
			this.playerTaps.set(playerId, currentPlayerTaps + 1);

			const tapsNeeded = this.getTotalTapsNeeded();
			const player = this.state.getPlayer(playerId);

			console.log(
				`[ARManager] ${player?.nickname || playerId} tapped item (${currentPlayerTaps + 1}/10 personal, ${this.totalTaps}/${tapsNeeded} total)`,
			);

			// Broadcast item collected
			this.broadcast({
				type: "ar_item_collected",
				itemId: item.id,
				tapCount: this.totalTaps,
				tapsNeeded: tapsNeeded,
			});

			// Check if boss should spawn FIRST (all players have tapped at least 10 items)
			const allPlayersReachedMinimum = Array.from(this.anchoredPlayers).every(
				(playerId) =>
					(this.playerTaps.get(playerId) || 0) >= this.TAPS_PER_PLAYER,
			);

			if (allPlayersReachedMinimum && this.phase === "hunting") {
				console.log(
					"[ARManager] All players reached 10 taps! Spawning boss...",
				);
				this.spawnBoss();
				return; // Don't respawn item, boss is spawning
			}

			// Respawn item at new location (only if boss isn't spawning)
			item.id = `item-${Date.now()}-${Math.random()}`;
			item.position = this.generateRandomPosition();

			this.broadcast({
				type: "ar_items_update",
				items: this.items,
			});
		} else if (item.type === "boss") {
			this.bossHealth = Math.max(0, this.bossHealth - 1);

			this.broadcast({
				type: "ar_boss_health",
				health: this.bossHealth,
				maxHealth: this.BOSS_MAX_HEALTH,
			});

			console.log(
				`[ARManager] Boss tapped! Health: ${this.bossHealth}/${this.BOSS_MAX_HEALTH}`,
			);

			if (this.bossHealth === 0) {
				this.completeActivity();
			}
		}
	}

	private spawnBoss(): void {
		this.phase = "boss";
		this.bossHealth = this.BOSS_MAX_HEALTH;

		// Remove small items, add boss in center
		this.items = [
			{
				id: `boss-${Date.now()}`,
				type: "boss",
				position: { x: 0, y: 1.5, z: -3 }, // Center, in front of marker
				scale: this.BOSS_SCALE,
				health: this.BOSS_MAX_HEALTH,
			},
		];

		this.broadcast({
			type: "ar_phase_change",
			phase: "boss",
		});

		this.broadcast({
			type: "ar_items_update",
			items: this.items,
		});

		this.broadcast({
			type: "ar_boss_health",
			health: this.bossHealth,
			maxHealth: this.BOSS_MAX_HEALTH,
		});

		console.log("[ARManager] Boss spawned!");
	}

	private completeActivity(): void {
		this.phase = "results";
		this.items = [];

		this.broadcast({
			type: "ar_phase_change",
			phase: "results",
		});

		// Broadcast empty items array to remove boss from client viewports
		this.broadcast({
			type: "ar_items_update",
			items: this.items,
		});

		this.broadcast({
			type: "ar_results",
			totalTaps: this.totalTaps,
			participatingPlayers: this.anchoredPlayers.size,
		});

		console.log(
			`[ARManager] Activity complete! Total taps: ${this.totalTaps}, Players: ${this.anchoredPlayers.size}`,
		);

		setTimeout(() => {
			this.state.setActivity("lobby");
		}, this.RESULTS_DURATION);
	}

	onActivityEnd(): void {
		this.items = [];
		this.anchoredPlayers.clear();
		this.totalTaps = 0;
		this.playerTaps.clear();
		this.calibratedAlpha = null;
		this.calibratedBeta = null;
		if (this.instructionsTimer) {
			clearTimeout(this.instructionsTimer);
			this.instructionsTimer = null;
		}
		console.log("[ARManager] AR activity ended");
	}

	onPlayerDisconnect(playerId: string): void {
		// Remove from anchored players set
		const wasAnchored = this.anchoredPlayers.has(playerId);
		this.anchoredPlayers.delete(playerId);

		// Remove from player taps map
		this.playerTaps.delete(playerId);

		console.log(
			`[ARManager] Player ${playerId} disconnected, removed from activity state (was anchored: ${wasAnchored})`,
		);
	}

	private runInstructionSet(onComplete: () => void): void {
		this.broadcast({
			type: "ar_phase_change",
			phase: "instructions",
		});
		this.phase = "instructions";

		let delay = 0;
		this.instructionSlides.forEach((text, idx) => {
			const durationMs = this.computeReadingDurationMs(text);
			const slide = idx + 1;
			delay += idx === 0 ? 0 : this.computeReadingDurationMs(this.instructionSlides[idx - 1]);
			this.instructionsTimer = setTimeout(() => {
				this.broadcast({
					type: "ar_instruction",
					phase: "instructions",
					slide,
					totalSlides: this.instructionSlides.length,
					text,
					durationMs,
				});
			}, delay);
		});

		const totalDuration =
			this.instructionSlides.reduce(
				(acc, text) => acc + this.computeReadingDurationMs(text),
				0,
			) + 500;
		this.instructionsTimer = setTimeout(() => onComplete(), totalDuration);
	}

	private startAnchoring(): void {
		this.phase = "anchoring";

		this.broadcast({
			type: "ar_phase_change",
			phase: "anchoring",
		});

		console.log("[ARManager] Anchoring phase started");

		// Auto-start hunting after anchoring period
		setTimeout(() => this.startHunting(), this.ANCHORING_DURATION);
	}

	private computeReadingDurationMs(text: string): number {
		const words = text.trim().split(/\s+/).filter(Boolean).length;
		const minutes = words / 150;
		return Math.max(3000, Math.round(minutes * 60_000));
	}

	private isAREvent(event: ClientEvent): event is ClientAREvent {
		return CLIENT_AR_EVENTS.some((et) => et === event.type);
	}
}
