# FeedDeck QA Checklist — Poster Shelf v2

## Scroll & Navigation
- [ ] **Progressive dim** — Focus a card in the middle. Cards should get progressively darker and smaller the further they are from focus. Not stepped, smooth gradient.
- [ ] **Scroll stickiness** — Scroll wheel should advance exactly one card per deliberate flick. No machine-gunning through multiple cards on a single swipe. Should feel "sticky" but not sluggish.
- [ ] **Arrow key nav** — Left/right arrows move one card at a time. Focused card always centers in viewport.
- [ ] **Divider skipping** — Navigation should never land on a category divider. Arrow keys and scroll should hop over them.

## Category Transitions
- [ ] **Category transitions** — Scroll past the last "Trending" card. You should see a vertical divider pill, then "Design & Creative" cards begin. The shelf header ("TRENDING") should cross-fade to the new category name.
- [ ] **Header label update** — Scroll back left into a previous category. Header should cross-fade back to that category's name.
- [ ] **Infinite hydration** — Keep scrolling right. After "Design & Creative" ends, "Dev Deep Dives" loads automatically. Then "Recently Added." You should never hit a dead end.

## Cards & Layout
- [ ] **Card sizing** — Cards should fill most of the viewport height. Vertical (poster) cards are narrower than horizontal (cinematic) cards. Focused card expands ~40% wider.
- [ ] **Aspect ratios** — No warped/stretched images on any card, including during the width expansion transition.
- [ ] **Info panel** — Focused card should show a glass info card at bottom-left with title, tags, rating, description, and action buttons.

## Peek & Progress
- [ ] **Peek row** — Bottom row should show thumbnails from the NEXT unloaded category. Clicking a peek thumbnail should jump you to that category.
- [ ] **Dots** — Progress dots below carousel. Active dot is a rose pill. Should update as you scroll and grow as new categories load.

## Playback (Full App)
- [ ] Homepage: click a CategoryRow card → theatre mode plays video start to finish
- [ ] Homepage: click multiple different cards in sequence — each one plays
- [ ] Feed: swipe through 5+ videos — each autoplays on snap
- [ ] Feed: navigate away and back — playback resumes
- [ ] Queue: add 3+ videos, play through — autoadvance works, each video plays
- [ ] HeroCarousel: search results play on hover/click

## Error States
- [ ] Expired URL triggers re-fetch (not silent failure)
- [ ] Failed video shows user-facing error (not a silent black screen)
- [ ] Rapid card switching doesn't leave zombie video elements or stale streams

## Mobile (iOS Safari + Android Chrome)
- [ ] Viewport renders correctly
- [ ] Scroll-snap works as expected
- [ ] No gesture conflicts
