import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WebClient } from '@slack/web-api';
import {
  attemptRealTimeSearch,
  fetchViaHistoryFallback,
  retrieveCandidateMessages,
  type RetrievedMessage,
} from '../../src/slack/retrieval';

function createMockClient(): WebClient {
  return {
    apiCall: vi.fn(),
    conversations: { history: vi.fn() } as any,
    chat: { getPermalink: vi.fn() } as any,
  } as any;
}

function createSlackTs(daysAgo: number = 0): string {
  const date = new Date('2026-07-15');
  date.setDate(date.getDate() - daysAgo);
  const seconds = Math.floor(date.getTime() / 1000);
  return `${seconds}.0`;
}

describe('Slack Retrieval Module', () => {
  describe('attemptRealTimeSearch', () => {
    it('should return null when RTS is unavailable', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockRejectedValueOnce(
        new Error('assistant.search.context is not available')
      );
      const result = await attemptRealTimeSearch(client, 'students served');
      expect(result).toBeNull();
      expect((client as any).apiCall).toHaveBeenCalledWith('assistant.search.context', {
        query: 'students served',
      });
    });

    it('should return null when API returns ok=false', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockResolvedValueOnce({ ok: false, error: 'disabled' });
      const result = await attemptRealTimeSearch(client, 'test query');
      expect(result).toBeNull();
    });

    it('should not throw on any error', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockRejectedValueOnce(new Error('Network error'));
      const result = await attemptRealTimeSearch(client, 'query');
      expect(result).toBeNull();
    });

    it('should map RTS response items to RetrievedMessage', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockResolvedValueOnce({
        ok: true,
        items: [
          {
            channel_id: 'C123',
            ts: '1234567890.123456',
            permalink: 'https://workspace.slack.com/archives/C123/p1234567890123456',
            user_id: 'U456',
            text: 'We served 50 students',
          },
        ],
      });
      const result = await attemptRealTimeSearch(client, 'students');
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({
        channel: 'C123',
        ts: '1234567890.123456',
        permalink: 'https://workspace.slack.com/archives/C123/p1234567890123456',
        authorId: 'U456',
        text: 'We served 50 students',
      });
    });
  });

  describe('fetchViaHistoryFallback', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should NOT keyword-filter below the volume threshold (real evidence must not be silently dropped)', async () => {
      // Requirement-label-derived keywords rarely match casual phrasing (e.g. "attendance"
      // vs. "54 students attended"), so below KEYWORD_FILTER_MESSAGE_THRESHOLD every
      // candidate message should pass through untouched regardless of keyword match.
      const client = createMockClient();
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: createSlackTs(0), user: 'U1', text: 'We served 50 students' },
          { ts: createSlackTs(1), user: 'U2', text: 'The weather was great' },
          { ts: createSlackTs(2), user: 'U3', text: 'Attendance shows 45 participants' },
        ],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValue({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        ['students', 'participants']
      );
      expect(result).toHaveLength(3);
    });

    it('should keyword-filter once candidate volume exceeds the threshold', async () => {
      const client = createMockClient();
      const noise = Array.from({ length: 40 }, (_, i) => ({
        ts: createSlackTs(i % 30),
        user: 'U1',
        text: `Unrelated chatter ${i}`,
      }));
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: createSlackTs(0), user: 'U1', text: 'We served 50 students' },
          ...noise,
          { ts: createSlackTs(2), user: 'U3', text: 'Attendance shows 45 participants' },
        ],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValue({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        ['students', 'participants']
      );
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.text)).toEqual([
        'We served 50 students',
        'Attendance shows 45 participants',
      ]);
    });

    it('should respect the 200-message cap', async () => {
      const client = createMockClient();
      const messages1 = Array.from({ length: 150 }, (_, i) => ({
        ts: createSlackTs(i % 30),
        user: 'U1',
        text: `Message ${i}`,
      }));
      const messages2 = Array.from({ length: 100 }, (_, i) => ({
        ts: createSlackTs((i + 150) % 30),
        user: 'U2',
        text: `Message ${i}`,
      }));
      let callIndex = 0;
      (client as any).conversations.history.mockImplementation(async () => {
        const isFirstChannel = callIndex === 0;
        callIndex++;
        return {
          ok: true,
          messages: isFirstChannel ? messages1 : messages2,
          response_metadata: {},
        };
      });
      (client as any).chat.getPermalink.mockResolvedValue({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123', 'C456'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(200);
      expect(result.slice(0, 150).every((m) => m.channel === 'C123')).toBe(true);
      expect(result.slice(150, 200).every((m) => m.channel === 'C456')).toBe(true);
    });

    it('should build RetrievedMessage with all five fields', async () => {
      const client = createMockClient();
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: createSlackTs(0), user: 'U_alice', text: 'Test message' },
        ],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValueOnce({
        permalink: 'https://workspace.slack.com/archives/C_test/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C_test'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(1);
      const msg = result[0];
      expect(msg.channel).toBe('C_test');
      expect(msg.ts).toBe(createSlackTs(0));
      expect(msg.permalink).toBe('https://workspace.slack.com/archives/C_test/p123');
      expect(msg.authorId).toBe('U_alice');
      expect(msg.text).toBe('Test message');
    });

    it('should handle messages with bot_id', async () => {
      const client = createMockClient();
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: createSlackTs(0), bot_id: 'B_somebot', text: 'Bot message' }],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValueOnce({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(1);
      expect(result[0].authorId).toBe('B_somebot');
    });

    it('should continue if getPermalink fails', async () => {
      const client = createMockClient();
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [{ ts: createSlackTs(0), user: 'U1', text: 'Message text' }],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockRejectedValueOnce(new Error('Permission denied'));
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(1);
      expect(result[0].permalink).toBe('');
      expect(result[0].text).toBe('Message text');
    });

    it('should skip channels that fail', async () => {
      const client = createMockClient();
      (client as any).conversations.history.mockRejectedValueOnce(
        new Error('Channel not found')
      );
      const result = await fetchViaHistoryFallback(
        client,
        ['C_bad'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toEqual([]);
    });

    it('should handle empty keyword list', async () => {
      const client = createMockClient();
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: createSlackTs(0), user: 'U1', text: 'Random message' },
          { ts: createSlackTs(1), user: 'U2', text: 'Another topic' },
        ],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValue({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(2);
    });

    it('should handle pagination', async () => {
      const client = createMockClient();
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        ts: createSlackTs(i % 30),
        user: 'U1',
        text: `Message ${i}`,
      }));
      const page2 = Array.from({ length: 50 }, (_, i) => ({
        ts: createSlackTs((i + 100) % 30),
        user: 'U2',
        text: `Message ${i + 100}`,
      }));
      let pageIndex = 0;
      (client as any).conversations.history.mockImplementation(async () => {
        pageIndex++;
        if (pageIndex === 1) {
          return {
            ok: true,
            messages: page1,
            response_metadata: { next_cursor: 'cursor_page2' },
          };
        }
        return { ok: true, messages: page2, response_metadata: {} };
      });
      (client as any).chat.getPermalink.mockResolvedValue({
        permalink: 'https://workspace.slack.com/archives/C123/p123',
      });
      const result = await fetchViaHistoryFallback(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect(result).toHaveLength(150);
      expect((client as any).conversations.history).toHaveBeenCalledTimes(2);
    });
  });

  describe('retrieveCandidateMessages', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should use RTS if available', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockResolvedValueOnce({
        ok: true,
        items: [
          {
            channel_id: 'C123',
            ts: '1234567890.0',
            permalink: 'https://example.com/1',
            user_id: 'U1',
            text: 'RTS result',
          },
        ],
      });
      const result = await retrieveCandidateMessages(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        ['students']
      );
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('RTS result');
      expect((client as any).conversations.history).not.toHaveBeenCalled();
    });

    it('should fall back to conversations.history when RTS returns null', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockRejectedValueOnce(new Error('RTS unavailable'));
      (client as any).conversations.history.mockResolvedValueOnce({
        ok: true,
        messages: [
          { ts: createSlackTs(0), user: 'U1', text: 'Fallback with students' },
        ],
        response_metadata: {},
      });
      (client as any).chat.getPermalink.mockResolvedValueOnce({
        permalink: 'https://example.com/fallback',
      });
      const result = await retrieveCandidateMessages(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        ['students']
      );
      expect(result).toHaveLength(1);
      expect(result[0].text).toContain('students');
      expect((client as any).conversations.history).toHaveBeenCalled();
    });

    it('should build query string from keywords', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockResolvedValueOnce({ ok: true, items: [] });
      await retrieveCandidateMessages(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        ['students', 'participants', 'attendance']
      );
      expect((client as any).apiCall).toHaveBeenCalledWith(
        'assistant.search.context',
        { query: 'students OR participants OR attendance' }
      );
    });

    it('should use wildcard when no keywords', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockResolvedValueOnce({ ok: true, items: [] });
      await retrieveCandidateMessages(
        client,
        ['C123'],
        '2026-07-01',
        '2026-07-31',
        []
      );
      expect((client as any).apiCall).toHaveBeenCalledWith(
        'assistant.search.context',
        { query: '*' }
      );
    });

    it('should never throw and always return array', async () => {
      const client = createMockClient();
      (client as any).apiCall.mockRejectedValueOnce(new Error('RTS error'));
      (client as any).conversations.history.mockRejectedValueOnce(
        new Error('History error')
      );
      const result = await retrieveCandidateMessages(
        client,
        ['C_bad'],
        '2026-07-01',
        '2026-07-31',
        ['test']
      );
      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
