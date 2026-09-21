# Trigger classification guide

How to choose the `triggers` value(s) for a pixel definition. This is the canonical
reference; the per-platform agent/contributor guides embed the decision procedure below
and link here for the full rules.

The single most important principle:

> **Classify by the event that causes the pixel to fire — never by its dedupe cadence
> ("daily"/"unique" suffixes) or its delivery mechanism.**

`triggers` is an array: a pixel that fires for more than one kind of event should list
every applicable trigger.

## Trigger values

| Value | Definition |
|---|---|
| `user_interaction` | A deliberate user action in the UI: tap/click, toggle, menu selection, swipe, gesture, prompt/query submission. Includes surfaces shown 1:1 as the result of a gesture (a menu on tap, a picker on press, a dialog behind a button) and OS-relayed gestures (notification taps, widget placement). |
| `user_submitted` | **Consent-scoped only**: the user submits *their data* with consent — breakage reports, feedback, error reports behind a consent checkbox. The button that opens the form is `user_interaction`; only the submission itself is `user_submitted`. |
| `impression` | A screen, promo, prompt, dialog, or message is shown to the user without interaction — app- or eligibility-driven display. The user's response to it is `user_interaction`. |
| `feature_lifecycle` | An automatic feature operation runs, completes, or changes state: migrations, sync cycles, background job engines (e.g. PIR/DBP), token refreshes, install/update detection, subscription-state observers, background service start/stop, automatic data/config updates. |
| `scheduled` | A timer or scheduled job *literally fires* the pixel: period rollups, recurring state samplers, watchdog ticks, delayed one-shot checks (including absence-of-event checks). |
| `web_detection` | Injected scripts (content-scope-scripts / user scripts) detect content or behavior on a web page: captcha challenges, adwalls, CMPs, ad-blocking detection. No gesture, no timer, no feature operation — passive observation of third-party pages. |
| `exception` | An error or crash occurs: unhandled exceptions, process/tab crashes, load/parse failures, typed failure results, anomalies found by health checks. |
| `startup` | App launch **or return to foreground** (includes `onResume` / `applicationDidBecomeActive` / ATB-refresh observers). Daily state snapshots fired on foreground belong here. |
| `page_load` | A webpage (or in-page document, e.g. an inline PDF) is loaded. |
| `new_tab` | A new tab is opened. |
| `search_ddg` | The user performs a DuckDuckGo search. |
| `other` | Last resort. Legitimate residual cases include inbound OS intents/handoffs from other apps. If you use it, the description must say why no other value fits. |

## Decision procedure

```
Classify by the EVENT THAT CAUSES THE PIXEL TO FIRE — never by dedupe cadence
("daily"/"unique" suffixes) or the delivery mechanism.

1. Deliberate user action (tap, click, toggle, menu selection, swipe, gesture,
   prompt/query submission)?  → user_interaction
   • A surface shown 1:1 because of a gesture (menu on tap, dialog behind a
     button, screen entered from an explicit flow) is user_interaction.
   • user_submitted ONLY for consent-scoped submission of the user's own data
     (breakage report, feedback). The opener button is user_interaction.
2. Surface displayed WITHOUT the user asking? → impression
   • Litmus: display code has an eligibility gate (feature flag, subscription
     state, view-count threshold, cooldown) → impression. Only gate is "user
     navigated here" → user_interaction.
3. Automatic feature operation runs / completes / changes state (migration,
   sync cycle, job engine, token refresh, update detection, state observer)?
   → feature_lifecycle
   • Async completion of a user-initiated flow that can outlive the UI or be
     driven by a non-user party (billing observer, remote sync peer, retrying
     backend call) → feature_lifecycle. Synchronous completion inside the
     user's action → user_interaction.
4. A timer or scheduled/delayed job literally fires it (rollup, sampler,
   watchdog, absence-of-event check)? → scheduled
   • If the timer merely DETECTS something, classify by what was detected:
     anomaly → exception; a user toggle noticed by a poll → user_interaction.
5. Injected scripts detected page content (captcha, adwall, CMP, ads)?
   → web_detection
6. Error/crash → exception. Launch or foreground → startup. Page loaded →
   page_load. New tab → new_tab. DDG search → search_ddg.
7. One pixel name covering several events (e.g. an event=shown|clicked param)?
   → list every applicable trigger; triggers is an array.

Store-and-forward: when counters are recorded at event time and transmitted
later by a worker, classify by the RECORDED event, never the flusher.

Use "other" only when nothing above fits, and say why in the description.
```

## Tie-breaker rules

These resolve the ambiguities that come up in practice. Each rule includes real pixels
as worked examples.

