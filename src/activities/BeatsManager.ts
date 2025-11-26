// activities/BeatsManager.ts

import type { GroupAccuracy } from "@wilco/shared/data";
import type { ClientBeatsEvent, ClientEvent } from "@wilco/shared/events";
import type { Socket } from "socket.io";
import { ActivityManager } from "./ActivityManager";

interface TapData {
	playerId: string;
	timestamp: number;
	groupId: string;
}

interface PlayerStats {
	playerId: string;
	nickname: string;
	groupId: string;
	taps: number[];
	accuracy: number;
}

export class BeatsManager extends ActivityManager {
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: We are ignoring this rule because we dont know yet if we need startTS here
	private startTimestamp: number | null = null;
	private currentRound: number = 0;
	private currentBPM: number = 120;
	private taps: TapData[] = [];
	private roundStartTime: number = 0;
	private syncUpdateInterval: NodeJS.Timeout | null = null;

	// Timeline constants (in milliseconds)
	private readonly INSTRUCTIONS_DURATION = 38000; // 38s
	private readonly ROUND_1_BEAT = 10000; // 10s
	private readonly ROUND_1_MELODY = 5000; // 5s
	private readonly ROUND_2_BEAT = 5000; // 5s
	private readonly ROUND_2_MELODY = 10000; // 10s
	private readonly ROUND_3_BEAT = 5000; // 5s
	private readonly ROUND_3_MELODY = 10000; // 10s
	private readonly RESULTS_DURATION = 10000; // 10s

	// BPM progression
	private readonly BPM_ROUND_1 = 96;
	private readonly BPM_ROUND_2 = 116;
	private readonly BPM_ROUND_3 = 136;

	onActivityStart(): void {
		console.log("[BeatsManager] Beats activity started");
		this.startTimestamp = Date.now();
		this.taps = [];
		this.currentRound = 0;

		// Start with instructions phase
		this.startInstructions();
	}

	onActivityEnd(): void {
		console.log("[BeatsManager] Beats activity ended");
		this.startTimestamp = null;
		this.taps = [];
		if (this.syncUpdateInterval) {
			clearInterval(this.syncUpdateInterval);
			this.syncUpdateInterval = null;
		}
	}

	handleClientEvent(socket: Socket, event: ClientEvent): void {
		if (!this.isBeatsEvent(event)) return;

		switch (event.type) {
			case "tap": {
				const player = this.state.getPlayer(socket.id);
				if (player?.groupId) {
					this.taps.push({
						playerId: socket.id,
						timestamp: event.timestamp,
						groupId: player.groupId,
					});
					console.log(
						`[BeatsManager] Tap from ${player.nickname} (Team ${player.groupId}) at ${event.timestamp}`,
					);
				}
				break;
			}
            default:
                break;
		}
	}


	private isBeatsEvent(event: ClientEvent): event is ClientBeatsEvent {
		return event.type === "tap" || event.type === "reaction";
	}

	private startInstructions(): void {
		console.log("[BeatsManager] Phase: Instructions");
		this.broadcast({
			type: "beat_phase_change",
			phase: "instructions",
			round: 0,
			bpm: this.BPM_ROUND_1,
		});

		setTimeout(() => {
			this.startRound1Beat();
		}, this.INSTRUCTIONS_DURATION);
	}

