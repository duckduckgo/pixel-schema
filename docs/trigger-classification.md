# Trigger classification guide

How to choose the `triggers` value(s) for a pixel definition. This is the canonical
reference; the per-platform agent/contributor guides embed the decision procedure below
and link here for the full rules.

The single most important principle:

> **Classify by the event that causes the pixel to fire — never by its dedupe cadence
> ("daily"/"unique" suffixes) or its delivery mechanism.**

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
| `other` | Last resort — the known residual cases are inbound OS intents/handoffs from other apps (e.g. a PDF arriving via the system "Open with" sheet, a credential-exchange handoff), where the causing action happened entirely outside our app. If you use it, the description must say why no other value fits. |

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
3. A timer or scheduled/delayed job literally fires it (rollup, sampler,
   watchdog, absence-of-event check)? → scheduled
   • If the timer merely DETECTS something, classify by what was detected:
     anomaly → exception; a user toggle noticed by a poll → user_interaction.
   • Per-event pixels emitted while a scheduled session executes feature work
     (e.g. PIR scan stages) are feature_lifecycle — only the tick that starts
     the session is scheduled.
4. Automatic feature operation runs / completes / changes state (migration,
   sync cycle, job engine, token refresh, update detection, state observer)?
   → feature_lifecycle
   • Async completion of a user-initiated flow that can outlive the UI or be
     driven by a non-user party (billing observer, remote sync peer, retrying
     backend call) → feature_lifecycle. Synchronous completion inside the
     user's action → user_interaction.
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

## Worked examples

Real pixels illustrating the procedure's judgement calls (rule numbers refer to the
procedure steps above).

**Multi-event pixels get multiple triggers (step 7).**
`onboarding_set-default` (Android) fires with `event=shown|clicked|confirmed` →
`["impression", "user_interaction"]`. The same applies to the whole
`onboarding_<step>` family on Android, iOS, and Windows.

**Did the app volunteer the surface? (step 2).**
`m_browsing-menu_displayed` (Android) — menu shown 1:1 on the menu-button tap →
`user_interaction`. `m_remote_message_shown` (all platforms) — RMF message displayed by
config/eligibility → `impression`. The same split can occur within one feature:
`m_mac_privacy-pro_toolbar_button_shown` (upsell state machine decides to show) is
`impression`, while its sibling `*_popover_shown` pixels (fire on the user's click) are
`user_interaction`.

**Timers: classify by what the tick reports (step 3).**
`m_dbp_engagement_dau` (Android) — recurring worker sampling active-user state →
`scheduled`. `m_dbp_optout_stage_*` — per-stage engine events inside a (scheduled or
manual) PIR run → `feature_lifecycle`; only the session-start tick itself is
`scheduled`. `m_mac_vpn_proxy_orphaned` — a 15-second check task detects an orphaned
proxy → `exception` (the anomaly, not the timer).

**Store-and-forward (step 7 note).**
`m_fire_button_executed_daily` (Android) — manual fire-button clears bump a persisted
counter; a 2-hour worker transmits it after the process restart → `user_interaction`.

**Async completion (step 4).**
`sync_setup_barcode_scanner_success` (iOS) — QR code recognized during the user's scan →
`user_interaction`. `m_privacy-pro_app_subscription-purchase_success` (Android) —
billing observer + retrying backend confirmation, can land after UI teardown →
`feature_lifecycle`. This is a per-platform judgement: iOS's `m_forget-all-executed`
also serves auto-clear → `feature_lifecycle`, while Android's `m_fire_button_executed_*`
counters increment on manual clears only → `user_interaction`.

**startup includes foregrounding (step 6).**
`adBlocking_state_daily` (Android) — `onResume` observer reporting feature state once
per day → `startup`, not `scheduled` (no timer fires it) and not `feature_lifecycle`.
