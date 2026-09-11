/**
 * Character card storage.
 *
 * Why this exists: cards used to live in a plain Map, so restarting the server
 * forgot every uploaded character. The browser papered over it by re-sending the
 * card it still held, which works but means a fresh page load after a restart
 * loses the character entirely.
 *
 * Design: memory is a hot cache, Redis is the durability layer.
 *
 *   store() writes to both. get() reads memory first, then Redis, and warms the
 *   cache on a hit.
 *
 * Consequence: if Redis is unreachable — not installed, container stopped,
 * network gone — everything still works exactly as it did before, just without
 * surviving a restart. No code path depends on Redis being up, which is the only
 * way it is safe to add a dependency a day before a demo.
 */

import { createClient } from "redis";

/** Cards expire rather than accumulating forever. */
const TTL_SECONDS = 60 * 60 * 24;

/** Transcripts are shorter-lived than cards: they are for resuming, not history. */
const TRANSCRIPT_TTL_SECONDS = 60 * 60 * 2;

/**
 * How many turns to keep and replay.
 *
 * Every replayed turn is added to the provider session and counts toward the
 * prompt, so this trades memory against latency and cost. Twelve is about six
 * exchanges, enough for callbacks to feel real without noticeably slowing the
 * first reply.
 */
const MAX_TURNS = 12;

/** Cap on the in-memory cache, independent of Redis. */
const MAX_CACHED = 32;

const KEY_PREFIX = "framinu:character:";
const TRANSCRIPT_PREFIX = "framinu:transcript:";

function newId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createCharacterStore({ url, log = console.log } = {}) {
  const cache = new Map();
  const transcripts = new Map();
  let redis = null;

  if (url) {
    try {
      redis = createClient({
        url,
        socket: {
          // Fail fast rather than hanging server startup on an unreachable host.
          connectTimeout: 3000,
          // One retry, then give up and run from memory. Reconnecting forever
          // would spam the log during a demo.
          reconnectStrategy: (retries) => (retries > 1 ? false : 500),
        },
      });

      // Without a listener, a connection error becomes an unhandled exception
      // and takes the whole server down. That would turn an optional dependency
      // into a fatal one.
      redis.on("error", (err) => {
        if (redis?.isReady) log(`[store] redis error: ${err.message}`);
      });

      await redis.connect();
      await redis.ping();
      log(`[store] redis connected, cards persist across restarts`);
    } catch (err) {
      // node-redis can throw an AggregateError whose message is empty, so fall
      // through to the code and name before giving up on describing it.
      const reason =
        err?.message ||
        err?.code ||
        err?.errors?.[0]?.message ||
        err?.name ||
        String(err);
      log(`[store] redis unavailable (${reason}); using memory only`);
      try {
        await redis?.destroy?.();
      } catch {}
      redis = null;
    }
  } else {
    log("[store] REDIS_URL not set; using memory only");
  }

  const rememberLocally = (id, card) => {
    cache.set(id, card);
    while (cache.size > MAX_CACHED) {
      cache.delete(cache.keys().next().value);
    }
  };

  return {
    get backend() {
      return redis?.isReady ? "redis" : "memory";
    },

    /** @returns {Promise<string>} the new card id */
    async store(card) {
      const id = newId();
      rememberLocally(id, card);

      if (redis?.isReady) {
        try {
          await redis.setEx(KEY_PREFIX + id, TTL_SECONDS, JSON.stringify(card));
        } catch (err) {
          // Non-fatal: the card is already in the cache, so this session works.
          log(`[store] redis write failed: ${err?.message}`);
        }
      }

      return id;
    },

    /** @returns {Promise<object|null>} the card, or null if forgotten */
    async get(id) {
      const cached = cache.get(id);
      if (cached) return cached;

      if (redis?.isReady) {
        try {
          const raw = await redis.get(KEY_PREFIX + id);
          if (raw) {
            const card = JSON.parse(raw);
            // Warm the cache so repeated connects skip the round trip.
            rememberLocally(id, card);
            return card;
          }
        } catch (err) {
          log(`[store] redis read failed: ${err?.message}`);
        }
      }

      return null;
    },

    /**
     * Record one turn of conversation.
     *
     * The provider has no session resume, so a dropped connection previously
     * meant the character forgot everything said before it. Keeping the
     * transcript here lets a new session be replayed into the same state.
     *
     * Stored as a capped list, oldest dropped first.
     */
    async appendTurn(conversationId, turn) {
      if (!conversationId || !turn?.text) return;

      const existing = transcripts.get(conversationId) ?? [];
      const next = [...existing, turn].slice(-MAX_TURNS);
      transcripts.set(conversationId, next);
      while (transcripts.size > MAX_CACHED) {
        transcripts.delete(transcripts.keys().next().value);
      }

      if (redis?.isReady) {
        try {
          const key = TRANSCRIPT_PREFIX + conversationId;
          await redis.setEx(key, TRANSCRIPT_TTL_SECONDS, JSON.stringify(next));
        } catch (err) {
          log(`[store] transcript write failed: ${err?.message}`);
        }
      }
    },

    /** @returns {Promise<Array<{role: string, text: string}>>} oldest first */
    async getTurns(conversationId) {
      if (!conversationId) return [];

      const cached = transcripts.get(conversationId);
      if (cached) return cached;

      if (redis?.isReady) {
        try {
          const raw = await redis.get(TRANSCRIPT_PREFIX + conversationId);
          if (raw) {
            const turns = JSON.parse(raw);
            if (Array.isArray(turns)) {
              transcripts.set(conversationId, turns);
              return turns;
            }
          }
        } catch (err) {
          log(`[store] transcript read failed: ${err?.message}`);
        }
      }

      return [];
    },

    /** Deliberate reset, so a new subject does not inherit an old conversation. */
    async clearTurns(conversationId) {
      if (!conversationId) return;
      transcripts.delete(conversationId);
      if (redis?.isReady) {
        try {
          await redis.del(TRANSCRIPT_PREFIX + conversationId);
        } catch {}
      }
    },

    async close() {
      try {
        await redis?.quit();
      } catch {}
    },
  };
}
