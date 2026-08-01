// Fixed, deterministic connectionIds for the four connection areas this
// phase supports. There is exactly one Facebook Page slot: selecting a
// different Page overwrites this same record rather than creating a new
// one, matching "Facebook Page" being a single connection area.
export const CONNECTION_IDS = {
  instagram: "connection_instagram_primary",
  facebookAccount: "connection_facebook_account_primary",
  facebookPage: "connection_facebook_page_primary",
  pinterest: "connection_pinterest_primary",
} as const;
