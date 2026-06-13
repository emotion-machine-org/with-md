# Anonymous share analytics

with.md counts the main growth loop with explicit share events instead of generic pageviews.

## Events

- `anonymous_share_started`: a visitor starts the anonymous share flow from the product surface.
- `anonymous_share_created`: the server creates an anonymous share.
- `share_link_copied`: a visitor copies a view, edit, raw, or markdown-text link from a shared page.
- `shared_page_viewed`: a shared markdown page loads in the browser.
- `recipient_created_own_share`: a new anonymous share is created from a shared-page referrer.

## Properties

- `entry_surface`: where the action started, such as `home_upload`, `home_drop`, `home_blank`, `public_api`, or `shared_page`.
- `source_path`: the product path that led to the action.
- `source_channel`: a plain grouping for attribution, such as `product_surface`, `recipient_loop`, `audience`, or `direct`.
- `share_id`: the generated anonymous share id.
- `source_share_id`: the shared page that led to a recipient-created share.
- `link_type`: `view`, `edit`, `raw`, or `markdown_text` for copy events.
- `file_extension` and `size_bytes`: file shape only. The app does not send private markdown content.

## Verification query

Use this PostHog SQL to count completed anonymous shares by day:

```sql
SELECT
  toDate(timestamp) AS day,
  count() AS anonymous_shares
FROM events
WHERE event = 'anonymous_share_created'
GROUP BY day
ORDER BY day DESC
```

To see the loop by channel:

```sql
SELECT
  toDate(timestamp) AS day,
  properties.source_channel AS source_channel,
  count() AS anonymous_shares
FROM events
WHERE event = 'anonymous_share_created'
GROUP BY day, source_channel
ORDER BY day DESC, anonymous_shares DESC
```
