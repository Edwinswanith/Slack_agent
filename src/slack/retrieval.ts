import type { WebClient } from '@slack/web-api';
import type { Logger } from '@slack/bolt';

/**
 * A message retrieved from Slack, storing only the fields we need.
 * PRD §7.4: Store for each retrieved message: channel id, ts, permalink, author id, text.
 */
export interface RetrievedMessage {
  channel: string;
  ts: string;
  permalink: string;
  authorId: string;
  text: string;
}

/**
 * Converts an ISO date string (e.g., "2026-07-01") to a Slack ts boundary.
 * Slack ts is a Unix timestamp as a string with microseconds: "1234567890.123456"
 * For start of day: 00:00:00 UTC → seconds.0
 * For end of day: 23:59:59 UTC → seconds.999999
 *
 * @param isoDate ISO date string in format YYYY-MM-DD
 * @param isEnd whether this is the end-of-day boundary (true) or start-of-day (false)
 * @returns Slack ts boundary string
 */
function isoDateToSlackTs(isoDate: string, isEnd: boolean): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${isoDate}`);
  }

  const seconds = Math.floor(date.getTime() / 1000);
  const microseconds = isEnd ? '999999' : '0';
  return `${seconds}.${microseconds}`;
}

/**
 * Attempts to retrieve messages using the Real-Time Search API (assistant.search.context).
 * This API is likely gated in a hackathon sandbox and may return an "unavailable" error.
 * This function does not throw — it catches any error and returns null.
 * The caller should use this as a best-effort attempt and fall back to conversations.history if null.
 *
 * @param client Slack Web API client
 * @param query Search query derived from requirement labels
 * @returns Array of RetrievedMessage if successful, null if RTS is unavailable or errors
 */
export async function attemptRealTimeSearch(
  client: WebClient,
  query: string,
  logger?: Logger
): Promise<RetrievedMessage[] | null> {
  try {
    // The exact method name and response shape for RTS are not yet documented.
    // This is a best-effort call that will fail gracefully in the sandbox.
    // The Slack Bolt client may not yet have a typed method for this,
    // so we use the generic call method.
    const result = await (client as any).apiCall('assistant.search.context', {
      query,
    });

    if (!result || !result.ok) {
      // API returned an error response
      return null;
    }

    // If the API returns results, map them to RetrievedMessage format.
    // The response shape is not yet documented; this is speculative.
    if (Array.isArray(result.items)) {
      return result.items.map((item: any) => ({
        channel: item.channel_id || item.channel || '',
        ts: item.ts || '',
        permalink: item.permalink || '',
        authorId: item.user_id || item.author_id || '',
        text: item.text || '',
      }));
    }

    return null;
  } catch (error) {
    // Log that RTS was unavailable and we are falling back.
    const message = error instanceof Error ? error.message : String(error);
    logger?.info(`Real-Time Search API unavailable (${message}); using conversations.history fallback`);
    return null;
  }
}

// Below this many candidate messages (already scoped to the reporting period),
// keyword prefiltering is skipped entirely and every message is passed through.
// Requirement-label-derived keywords ("attendance", "variance") frequently share
// no vocabulary with how people actually phrase things in Slack ("54 students
// attended"), so applying the filter to a small, already-cheap candidate set
// would silently drop real evidence for no efficiency benefit. The six §9.3
// validators (particularly quote-in-source and confidence) are the real
// precision backstop; the keyword filter's job is capping cost on a busy
// channel, not gatekeeping evidence away from the model's judgment.
const KEYWORD_FILTER_MESSAGE_THRESHOLD = 30;

// Slack message subtypes that are channel administrivia, not content a human
// wrote — never candidates for evidence extraction.
const NON_CONTENT_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'bot_add',
  'bot_remove',
  'pinned_item',
  'unpinned_item',
]);

/**
 * Retrieves messages from Slack channels using the conversations.history fallback.
 * Filters by reporting period, respects the 200-message cap across all channels,
 * and keyword-prefilters to reduce noise on high-volume channels only (see
 * KEYWORD_FILTER_MESSAGE_THRESHOLD).
 *
 * @param client Slack Web API client
 * @param channelIds List of Slack channel IDs to search
 * @param reportingPeriodStart ISO date string (YYYY-MM-DD), inclusive
 * @param reportingPeriodEnd ISO date string (YYYY-MM-DD), inclusive
 * @param keywords List of keywords; only applied if candidate volume is large
 * @returns Array of RetrievedMessage, up to 200 total across all channels
 */
export async function fetchViaHistoryFallback(
  client: WebClient,
  channelIds: string[],
  reportingPeriodStart: string,
  reportingPeriodEnd: string,
  keywords: string[],
  logger?: Logger
): Promise<RetrievedMessage[]> {
  const oldestTs = isoDateToSlackTs(reportingPeriodStart, false);
  const latestTs = isoDateToSlackTs(reportingPeriodEnd, true);

  const normalizedKeywords = keywords.map((kw) => kw.toLowerCase());

  // Stage 1: collect every message in the reporting period (up to the 200 cap),
  // without keyword filtering yet — we don't know the total candidate volume
  // until we've fetched it.
  const candidates: Array<{ channel: string; ts: string; authorId: string; text: string }> = [];

  for (const channelId of channelIds) {
    if (candidates.length >= 200) {
      break;
    }

    let cursor: string | undefined;
    let pageCount = 0;
    const maxPages = 10; // Safety limit to avoid infinite loops

    while (pageCount < maxPages && candidates.length < 200) {
      try {
        const response = await client.conversations.history({
          channel: channelId,
          oldest: oldestTs,
          latest: latestTs,
          limit: 100, // Per-page limit
          cursor,
          include_all_metadata: false, // We only need text, ts, user
        });

        if (!response.ok || !response.messages) {
          break;
        }

        for (const msg of response.messages) {
          if (candidates.length >= 200) {
            break;
          }
          const msgTs = msg.ts;
          if (!msgTs) {
            continue;
          }
          // Skip channel administrivia (join/leave/topic notices etc.) — these
          // aren't evidence a human wrote, just Slack's own system messages.
          if (msg.subtype && NON_CONTENT_SUBTYPES.has(msg.subtype)) {
            continue;
          }
          candidates.push({
            channel: channelId,
            ts: msgTs,
            authorId: msg.user || msg.bot_id || 'unknown',
            text: msg.text || '',
          });
        }

        cursor = response.response_metadata?.next_cursor;
        if (!cursor) {
          break;
        }
        pageCount++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.error(`Failed to fetch history for channel ${channelId}: ${message}`);
        break;
      }
    }
  }

  // Stage 2: only apply keyword filtering once volume is large enough that
  // it actually serves its cost-control purpose.
  const applyKeywordFilter = normalizedKeywords.length > 0 && candidates.length > KEYWORD_FILTER_MESSAGE_THRESHOLD;
  const included = applyKeywordFilter
    ? candidates.filter((c) => {
        const textLower = c.text.toLowerCase();
        return normalizedKeywords.some((kw) => textLower.includes(kw));
      })
    : candidates;

  if (applyKeywordFilter) {
    logger?.info(
      `Keyword prefilter applied (${candidates.length} candidates > ${KEYWORD_FILTER_MESSAGE_THRESHOLD} threshold): ${included.length} survived`
    );
  }

  // Stage 3: fetch permalinks only for the messages that survived filtering.
  const results: RetrievedMessage[] = [];
  for (const c of included) {
    let permalink = '';
    try {
      const permalinkResp = await client.chat.getPermalink({
        channel: c.channel,
        message_ts: c.ts,
      } as any);
      permalink = (permalinkResp as any).permalink || '';
    } catch {
      // If getPermalink fails, leave it empty; the message is still valid
    }
    results.push({ channel: c.channel, ts: c.ts, permalink, authorId: c.authorId, text: c.text });
  }

  return results;
}

/**
 * Main entry point for candidate message retrieval.
 * Tries the Real-Time Search API first (best-effort); if unavailable,
 * falls back to conversations.history with keyword prefiltering.
 *
 * @param client Slack Web API client
 * @param channelIds List of Slack channel IDs to search
 * @param reportingPeriodStart ISO date string (YYYY-MM-DD), inclusive
 * @param reportingPeriodEnd ISO date string (YYYY-MM-DD), inclusive
 * @param keywords List of keywords to prefilter; if empty, no keyword filter applied
 * @returns Array of RetrievedMessage, possibly empty but never null
 */
export async function retrieveCandidateMessages(
  client: WebClient,
  channelIds: string[],
  reportingPeriodStart: string,
  reportingPeriodEnd: string,
  keywords: string[],
  logger?: Logger
): Promise<RetrievedMessage[]> {
  // Build a combined query from keywords for RTS attempt
  const query = keywords.length > 0 ? keywords.join(' OR ') : '*';

  // Try Real-Time Search first
  const rtsResult = await attemptRealTimeSearch(client, query, logger);
  if (rtsResult !== null) {
    return rtsResult;
  }

  // Fall back to conversations.history
  return fetchViaHistoryFallback(client, channelIds, reportingPeriodStart, reportingPeriodEnd, keywords, logger);
}
