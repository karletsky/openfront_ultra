import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TerrainType } from "@openfront/engine-api/game/GameTypes";
import { TECH_EFFECTS, TechId } from "@openfront/engine-api/game/Tech";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

async function game() {
  const g = await setup("plains", { advancedWarfare: true });
  const a = new PlayerInfo("a", PlayerType.Human, "ca", "a");
  const b = new PlayerInfo("b", PlayerType.Human, "cb", "b");
  g.addPlayer(a);
  g.addPlayer(b);
  g.addExecution(
    new SpawnExecution("game_id", a, g.ref(10, 10)),
    new SpawnExecution("game_id", b, g.ref(40, 40)),
  );
  while (g.inSpawnPhase()) g.executeNextTick();
  executeTicks(g, 2);
  return { g, a: g.player(a.id), b: g.player(b.id) };
}

/** The real rules (the test config flattens attack logic and nuke stats). */
function real(g: Game): EngineConfig {
  return new EngineConfig(g.config().gameConfig(), false);
}

/** Grant a tech directly (research itself is covered by Research.test.ts). */
function grant(player: Player, tech: TechId) {
  (player as unknown as { _techs: Set<TechId> })._techs.add(tech);
}

/** `value` before vs after granting `tech`. */
function beforeAfter<T>(player: Player, tech: TechId, value: () => T): [T, T] {
  const before = value();
  grant(player, tech);
  return [before, value()];
}

describe("Tech effects", () => {
  let g: Game;
  let a: Player;
  let b: Player;
  beforeEach(async () => {
    ({ g, a, b } = await game());
  });

  test("Banking and Global Markets raise passive gold income", () => {
    const base = g.config().goldAdditionRate(a);
    grant(a, TechId.Banking);
    const banking = g.config().goldAdditionRate(a);
    expect(banking).toBe(
      (base * BigInt(100 + TECH_EFFECTS.bankingGoldPct)) / 100n,
    );
    grant(a, TechId.GlobalMarkets);
    expect(g.config().goldAdditionRate(a)).toBeGreaterThan(banking);
    // Other players are unaffected.
    expect(g.config().goldAdditionRate(b)).toBe(base);
  });

  test("Trade Networks raises trade-ship and train gold", () => {
    const [ship0, ship1] = beforeAfter(a, TechId.TradeNetworks, () =>
      g.config().tradeShipGold(300, a),
    );
    expect(ship1).toBe((ship0 * 120n) / 100n);
    expect(g.config().trainGold("other", 0, a)).toBeGreaterThan(
      g.config().trainGold("other", 0, b),
    );
  });

  test("cost discounts: Industrialization, Shipbuilding, Mass Production", () => {
    const cost = (t: UnitType) => g.config().unitInfo(t).cost(g, a);
    for (const [tech, type, pct] of [
      [
        TechId.Industrialization,
        UnitType.City,
        TECH_EFFECTS.industrializationDiscountPct,
      ],
      [
        TechId.Shipbuilding,
        UnitType.Warship,
        TECH_EFFECTS.shipbuildingDiscountPct,
      ],
      [
        TechId.MassProduction,
        UnitType.AtomBomb,
        TECH_EFFECTS.massProductionDiscountPct,
      ],
    ] as const) {
      const [before, after] = beforeAfter(a, tech, () => cost(type));
      expect(after).toBe((before * BigInt(100 - pct)) / 100n);
    }
  });

  test("Conscription and Logistics raise troop growth and the troop cap", () => {
    const [cap0, cap1] = beforeAfter(a, TechId.Logistics, () =>
      g.config().maxTroops(a),
    );
    expect(cap1).toBeCloseTo(cap0 * 1.1, 6);
    const [grow0, grow1] = beforeAfter(b, TechId.Conscription, () =>
      g.config().troopIncreaseRate(b),
    );
    expect(grow1).toBeGreaterThan(grow0);
  });

  test("Shock Troops and Fortifications scale attacker losses", () => {
    const input = (mult?: number) => ({
      terrain: TerrainType.Plains,
      attackTroops: 10_000,
      attacker: { type: PlayerType.Human, numTiles: 500 },
      defender: {
        type: PlayerType.Human,
        numTiles: 500,
        troops: 20_000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      falloutRatio: null,
      borderSize: 10,
      attackerLossMultiplier: mult,
    });
    const c = real(g);
    const base = c.attackLogic(input()).attackerTroopLoss;
    const shock = c.attackLogic(input(0.85)).attackerTroopLoss;
    expect(shock).toBeCloseTo(base * 0.85, 9);
    // Absent multiplier is exactly the old behaviour.
    expect(c.attackLogic(input(1)).attackerTroopLoss).toBe(base);
  });

  test("Armor Plating raises warship max health; Amphibious adds boats", () => {
    const tile = Array.from(a.tiles())[0];
    const base = g.config().unitInfo(UnitType.Warship).maxHealth!;
    expect(
      a.buildUnit(UnitType.Warship, tile, { patrolTile: tile }).maxHealth(),
    ).toBe(base);
    grant(a, TechId.ArmorPlating);
    const armored = a.buildUnit(UnitType.Warship, tile, { patrolTile: tile });
    expect(armored.maxHealth()).toBe(Math.floor((base * 130) / 100));
    expect(armored.health()).toBe(armored.maxHealth());

    const [boats0, boats1] = beforeAfter(a, TechId.Amphibious, () =>
      g.config().boatMaxNumber(a),
    );
    expect(boats1).toBe(boats0 + TECH_EFFECTS.amphibiousExtraBoats);
  });

  test("nuclear techs: speed, yield, stealth, SAM range and reload", () => {
    const c = real(g);
    const [speed0, speed1] = beforeAfter(a, TechId.MissilePropulsion, () =>
      c.nukeSpeed(UnitType.AtomBomb, a),
    );
    expect(speed1).toBe(13);
    expect(speed0).toBe(10);

    const [yield0, yield1] = beforeAfter(a, TechId.EnhancedYield, () =>
      c.nukeMagnitudes(UnitType.AtomBomb, a),
    );
    expect(yield1.outer).toBe(Math.floor((yield0.outer * 120) / 100));
    // Without an owner (AI planning) the base radii are used.
    expect(c.nukeMagnitudes(UnitType.AtomBomb)).toEqual(yield0);

    const [stealth0, stealth1] = beforeAfter(a, TechId.StealthWarheads, () =>
      c.defaultNukeTargetableRange(a),
    );
    expect(stealth1).toBe(Math.floor(stealth0 * 0.6));

    const [reload0, reload1] = beforeAfter(b, TechId.MissileDefense, () =>
      c.SAMCooldown(b),
    );
    expect(reload1).toBeLessThan(reload0);
    const sam = b.buildUnit(UnitType.SAMLauncher, Array.from(b.tiles())[0], {});
    expect(c.dynamicSamRange(sam, g.ticks())).toBeCloseTo(
      c.samRange(sam.level()) * 1.2,
      9,
    );
  });
});
