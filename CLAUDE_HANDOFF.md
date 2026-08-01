# Claude Session Handoff

_Written 2026-08-01. This is a snapshot for the next session — it does not describe new work and no code was changed to produce it._

## 1. Current production status

- **Instagram**: connected (`_hagaiyy`, MEDIA_CREATOR). Full content + metric import working via the request-planner/registry architecture. Account-level insights (demographics, day-period aggregates) also working, stored separately from content metrics. Last live import: 10/10 items imported successfully.
- **Facebook Account**: authorization-only by design — proven live (`GET /me/posts` always returns zero posts without Advanced Access this app doesn't have) and excluded from Data Import eligibility. It exists only to discover managed Pages.
- **Facebook Page (YY Studio)**: content import working (2 real posts on this Page). Metrics **partially** available — see §5. As of this snapshot the Facebook Account connection is mid-reconnect (status `connecting`, started 2026-08-01T20:17:25Z) and the Facebook Page is `notConnected` as a result (Page auth cascades from the Account). **The user has started but not yet confirmed completion of the reconnect requested in step 4 below.**
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
- **Scopes actually granted in the stored token**: unknown at this exact moment — the Facebook Account connection is mid-reconnect (see §1). Before this reconnect began, the stored token had `public_profile,pages_show_list,pages_read_engagement,read_insights` (no `pages_read_user_content`).
- New Meta Developer permission added and requested: `pages_read_user_content` (marked "Ready for testing" in the Meta app)
- **No further OAuth code change is needed** — this was the pending item and it is already implemented and deployed as of commit `70311e4`.

## 4. Exact next execution steps

1. ~~Update OAuth scope list~~ — done (`70311e4`)
2. ~~Deploy~~ — done, verified live
3. **Wait for the user to confirm the Facebook disconnect/reconnect is complete** (in progress as of this snapshot)
4. Verify the new token via `GET /api/connections/facebook/permission-status` — confirm `userToken.hasPagesReadUserContent: true` along with the existing checks (valid, belongsToApp, hasReadInsights, hasPagesReadEngagement, pageToken valid/belongsToApp/belongsToExpectedPage, pageIdMatches)
5. Re-test only the previously blocked Page fields first: `likes.summary(true)`, `comments.summary(true)` (these came back from `untested` after the scope change — see §5)
6. Run one live production import with Recent Content Limit = 10
7. Report: likes/comments counts per post, shares, existing Insights metrics, any remaining rejected metrics with exact safe Meta error type/code/subcode, completeness per post, `importRun` ID, database deduplication result

## 5. Current proven Facebook Page metrics (from the live run before the `pages_read_user_content` reconnect)

- **available**: `post_media_view`→views, `post_clicks`→clicks, `post_reactions_like_total`, `page_post_engagements`, `page_video_views`, `page_views_total`, `page_total_media_view_unique`
- **empty** (accepted, no value returned — never treated as zero): `shares`, `post_engaged_users`, `page_impressions`, `page_fans`, `page_fan_adds_unique`, `page_fan_removes_unique`, `page_posts_impressions`
- **deprecated** (Meta's June 2026 Page Insights deprecation, confirmed in current docs — never requested): `post_impressions`, `post_impressions_unique`, `post_video_views_unique`, `page_impressions_unique`, `page_video_views_unique`
- **permissionRequired → reset to untested for re-verification**: `likes.summary(true)`, `comments.summary(true)` — confirmed rejected (`OAuthException code=10`) under the pre-`pages_read_user_content` scope. Registry now marks them `untested` again pending the live re-test in §4.
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

- Complete Facebook `pages_read_user_content` live verification (§4) once the user confirms reconnection
- Facebook video/Reel post metrics remain untested (no video/Reel content on the connected Page yet)
- Instagram Story and feedVideo metrics remain untested (no real content of those types on the connected account yet)
- Pinterest is blocked on Pinterest-side app/Privacy Policy setup, not a code task
- UI work has not started — resume from the agreed table model in §8 when ready
