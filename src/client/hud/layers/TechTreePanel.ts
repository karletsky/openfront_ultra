import {
  TechBranch,
  TechDef,
  TechId,
  TECHS,
} from "@openfront/engine-api/game/Tech";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { SendResearchIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

const BRANCHES: readonly TechBranch[] = [
  TechBranch.Economy,
  TechBranch.Military,
  TechBranch.Naval,
  TechBranch.Nuclear,
];

const BRANCH_ICONS: Record<TechBranch, string> = {
  [TechBranch.Economy]: "💰",
  [TechBranch.Military]: "⚔️",
  [TechBranch.Naval]: "⚓",
  [TechBranch.Nuclear]: "☢️",
};

type TechStatus = "researched" | "researching" | "available" | "locked";

/**
 * Advanced warfare research panel: a "Research" button (with the active
 * research's progress) that opens the tech tree. Renders nothing unless the
 * game has advanced warfare on.
 */
@customElement("tech-tree-panel")
export class TechTreePanel extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state() private open = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.requestUpdate();
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    if (this.enabled()) this.requestUpdate();
  }

  private enabled(): boolean {
    return this.game?.config().advancedWarfare() ?? false;
  }

  private me(): PlayerView | null {
    const p = this.game?.myPlayer();
    return p && p.isAlive() ? p : null;
  }

  private status(p: PlayerView, t: TechDef): TechStatus {
    if (p.hasTech(t.id)) return "researched";
    if (p.activeResearch()?.tech === t.id) return "researching";
    return t.requires.every((r) => p.hasTech(r)) ? "available" : "locked";
  }

  private progress(p: PlayerView): number {
    const r = p.activeResearch();
    if (r === null) return 0;
    const span = Math.max(1, r.endTick - r.startTick);
    return Math.min(1, Math.max(0, (this.game.ticks() - r.startTick) / span));
  }

  private research(tech: TechId) {
    this.eventBus.emit(new SendResearchIntentEvent(tech));
  }

  private toggle = () => {
    this.open = !this.open;
  };

  render() {
    if (!this.enabled()) return nothing;
    const p = this.me();
    if (p === null) return nothing;
    const active = p.activeResearch();
    return html`
      <div class="fixed bottom-28 left-2 z-1000 pointer-events-auto">
        <button
          id="tech-tree-toggle"
          class="flex flex-col items-start gap-1 rounded-lg bg-slate-900/85 border border-white/15 px-3 py-2 text-white text-sm shadow-lg hover:bg-slate-800"
          @click=${this.toggle}
        >
          <span class="font-semibold"
            >🔬 ${translateText("tech_tree.button")}</span
          >
          ${
            active
              ? html`<span class="text-xs text-white/80"
                    >${translateText(`tech.${active.tech}.name`)}</span
                  >
                  <span class="block h-1.5 w-28 rounded bg-white/15">
                    <span
                      class="block h-1.5 rounded bg-sky-400"
                      style="width:${Math.round(this.progress(p) * 100)}%"
                    ></span>
                  </span>`
              : html`<span class="text-xs text-white/60"
                  >${translateText("tech_tree.idle")}</span
                >`
          }
        </button>
      </div>
      ${this.open ? this.renderTree(p) : nothing}
    `;
  }

  private renderTree(p: PlayerView) {
    return html`
      <div
        class="fixed inset-0 z-1100 flex items-center justify-center bg-black/50 pointer-events-auto"
        @click=${this.toggle}
      >
        <div
          id="tech-tree"
          class="max-h-[85vh] w-[min(1100px,95vw)] overflow-auto rounded-xl bg-slate-900/95 border border-white/15 p-4 text-white shadow-2xl"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-bold">
              ${translateText("tech_tree.title")}
            </h2>
            <div class="flex items-center gap-3 text-sm">
              <span>💰 ${renderNumber(p.gold())}</span>
              <button
                class="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
                @click=${this.toggle}
              >
                ✕
              </button>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            ${BRANCHES.map((b) => this.renderBranch(p, b))}
          </div>
        </div>
      </div>
    `;
  }

  private renderBranch(p: PlayerView, branch: TechBranch) {
    const techs = TECHS.filter((t) => t.branch === branch).sort(
      (a, b) => a.tier - b.tier,
    );
    return html`
      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-white/80">
          ${BRANCH_ICONS[branch]} ${translateText(`tech_tree.branch.${branch}`)}
        </h3>
        ${techs.map((t) => this.renderTech(p, t))}
      </section>
    `;
  }

  private renderTech(p: PlayerView, t: TechDef) {
    const status = this.status(p, t);
    const cost = this.game.config().techCost(p, t.id);
    const busy = p.activeResearch() !== null;
    const affordable = p.gold() >= cost;
    const canStart = status === "available" && !busy && affordable;
    const border = {
      researched: "border-emerald-400/70 bg-emerald-500/10",
      researching: "border-sky-400/70 bg-sky-500/10",
      available: "border-white/20 bg-white/5",
      locked: "border-white/10 bg-black/20 opacity-60",
    }[status];
    return html`
      <div
        class="rounded-lg border ${border} p-2 text-sm"
        data-tech=${t.id}
        data-status=${status}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-semibold"
            >${translateText(`tech.${t.id}.name`)}</span
          >
          <span class="text-xs text-white/60"
            >${translateText("tech_tree.tier", { tier: t.tier })}</span
          >
        </div>
        <p class="mt-1 text-xs text-white/75">
          ${translateText(`tech.${t.id}.desc`)}
        </p>
        ${
          t.requires.length > 0 && status === "locked"
            ? html`<p class="mt-1 text-xs text-amber-300/90">
                ${translateText("tech_tree.requires", {
                  techs: t.requires
                    .map((r) => translateText(`tech.${r}.name`))
                    .join(", "),
                })}
              </p>`
            : nothing
        }
        <div class="mt-2">
          ${
            status === "researched"
              ? html`<span class="text-xs text-emerald-300"
                  >✓ ${translateText("tech_tree.researched")}</span
                >`
              : status === "researching"
                ? html`<span class="block h-1.5 rounded bg-white/15">
                    <span
                      class="block h-1.5 rounded bg-sky-400"
                      style="width:${Math.round(this.progress(p) * 100)}%"
                    ></span>
                  </span>`
                : html`<button
                    class="w-full rounded px-2 py-1 text-xs font-semibold ${
                      canStart
                        ? "bg-sky-600 hover:bg-sky-500"
                        : "bg-white/10 text-white/50 cursor-not-allowed"
                    }"
                    ?disabled=${!canStart}
                    @click=${() => this.research(t.id)}
                  >
                    ${translateText("tech_tree.research_for", {
                      gold: renderNumber(cost),
                    })}
                  </button>`
          }
        </div>
      </div>
    `;
  }
}
