import { TechId } from "@openfront/engine-api/game/Tech";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * Advanced warfare: start researching a tech (one-shot). The player pays
 * up front; PlayerExecution completes the research when it is due.
 */
export class ResearchExecution implements Execution {
  constructor(
    private player: Player,
    private tech: TechId,
  ) {}

  init(mg: Game, ticks: number): void {
    const blocker = this.player.researchBlocker(this.tech);
    if (blocker !== null) {
      console.warn(
        `[ResearchExecution] ${this.player.id()} cannot research ${this.tech}: ${blocker}`,
      );
      return;
    }
    this.player.startResearch(this.tech);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ResearchExecutionSnapshot.write({
      player: w.player(this.player),
      tech: this.tech,
    });
  }

  restoreSnapshot(s: ResearchState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.tech = s.tech;
  }
}

const ResearchStateSchema = z.object({
  player: zPlayerRef(),
  tech: z.enum(TechId),
});
type ResearchState = z.infer<typeof ResearchStateSchema>;

export const ResearchExecutionSnapshot = execSnapshotType({
  name: "Research",
  version: 1,
  schema: ResearchStateSchema,
  cls: () => ResearchExecution,
});