### R1 — Multi-event pixels get multiple triggers

A pixel whose name is multiplexed over an `event`/`action` parameter is tagged with
every applicable trigger.

* `onboarding_set-default` (Android) fires with `event=shown|clicked|confirmed` →
  `["impression", "user_interaction"]`. The same applies to the whole
  `onboarding_<step>` family on Android, iOS, and Windows.
* `win_new-tab-page_next-steps` (Windows) covers a state-observer `shown` plus
  user `clicked`/`dismissed` → `["impression", "user_interaction"]`.

### R2 — Impression vs. user_interaction: did the app volunteer it?

A surface displayed 1:1 because the user asked for it is `user_interaction`, even when
the pixel fires from `onCreate`/`viewDidLoad`/`Show()` rather than the gesture handler.
A surface the app volunteered is `impression`.

Litmus test: if the display code has an **eligibility check** (feature flag,
subscription state, view-count threshold, cooldown), it's an `impression`; if the only
gate is "the user navigated here", it's `user_interaction`.

* `m_browsing-menu_displayed` (Android): menu shown 1:1 on the menu-button tap →
  `user_interaction`.
* `m_remote_message_shown` (all platforms): RMF message displayed by config/eligibility →
  `impression`.
* `m_mac_privacy-pro_toolbar_button_shown`: upsell state machine decides to show the
  button → `impression`; its sibling `*_popover_shown` pixels fire on the user's click →
  `user_interaction`.

### R3 — Timers and workers: classify by what the tick reports

`scheduled` when a timer/worker literally fires the pixel and the payload is a state
sample, usage counter, period rollup, or absence-of-event check. When a timer merely
*detects* a condition, classify by the condition. Per-event pixels emitted while a
scheduled session executes feature work are `feature_lifecycle` — only the
session-start tick itself is `scheduled`.

* `m_dbp_engagement_dau` (Android): fired by a recurring worker sampling active-user
  state → `scheduled`.
* `m_dbp_optout_stage_*` (Android/iOS/macOS): per-stage engine events inside a
  (scheduled or manual) PIR run → `feature_lifecycle`.
* `m_mac_vpn_proxy_orphaned`: a 15-second check task detects an orphaned proxy →
  `exception` (the anomaly, not the timer).
* `win_settings_startup-boost-should-launch-in-foreground`: a 1-second poll detects a
  user toggle → `user_interaction` (the toggle, not the poll).

### R4 — Store-and-forward: classify by the recorded event, never the flusher

When counters are written at event time and transmitted later by a worker, classify by
the recorded event. Daily/unique suffixes are dedupe, not triggers.

* `m_fire_button_executed_daily` (Android): manual fire-button clears bump a persisted
  counter; a 2-hour worker transmits it after the process restart → `user_interaction`.
* `m_reload-three-times-within-20-seconds` (Android): user refresh taps are recorded,
  the pixel fires later from another code path → `user_interaction`.

### R5 — Async completion: does it survive UI teardown or fire without the user?

Completion pixels for user-initiated flows are `user_interaction` only when the
completion is synchronous or near-synchronous within the user's action. They are
`feature_lifecycle` when the completion arrives from an observer that can outlive the
UI or be driven by a non-user party — or when a non-user path can also fire the pixel.

* `sync_setup_barcode_scanner_success` (iOS): QR code recognized during the user's
  scan → `user_interaction`.
* `m_privacy-pro_app_subscription-purchase_success` (Android): billing observer +
  retrying backend confirmation, can land after UI teardown → `feature_lifecycle`.
* `sync_setup_ended_successful`: pairing completed by the *remote peer's* poll →
  `feature_lifecycle`.
* Fire-button data clearing illustrates that this is a per-platform judgement: iOS's
  `m_forget-all-executed` also serves auto-clear → `feature_lifecycle`, while Android's
  `m_fire_button_executed_*` counters increment on manual clears only →
  `user_interaction`.

### R6 — startup includes foregrounding

Daily state snapshots fired from app-foreground observers (`onResume`,
`applicationDidBecomeActive`, ATB-refresh plugins) are `startup`.

* `adBlocking_state_daily` (Android): `onResume` observer reporting feature state once
  per day → `startup`.
* `m_mac_settings_auto-clear_on`: daily snapshot on app activation → `startup`.

## When is `other` acceptable?

Almost never. The known residual cases are inbound OS intents/handoffs from other apps
(e.g. a PDF arriving via the system "Open with" sheet, a credential-exchange handoff) —
events where the causing action happened entirely outside our app. If you reach for
`other`, state in the pixel's `description` why no other trigger fits.