	private startRound1Beat(): void {
		console.log("[BeatsManager] Round 1 - Beat ON");
		this.currentRound = 1;
		this.currentBPM = this.BPM_ROUND_1;
		this.roundStartTime = Date.now();

		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_on",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		setTimeout(() => {
			this.startRound1Melody();
		}, this.ROUND_1_BEAT);
	}

	private startRound1Melody(): void {
		console.log("[BeatsManager] Round 1 - Beat OFF (melody only)");
		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_off",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		// Start broadcasting sync updates every 100ms
		this.startSyncUpdates();

		setTimeout(() => {
			this.stopSyncUpdates();
			this.startRound2Beat();
		}, this.ROUND_1_MELODY);
	}

	private startRound2Beat(): void {
		console.log("[BeatsManager] Round 2 - Beat ON (FASTER)");
		this.currentRound = 2;
		this.currentBPM = this.BPM_ROUND_2;
		this.roundStartTime = Date.now();

		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_on",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		setTimeout(() => {
			this.startRound2Melody();
		}, this.ROUND_2_BEAT);
	}

	private startRound2Melody(): void {
		console.log("[BeatsManager] Round 2 - Beat OFF (melody only)");
		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_off",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		this.startSyncUpdates();

		setTimeout(() => {
			this.stopSyncUpdates();
			this.startRound3Beat();
		}, this.ROUND_2_MELODY);
	}

	private startRound3Beat(): void {
		console.log("[BeatsManager] Round 3 - Beat ON (FASTEST)");
		this.currentRound = 3;
		this.currentBPM = this.BPM_ROUND_3;
		this.roundStartTime = Date.now();

		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_on",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		setTimeout(() => {
			this.startRound3Melody();
		}, this.ROUND_3_BEAT);
	}

	private startRound3Melody(): void {
		console.log("[BeatsManager] Round 3 - Beat OFF (melody only)");
		this.broadcast({
			type: "beat_phase_change",
			phase: "beat_off",
			round: this.currentRound,
			bpm: this.currentBPM,
		});

		this.startSyncUpdates();

		setTimeout(() => {
			this.stopSyncUpdates();
			this.showResults();
		}, this.ROUND_3_MELODY);
	}

	private startSyncUpdates(): void {
		this.syncUpdateInterval = setInterval(() => {
			const groupAccuracies = this.calculateGroupAccuracies();
			this.broadcast({
				type: "beat_team_sync_update",
				groupAccuracies,
			});
		}, 100);
	}

	private stopSyncUpdates(): void {
		if (this.syncUpdateInterval) {
			clearInterval(this.syncUpdateInterval);
			this.syncUpdateInterval = null;
		}
	}

	private calculateGroupAccuracies(): GroupAccuracy[] {
		const groups = ["A", "B", "C", "D"];
		const groupAccuracies: GroupAccuracy[] = [];

		for (const groupId of groups) {
			const groupTaps = this.taps.filter((tap) => tap.groupId === groupId);

			if (groupTaps.length === 0) {
				groupAccuracies.push({
					groupId,
					accuracy: 0,
					avgOffset: 0,
					tapCount: 0,
				});
				continue;
			}

			// Calculate expected beat times based on BPM
			const beatInterval = (60 / this.currentBPM) * 1000; // Convert BPM to ms
			const offsets: number[] = [];

			for (const tap of groupTaps) {
				// Find the nearest expected beat time
				const timeSinceStart = tap.timestamp - this.roundStartTime;
				const nearestBeat =
					Math.round(timeSinceStart / beatInterval) * beatInterval;
				const offset = Math.abs(timeSinceStart - nearestBeat);
				offsets.push(offset);
			}

			// Calculate average offset
			const avgOffset =
				offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length;

			// Convert offset to accuracy (0-1 scale)
			// Perfect timing (0ms offset) = 1.0 accuracy
			// 500ms+ offset = 0.0 accuracy
			const maxOffset = 500;
			const accuracy = Math.max(0, 1 - avgOffset / maxOffset);

			groupAccuracies.push({
				groupId,
				accuracy,
				avgOffset,
				tapCount: groupTaps.length,
			});
		}

		return groupAccuracies;
	}

	private calculatePlayerStats(): PlayerStats[] {
		const playerStatsMap = new Map<string, PlayerStats>();

		for (const tap of this.taps) {
			const player = this.state.getPlayer(tap.playerId);
			if (!player) continue;

			if (!playerStatsMap.has(tap.playerId)) {
				playerStatsMap.set(tap.playerId, {
					playerId: tap.playerId,
					nickname: player.nickname,
					groupId: tap.groupId,
					taps: [],
					accuracy: 0,
				});
			}

			playerStatsMap.get(tap.playerId)?.taps.push(tap.timestamp);
		}

		// Calculate accuracy for each player
		const beatInterval = (60 / this.currentBPM) * 1000;
		for (const [_, stats] of playerStatsMap) {
			const offsets: number[] = [];

			for (const tapTime of stats.taps) {
				const timeSinceStart = tapTime - this.roundStartTime;
				const nearestBeat =
					Math.round(timeSinceStart / beatInterval) * beatInterval;
				const offset = Math.abs(timeSinceStart - nearestBeat);
				offsets.push(offset);
			}

			const avgOffset =
				offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length;
			const maxOffset = 500;
			stats.accuracy = Math.max(0, 1 - avgOffset / maxOffset);
		}

		return Array.from(playerStatsMap.values());
	}

	private showResults(): void {
		console.log("[BeatsManager] Showing results");

		const groupAccuracies = this.calculateGroupAccuracies();
		const playerStats = this.calculatePlayerStats();

		// Find winning team (highest accuracy)
		const winner = groupAccuracies.reduce((best, current) =>
			current.accuracy > best.accuracy ? current : best,
		);

		// Find MVP (player with highest individual accuracy)
		const mvp = playerStats.reduce(
			(best, current) => (current.accuracy > best.accuracy ? current : best),
			playerStats[0] || {
				playerId: "",
				nickname: "No MVP",
				groupId: "",
				taps: [],
				accuracy: 0,
			},
		);

		this.broadcast({
			type: "beat_results",
			winner: winner.groupId,
			groupAccuracies,
			mvp: {
				playerId: mvp.playerId,
				nickname: mvp.nickname,
				accuracy: mvp.accuracy,
			},
		});

		console.log(
			`[BeatsManager] Winner: Team ${winner.groupId} (${Math.round(winner.accuracy * 100)}%)`,
		);
		console.log(
			`[BeatsManager] MVP: ${mvp.nickname} (${Math.round(mvp.accuracy * 100)}%)`,
		);

		// Return to lobby after results
		setTimeout(() => {
			this.state.setActivity("lobby");
		}, this.RESULTS_DURATION);
	}
}
