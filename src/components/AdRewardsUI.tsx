/**
 * AdRewardsUI
 *
 * Server-side HTML renderer for subtle reward reinforcement.
 */

export interface AdRewardProgress {
  points: number;
  unskippedViews: number;
  streakDays: number;
  nextRewardAt: number;
}

export interface AdRewardsRender {
  html: string;
  styles: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class AdRewardsUI {
  render(progress: AdRewardProgress, containerId = "qad-rewards"): AdRewardsRender {
    const progressRatio = progress.nextRewardAt <= 0
      ? 1
      : clamp(progress.unskippedViews / progress.nextRewardAt, 0, 1);
    const remaining = Math.max(0, progress.nextRewardAt - progress.unskippedViews);
    const tier = progress.streakDays >= 14 ? "Gold Focus" : progress.streakDays >= 7 ? "Silver Focus" : "Focus Starter";

    const html = `
<section id="${esc(containerId)}" class="qad-rewards" aria-live="polite">
  <p class="qad-rewards-title">Engagement rewards</p>
  <p class="qad-rewards-points">${Math.max(0, Math.floor(progress.points))} pts · ${esc(tier)}</p>
  <div class="qad-rewards-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressRatio * 100)}">
    <span class="qad-rewards-fill" style="width:${(progressRatio * 100).toFixed(1)}%;"></span>
  </div>
  <p class="qad-rewards-caption">
    ${remaining > 0 ? `${remaining} uninterrupted views to unlock your next bonus.` : "Bonus unlocked. Keep the streak alive."}
  </p>
</section>`.trim();

    const styles = `
#${containerId}.qad-rewards {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: rgba(15, 23, 42, 0.78);
  color: #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  width: min(280px, 100%);
  backdrop-filter: blur(2px);
}
#${containerId} .qad-rewards-title {
  margin: 0;
  font-size: 11px;
  letter-spacing: .03em;
  text-transform: uppercase;
  color: #93c5fd;
}
#${containerId} .qad-rewards-points {
  margin: 3px 0 8px;
  font-size: 13px;
  font-weight: 600;
}
#${containerId} .qad-rewards-meter {
  background: rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  height: 6px;
  overflow: hidden;
}
#${containerId} .qad-rewards-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #60a5fa, #22d3ee);
}
#${containerId} .qad-rewards-caption {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: #cbd5e1;
}
`.trim();

    return { html, styles };
  }
}

export const adRewardsUI = new AdRewardsUI();
