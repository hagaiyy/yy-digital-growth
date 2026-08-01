# Claude Session Handoff

_Written 2026-08-01. Updated 2026-08-01 after completing the pages_read_user_content live verification described in the original §4._

## 1. Current production status

- **Instagram**: connected (`_hagaiyy`, MEDIA_CREATOR). Full content + metric import working via the request-planner/registry architecture. Account-level insights (demographics, day-period aggregates) also working, stored separately from content metrics.
- **Facebook Account**: authorization-only by design — proven live (`GET /me/posts` always returns zero posts without Advanced Access this app doesn't have) and excluded from Data Import eligibility. It exists only to discover managed Pages.
- **Facebook Page (YY Studio)**: content import working (2 real posts on this Page). Reconnect with `pages_read_user_content` is **confirmed complete** — `GET /api/connections/facebook/permission-status` returns `hasPagesReadUserContent: true` along with all other checks passing (valid, belongsToApp, hasReadInsights, hasPagesReadEngagement, pageToken valid/belongsToApp/belongsToExpectedPage, pageIdMatches). `likes.summary(true)` and `comments.summary(true)` are now confirmed **available** live (see §5) — the registry has been updated accordingly.
- **Pinterest**: `setupRequired` — `PINTEREST_APP_ID`/`PINTEREST_APP_SECRET` are not set. Per the user, also blocked on Pinterest app/Privacy Policy setup on Pinterest's side. Not something code can fix.

## 2. Current repository state

- Branch: `main` (up to date with `origin/main`)
- Latest relevant commits (newest first):
  - `70311e4` — Add `pages_read_user_content` to Facebook OAuth scope (**deployed and verified live** — the production authorization URL was confirmed to include it)
  - `8ca997d` — Update Facebook metric registry from live production results, remove temporary diagnostic
  - `4e2f530` — Fix Facebook Page content discovery: drop the deprecated `type` field (`OAuthException code=12`)
  - `623001d` — Build the Facebook Page Insights request planner and resilient metric collection
  - `00da38e` — Add `read_insights` to Facebook OAuth scope
  - `17aeb0c` / `f00ccd0` — Instagram Insights request planner/registry rewrite + account-snapshot bug fixes
- Deployed URL: `https://yy-digital-growth-production.up.railway.app`
- **Permanent** endpoints (keep these):
  - `GET /api/health/database` — MongoDB connectivity check
  - `GET /api/connections/facebook/permission-status` — safe, real token/permission verification (no tokens/secrets returned)
  - `GET /api/connections/[connectionId]/account-performance` — reads account/Page-level insight snapshots
- **Temporary** endpoints already removed (do not recreate unless re-diagnosing): `/api/health/facebook-permissions`, `/api/health/meta-diagnostics`, `/api/health/facebook-fields-diagnostic`

## 3. Exact Facebook OAuth state

- **Scopes currently requested in code** (`FacebookConnector.ts`, deployed): `public_profile,pages_show_list,pages_read_engagement,pages_read_user_content,read_insights`
- **Scopes actually granted in the stored token**: confirmed live via `GET /api/connections/facebook/permission-status` on 2026-08-01 — `hasPagesReadUserContent: true`, plus `valid/belongsToApp/hasReadInsights/hasPagesReadEngagement` all true, and `pageToken.{valid,belongsToApp,belongsToExpectedPage}`/`pageIdMatches` all true.
- New Meta Developer permission added and requested: `pages_read_user_content` (marked "Ready for testing" in the Meta app) — now confirmed granted in the live token.
- **No further OAuth code change is needed.**

## 4. Live verification completed 2026-08-01 (this was the pending item — now done)

1. ~~Update OAuth scope list~~ — done (`70311e4`)
2. ~~Deploy~~ — done, verified live
3. ~~Wait for user to confirm reconnect~~ — done, confirmed via permission-status endpoint
4. ~~Verify new token~~ — done, all checks pass (see §3)
5. ~~Re-test `likes.summary(true)`, `comments.summary(true)`~~ — done, both **available** live (see §5). Registry (`metricCapabilityRegistry.ts`) updated from `untested` to `available` for both.
6. ~~Run one live production import with Recent Content Limit = 10~~ — done. `importRunId: import_run_b518bb03-d350-4ceb-bdcf-d5375abf153a`, status `completedWithErrors` (see note below on why that status is misleading here), `totals: {connections: 2, requestedItems: 12, createdItems: 0, updatedItems: 12, failedItems: 0, skippedItems: 0}`. Instagram: 10/10 updated, `status: success`. Facebook Page: 2/2 updated, `status: partial` — the "partial" is driven entirely by already-known `empty`/`deprecated` metrics (shares, impressions, reach, engagedUsers), not a new failure.
7. Report (per-post, both posts on the Facebook Page):
   - Post `1248396251688750_122101298661416293` (imagePost): likes=0, comments=0, views=0, clicks=0, reactionsLikeTotal=0. `dataCompleteness: partial`.
   - Post `1248396251688750_122097918585416293` (linkPost): likes=0, comments=0, views=5, clicks=0, reactionsLikeTotal=0. `dataCompleteness: partial`.
   - Both posts: `shares` and `post_engaged_users` → `empty`/`metricUnsupported` (expected, matches §5 prior finding, not a regression). `impressions`/`reach` → `deprecated` (expected).
   - **Gap found, not fixed**: the app does NOT persist the raw Meta `type`/`code`/`subcode`/`fbtrace_id` per failed metric anywhere queryable. `FacebookConnector.ts`'s `classifyFacebookMetricFailure()` collapses every Graph API error into a coarse enum (`tokenInvalid`/`permissionMissing`/`metricUnsupported`/`requestRejected`) before it's stored as `safeReasonCode` on `MetricRecord`. The raw error is discarded after classification. If exact Meta error codes per metric are ever needed again, this is where to add persistence — not attempted this session since it wasn't necessary to confirm the `pages_read_user_content` fix worked.
   - Database dedup: both posts show `createdCount: 0, updatedCount: 2` — confirms the existing `{importedContentId, snapshotHour}` unique-snapshot invariant is working (re-import within the same hour updates, doesn't duplicate).

## 5. Current proven Facebook Page metrics (post-`pages_read_user_content` reconnect, confirmed live 2026-08-01)

- **available**: `post_media_view`→views, `post_clicks`→clicks, `post_reactions_like_total`, `likes.summary(true)`→likes, `comments.summary(true)`→comments, `page_post_engagements`, `page_video_views`, `page_views_total`, `page_total_media_view_unique`
- **empty** (accepted, no value returned — never treated as zero): `shares`, `post_engaged_users`, `page_impressions`, `page_fans`, `page_fan_adds_unique`, `page_fan_removes_unique`, `page_posts_impressions`
- **deprecated** (Meta's June 2026 Page Insights deprecation, confirmed in current docs — never requested): `post_impressions`, `post_impressions_unique`, `post_video_views_unique`, `page_impressions_unique`, `page_video_views_unique`
- **untested**: all video/Reel post-level metrics (`post_video_views`, `post_video_avg_time_watched`, `post_video_view_time`, `post_video_complete_views_30s`) — this Page has no video/Reel content yet to test against.

## 6. Current proven Instagram metrics

- **Account-level**: `reach`, `views`, `accounts_engaged`, `replies`, and the `total_interactions`/`likes`/`comments`/`shares`/`saves` group (day period, `media_product_type` breakdown) confirmed **available**. `follower_count`, `content_views`, `online_followers` confirmed **empty**. `follower_demographics` confirmed **available** (real per-age-bucket counts). `engaged_audience_demographics`, `reached_audience_demographics` confirmed **unsupported** (real rejection). `profile_views`, `website_clicks` **deprecated**.
- **Reel**: `views`, `reach`, `saved`, `shares`, `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`, `likes`, `comments` confirmed **available**. `impressions`, `plays`, `follows`, `profile_activity`, `profile_visits`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` confirmed **invalid for this type**. `facebook_views`, `crossposted_views` confirmed **unsupported** (not crossposted to a Page).
- **imagePost**: `views`, `reach`, `saved`, `shares`, `total_interactions`, `likes`, `comments`, `follows`, `profile_activity`, `profile_visits` confirmed **available**. `impressions` **invalid for this type**.
- **carousel**: same set as imagePost, all confirmed **available**; `impressions` **invalid for this type**.
- **Still untested**: Story metrics (no real Story object has ever existed on this account — correctly marked `untested`, never `unsupported`) and feedVideo metrics (no real plain Instagram feed video, as opposed to a Reel, exists on this account yet).

## 7. Database invariants

- `importedContents`: unique identity = `{platform, externalContentId}`.
- `performanceSnapshots`: unique = `{importedContentId, snapshotHour}` — at most one snapshot per content item per UTC hour.
- `accountPerformanceSnapshots`: unique = `{connectionId, snapshotHour, period, since, until, timeframe, breakdown}`. This one collection/structure is shared by both Instagram account-level insights and Facebook Page-level insights — always kept fully separate from content/post-level `performanceSnapshots`.
- Missing/empty values are never converted to zero anywhere in either pipeline: an absent key means never returned, `null` means explicitly empty/unavailable, `0` means a real observed zero. Confirmed repeatedly against live production responses.

## 8. UI planning decisions already agreed

- Tabs organized by platform + content type
- One row per content item
- Time windows per item: early hours, first day, first week, latest
- Only metrics relevant to that content type are shown
- All available metrics are visible by default
- User can hide individual metrics
- Hide/show preferences are saved per platform + content type
- No AI-generated conclusions or scoring yet
- Metrics that are genuinely untested stay labeled "untested" explicitly in the UI — never hidden or implied as unsupported

## 9. Open tasks only

- ~~Complete Facebook `pages_read_user_content` live verification~~ — done 2026-08-01, see §4
- Facebook video/Reel post metrics remain untested (no video/Reel content on the connected Page yet)
- Instagram Story and feedVideo metrics remain untested (no real content of those types on the connected account yet)
- Pinterest is blocked on Pinterest-side app/Privacy Policy setup, not a code task
- (Optional, not urgent) Raw Meta error type/code/subcode per failed metric isn't persisted anywhere — only a coarse classification enum. Add persistence in `FacebookConnector.ts`'s failure-classification path if exact per-metric Meta error codes are needed later.
- UI work has not started — resume from the agreed table model in §8 when ready
