import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  TECHS,
  techCost,
  TechId,
  techResearchTicks,
} from "@openfront/engine-api/game/Tech";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

async function game(config: Partial<GameConfig> = {}) {
  const g = await setup("plains", {
    advancedWarfare: true,
    instantBuild: false,
    ...config,
  });
  const info = new PlayerInfo("p1", PlayerType.Human, "client1", "p1");
  g.addPlayer(info);
  g.addExecution(new SpawnExecution("game_id", info, g.ref(10, 10)));
  while (g.inSpawnPhase()) g.executeNextTick();
  executeTicks(g, 2);
  return { g, player: g.player(info.id) };
}

function research(g: Game, player: Player, tech: TechId) {
  g.addExecution(new ResearchExecution(player, tech));
  g.executeNextTick();
}

describe("Tech tree definitions", () => {
  test("ids are unique and every prerequisite is an earlier tier", () => {
    const ids = new Set(TECHS.map((t) => t.id));
    expect(ids.size).toBe(TECHS.length);
    expect(ids.size).toBe(Object.values(TechId).length);
    for (const t of TECHS) {
      for (const r of t.requires) {
        const req = TECHS.find((x) => x.id === r)!;
        expect(req.tier).toBeLessThan(t.tier);
      }
    }
  });
});

describe("Research", () => {
  test("costs gold, takes time, then grants the tech", async () => {
    const { g, player } = await game();
    player.addGold(10_000_000n);
    const gold = player.gold();

    research(g, player, TechId.Banking);
    // Paid the cost (plus a tick of passive income).
    const spent = gold - player.gold();
    expect(spent).toBeGreaterThan(techCost(TechId.Banking) - 1_000n);
    expect(spent).toBeLessThanOrEqual(techCost(TechId.Banking));
    expect(player.activeResearch()?.tech).toBe(TechId.Banking);
    expect(player.hasTech(TechId.Banking)).toBe(false);

    executeTicks(g, techResearchTicks(TechId.Banking) - 2);
    expect(player.hasTech(TechId.Banking)).toBe(false);
    executeTicks(g, 2);
    expect(player.hasTech(TechId.Banking)).toBe(true);
    expect(player.activeResearch()).toBeNull();
    expect(player.techs()).toEqual([TechId.Banking]);

    // The client sees it through the player update.
    const update = (
      player as unknown as { toFullUpdate(): ReturnType<Player["toUpdate"]> }
    ).toFullUpdate()!;
    expect(update.techs).toEqual([TechId.Banking]);
    expect(update.research).toBeNull();
  });

  test("blocks: prerequisites, busy, gold, already researched", async () => {
    const { g, player } = await game();
    expect(player.researchBlocker(TechId.Banking)).toBe("gold");
    player.addGold(10_000_000n);
    expect(player.researchBlocker(TechId.GlobalMarkets)).toBe("prerequisites");

    research(g, player, TechId.Banking);
    expect(player.researchBlocker(TechId.Conscription)).toBe("busy");
    // A second research while busy is ignored and charges nothing.
    const gold = player.gold();
    research(g, player, TechId.Conscription);
    expect(player.gold()).toBeGreaterThanOrEqual(gold);
    expect(player.activeResearch()?.tech).toBe(TechId.Banking);

    executeTicks(g, techResearchTicks(TechId.Banking));
    expect(player.researchBlocker(TechId.Banking)).toBe("researched");
    expect(player.researchBlocker(TechId.TradeNetworks)).toBeNull();
  });

  test("is unavailable outside advanced warfare games", async () => {
    const { g, player } = await game({ advancedWarfare: false });
    player.addGold(10_000_000n);
    expect(player.researchBlocker(TechId.Banking)).toBe("disabled");
    research(g, player, TechId.Banking);
    expect(player.activeResearch()).toBeNull();
    expect(player.gold()).toBeGreaterThanOrEqual(10_000_000n);
  });

  test("survives a snapshot round trip mid-research", async () => {
    const { g, player } = await game();
    player.addGold(10_000_000n);
    research(g, player, TechId.Banking);
    executeTicks(g, techResearchTicks(TechId.Banking));
    research(g, player, TechId.TradeNetworks);
    executeTicks(g, 5);
    const restored = await expectSnapshotRoundTrip(g, "plains", 10);
    const p = restored.player(player.id());
    expect(p.techs()).toEqual([TechId.Banking]);
    expect(p.activeResearch()?.tech).toBe(TechId.TradeNetworks);
  });
});
