# MusicDB Bot (Google Drive + Discord + WorkCode Lookup)

## Env (Render)
- DISCORD_PUBLIC_KEY
- DISCORD_TOKEN
- SYSTEM_STATUS_CHANNEL
- DATABASE_URL
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- PORT (optional)

## Endpoints
- `/` health
- `/discord/commands` (slash commands endpoint)
- `/jobs/export-daily` (CSV export to Google Drive + Discord notify)

## Notes
- Adapters for J-WID / NexTone are placeholders: update selectors/URLs to real DOM.
- Respect each site's ToS / robots.
