# UX Report: Taste Feedback System
**Date:** 2026-04-15 | **Ref:** ADR_taste-feedback-system.md

## Design Brief

**PROJECT:** FeedDeck Taste Feedback
**REGISTER:** Netflix thumbs + Spotify "improve recommendations" + Apple TV+ card interactions
**EXISTING SYSTEM:** Dark glass UI, rose accent (#f43f5e), cinematic card carousel with focus expansion, spring animations
**DIFFERENTIATOR:** Feedback that feels like power, not homework

---

## UX Strategy: 3 Critical Decisions

### 1. Thumbs Placement on Cards

**Problem:** PosterCards already have complex interaction. Click = theatre mode. Focus expansion on scroll. Adding buttons that compete with the primary action will feel clunky.

**Recommendation: Bottom-edge hover overlay**

Thumbs appear as a slim bar at the bottom of the focused card on hover (desktop) or long-press (mobile). They sit BELOW the card's click target zone, inside a separate hit area so accidental theatre-mode triggers don't happen.

Why bottom-edge, not top:
- Duration badge lives top-right. Orientation badge lives top-left. Top is crowded.
- Bottom has the watch-progress bar (landscape) but that's thin and can coexist.
- Eyes scan down naturally on cards. Bottom placement means "I've seen enough, here's my verdict."
- Netflix puts thumbs at the bottom of their detail panel for the same reason.

Spacing: 44px tall touch target, 8px above the card's bottom edge, glass material background matching existing `.glass` token. Thumbs icons at 20px, 32px apart. The bar extends only ~120px wide (centered) so it doesn't feel like a toolbar.

### 2. Toast System Upgrade

**Problem:** Current toast is display-only (pointer-events-none), 2s auto-dismiss, no action buttons. The feedback toasts need CTAs and configurable timing.

**Recommendation: Two toast tiers**

**Tier 1 - Passive confirmation** (existing pattern, enhanced):
Used for: "Saved. More from [creator] coming your way."
Behavior: Same pill shape, same position (top-center), 3s dismiss, no interaction needed. Keep pointer-events-none. This is the "thumbs up acknowledged" toast.

**Tier 2 - Action toast** (new pattern):
Used for: "This row isn't working. Want to fix it?" / "Pause toasts for 1 hour"
Behavior: Wider pill, pointer-events-auto, CTA button(s) on the right side, 8s timeout with a subtle shrinking progress indicator on the border. Dismiss on click-outside or timeout.

Visual differentiation: Tier 2 gets a rose accent left-border (2px) so it reads as "this wants your attention" vs the neutral Tier 1. Not a modal, not blocking, just slightly more assertive.

**Toast fatigue flow:**
1. 1st action toast: shows normally
2. 2nd action toast: includes "Pause for 1hr" as a secondary action (text-only, left of CTA)
3. After pause: all rating toasts suppressed. Small dot indicator on the row header shows feedback is available but muted.

### 3. Row Refresh Animation

**Problem:** Current GalleryRow is snap-scroll with RAF parallax. A hard content swap will feel janky.

**Recommendation: Staggered card replacement**

Individual card replacement (the "lazy load one at a time" option from the ADR):
1. Old card does a 250ms scale-down + opacity-fade (using existing cinematic easing)
2. 100ms pause
3. New card fades in at the same position with a subtle scale-up from 0.95 to 1.0 (spring easing, 350ms)
4. Next card starts its swap 150ms after the previous one begins

This creates a domino-wave effect that feels intentional and cinematic, consistent with the app's existing motion language. It avoids the snap-scroll jitter of replacing the entire scroll container's content.

For the "4+ consecutive downs = full row refresh": same domino pattern but starting from the leftmost visible card, 100ms stagger. Takes ~1.5s for a visible set of 5-6 cards. During the swap, the row is non-interactive (prevent rating during animation).

---

## UX Issues to Watch (Critic Notes)

### Issue 1: Thumbs on unfocused cards
Only the focused (center) card should show thumbs. Showing on all visible cards creates decision paralysis and visual noise. The user scrolls to a card, evaluates it while it's large and focused, then decides. One card at a time.

### Issue 2: Feedback panel anchoring
The Step 2 keyword input panel needs to anchor to the row, not float as a modal. Recommendation: slides down from the row header area (pushing content below it down), same glass-elevated material. Max-height 160px so it doesn't dominate the viewport. This keeps spatial context ("I'm fixing THIS row").

### Issue 3: Mobile long-press conflict
Long-press for thumbs could conflict with native scroll behavior or context menus. Recommendation for mobile: swipe-down gesture on a focused card reveals thumbs (card slides down 44px to expose the button bar above it), or a small persistent rating icon in the card corner that expands on tap. Needs testing, flag this as a risk.

### Issue 4: "Liked" section discovery
If the user thumbs-up 30 videos, where do they find them? Recommendation: new row on the homepage called "Your Likes" that only appears once the user has 3+ liked videos. Uses the existing GalleryRow component. Also accessible from library tab.

---

## What's Working (Protect These)

- **The focused-card interaction model.** Rating only the focused card is elegant and prevents overwhelm. Don't add buttons to every card.
- **The cinematic motion language.** Spring easing, parallax, scale transitions. The rating animations should match this vocabulary exactly. No Material Design bounces, no iOS rubber-banding.

---

## Verdict

**One more pass needed** before building: the mockup should validate the bottom-edge hover bar placement at actual card sizes (50vh height means the bar is far from the cursor if you hover mid-card). If that feels too far, fallback is a floating pair of thumbs that appear near the cursor on hover. Build both in the mockup, test which reads better.
