// activities/ARManager.ts

import type { ARItem, ARPhase } from "@wilco/shared/data";
import { CLIENT_AR_EVENTS, type ClientAREvent, type ClientEvent } from "@wilco/shared/events";
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

	// Constants
	private readonly ANCHORING_DURATION = 10000; // 30s to scan marker
	private readonly SMALL_ITEMS_COUNT = 5; // 5 items at once
	private readonly TAPS_PER_PLAYER = 10; // Each player must tap 10 items
	private readonly BOSS_MAX_HEALTH = 30; // 30 taps to defeat boss
	private readonly RESULTS_DURATION = 10000; // 10s results screen
	private readonly BOSS_SCALE = 3.0;

	// Calculated dynamically
	private getTotalTapsNeeded(): number {
		return this.anchoredPlayers.size * this.TAPS_PER_PLAYER;
	}

	onActivityStart(): void {
		this.phase = "anchoring";
		this.anchoredPlayers.clear();
		this.items = [];
		this.totalTaps = 0;
		this.playerTaps.clear();

		this.broadcast({
			type: "ar_phase_change",
			phase: "anchoring",
		});

		console.log("[ARManager] AR activity started - anchoring phase");

		// Auto-start hunting after anchoring period
		setTimeout(() => this.startHunting(), this.ANCHORING_DURATION);
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (!this.isAREvent(event)) return;

		switch (event.type) {
			case "anchor_success": {
				this.anchoredPlayers.add(socket.id);
				const player = this.state.getPlayer(socket.id);
				console.log(
					`[ARManager] ${player?.nickname || socket.id} anchored (${this.anchoredPlayers.size} total)`,
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

		console.log(
			`[ARManager] Hunting phase started with ${this.anchoredPlayers.size} anchored players`,
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

			// Respawn item at new location
			item.id = `item-${Date.now()}-${Math.random()}`;
			item.position = this.generateRandomPosition();

			this.broadcast({
				type: "ar_items_update",
				items: this.items,
			});

			// Check if boss should spawn (all players have tapped at least 10 items)
			const allPlayersReachedMinimum = Array.from(this.anchoredPlayers).every(
				(playerId) =>
					(this.playerTaps.get(playerId) || 0) >= this.TAPS_PER_PLAYER,
			);

			if (allPlayersReachedMinimum && this.phase === "hunting") {
				console.log(
					"[ARManager] All players reached 10 taps! Spawning boss...",
				);
				this.spawnBoss();
			}
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
		console.log("[ARManager] AR activity ended");
	}

	private isAREvent(event: ClientEvent): event is ClientAREvent {
		return CLIENT_AR_EVENTS.some(et => et === event.type)
    }
}
