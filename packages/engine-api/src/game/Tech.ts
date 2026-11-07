/**
 * The tech tree for "Advanced warfare" games (GameConfig.advancedWarfare).
 *
 * Players spend gold to research techs, one at a time; a tech takes
 * `researchTicks` to complete and needs every tech in `requires` first.
 * Effects are applied where the rule lives (Config / EngineConfig / the
 * executions) by checking `player.hasTech(...)`. Every number an effect
 * uses is here, so balance changes stay in one place.
 *
 * Tech ids are stored in snapshots and sent over the wire: never rename or
 * reuse one.
 */

export enum TechId {
  // Economy
  Banking = "banking",
  TradeNetworks = "trade_networks",
  Industrialization = "industrialization",
  GlobalMarkets = "global_markets",
  // Military
  Conscription = "conscription",
  Logistics = "logistics",
  ShockTroops = "shock_troops",
  Fortifications = "fortifications",
  // Naval
  Shipbuilding = "shipbuilding",
  ArmorPlating = "armor_plating",
  FastTransports = "fast_transports",
  NavalGunnery = "naval_gunnery",
  // Nuclear
  TacticalNukes = "tactical_nukes",
  Electromagnetics = "electromagnetics",
  RadiologicalWeapons = "radiological_weapons",
  MissilePropulsion = "missile_propulsion",
  EnhancedYield = "enhanced_yield",
  StealthWarheads = "stealth_warheads",
  MissileDefense = "missile_defense",
  MassProduction = "mass_production",
}

export enum TechBranch {
  Economy = "economy",
  Military = "military",
  Naval = "naval",
  Nuclear = "nuclear",
}

export interface TechDef {
  id: TechId;
  branch: TechBranch;
  /** 1-3; sets cost and research time. */
  tier: 1 | 2 | 3;
  requires: readonly TechId[];
}

/** Gold cost per tier. */
export const TECH_TIER_COST: Record<TechDef["tier"], bigint> = {
  1: 500_000n,
  2: 1_500_000n,
  3: 4_000_000n,
};

/** Research time per tier, in ticks (10 ticks = 1 second). */
export const TECH_TIER_TICKS: Record<TechDef["tier"], number> = {
  1: 20 * 10,
  2: 40 * 10,
  3: 60 * 10,
};

const T = (
  id: TechId,
  branch: TechBranch,
  tier: TechDef["tier"],
  requires: readonly TechId[] = [],
): TechDef => ({ id, branch, tier, requires });

export const TECHS: readonly TechDef[] = [
  T(TechId.Banking, TechBranch.Economy, 1),
  T(TechId.TradeNetworks, TechBranch.Economy, 2, [TechId.Banking]),
  T(TechId.Industrialization, TechBranch.Economy, 2, [TechId.Banking]),
  T(TechId.GlobalMarkets, TechBranch.Economy, 3, [
    TechId.TradeNetworks,
    TechId.Industrialization,
  ]),

  T(TechId.Conscription, TechBranch.Military, 1),
  T(TechId.Logistics, TechBranch.Military, 1),
  T(TechId.ShockTroops, TechBranch.Military, 2, [TechId.Conscription]),
  T(TechId.Fortifications, TechBranch.Military, 2, [TechId.Logistics]),

  T(TechId.Shipbuilding, TechBranch.Naval, 1),
  T(TechId.ArmorPlating, TechBranch.Naval, 2, [TechId.Shipbuilding]),
  T(TechId.FastTransports, TechBranch.Naval, 2, [TechId.Shipbuilding]),
  T(TechId.NavalGunnery, TechBranch.Naval, 3, [TechId.ArmorPlating]),

  T(TechId.TacticalNukes, TechBranch.Nuclear, 1),
  T(TechId.MissileDefense, TechBranch.Nuclear, 1),
  T(TechId.Electromagnetics, TechBranch.Nuclear, 2, [TechId.TacticalNukes]),
  T(TechId.RadiologicalWeapons, TechBranch.Nuclear, 2, [TechId.TacticalNukes]),
  T(TechId.MissilePropulsion, TechBranch.Nuclear, 2, [TechId.TacticalNukes]),
  T(TechId.MassProduction, TechBranch.Nuclear, 2, [TechId.TacticalNukes]),
  T(TechId.EnhancedYield, TechBranch.Nuclear, 3, [TechId.MissilePropulsion]),
  T(TechId.StealthWarheads, TechBranch.Nuclear, 3, [TechId.MissilePropulsion]),
];

const BY_ID = new Map<TechId, TechDef>(TECHS.map((t) => [t.id, t]));

export function techDef(id: TechId): TechDef {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown tech: ${id}`);
  return def;
}

export function techCost(id: TechId): bigint {
  return TECH_TIER_COST[techDef(id).tier];
}

export function techResearchTicks(id: TechId): number {
  return TECH_TIER_TICKS[techDef(id).tier];
}

/**
 * Effect sizes, as integer percents so rules can apply them with exact
 * integer math where the rule is integer (gold, costs) and as a plain
 * multiplier where it is already floating point.
 */
export const TECH_EFFECTS = {
  /** Banking: +% passive gold income. */
  bankingGoldPct: 15,
  /** Global Markets: a further +% passive gold income. */
  globalMarketsGoldPct: 25,
  /** Trade Networks: +% gold from trade ships and trains. */
  tradeNetworksGoldPct: 20,
  /** Industrialization: -% cost of cities, factories and ports. */
  industrializationDiscountPct: 20,
  /** Conscription: +% troop growth. */
  conscriptionGrowthPct: 10,
  /** Logistics: +% max troops. */
  logisticsMaxTroopsPct: 10,
  /** Shock Troops: -% troops the attacker loses per tile. */
  shockTroopsLossReductionPct: 15,
  /** Fortifications: +% attacker losses when attacking this player. */
  fortificationsDefensePct: 15,
  /** Shipbuilding: -% warship cost. */
  shipbuildingDiscountPct: 25,
  /** Armor Plating: +% warship max health. */
  armorPlatingHealthPct: 30,
  /** Fast Transports: transport ships move this many extra tiles per step. */
  fastTransportsExtraSpeed: 1,
  /** Naval Gunnery: +% warship shell damage. */
  navalGunneryDamagePct: 25,
  /** Missile Propulsion: +% nuke flight speed. */
  missilePropulsionSpeedPct: 30,
  /** Enhanced Yield: +% nuke blast radius. */
  enhancedYieldRadiusPct: 20,
  /** Stealth Warheads: -% of the range in which SAMs can target the nuke. */
  stealthWarheadsTargetablePct: 40,
  /** Missile Defense: +% SAM range. */
  missileDefenseRangePct: 20,
  /** Missile Defense: -% SAM reload time. */
  missileDefenseCooldownPct: 25,
  /** Mass Production: -% nuke cost. */
  massProductionDiscountPct: 25,
} as const;

/** Scale an integer amount up/down by an integer percent, rounding down. */
export function scalePct(amount: bigint, pct: number): bigint {
  return (amount * BigInt(100 + pct)) / 100n;
}
