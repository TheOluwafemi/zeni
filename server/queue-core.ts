// The rules of the Quick Match queue, as pure logic (the Matchmaker Durable Object stores the entries
// in its sockets and carries out the actions this returns).
//
// Pairing is a short handshake: two players are offered a match and each has a few seconds to accept.
// Someone actively watching the search screen accepts automatically; someone playing the computer
// while they wait sees "Opponent found! Join?". If one declines, leaves or lets it run out, the other
// goes straight back into the queue, keeping their original place in line.

import type { Difficulty } from "../shared/constants";
import type { QueueServerMsg } from "../shared/protocol";
import { nextRetry, pickPairs } from "./matchmaking";

/** How long both players have to accept an offer. */
export const OFFER_MS = 12_000;
/** If both accepted but no room arrived this long after the offer ran out (the object restarted mid-open), give up. */
export const OPEN_GRACE_MS = 15_000;

export interface Offer {
  id: string;
  /** The other player's socket id. */
  partner: string;
  accepted: boolean;
  expiresAt: number;
}

export interface QEntry {
  /** Socket id. */
  sid: string;
  playerId: string;
  nickname: string;
  rating: number;
  /** When they joined the queue. Kept when they're put back after a failed offer. */
  since: number;
  offer: Offer | null;
}

export type QAction =
  | { kind: "send"; sid: string; msg: QueueServerMsg }
  | { kind: "close"; sid: string; code: number; reason: string }
  /** Both accepted: open a room reserved for these two players. */
  | { kind: "open"; offer: string; sids: [string, string]; players: [string, string] };

export const CLOSE = { matched: 1000, declined: 1000, replaced: 4409, expired: 4408 } as const;

export class QueueCore {
  constructor(
    readonly entries: Map<string, QEntry>,
    readonly table: Difficulty,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Players in line who haven't been offered a match yet. */
  waiting(): QEntry[] {
    return [...this.entries.values()].filter((e) => e.offer === null);
  }

  /** A player asks to queue. A second tab for the same player replaces the first. */
  join(entry: Omit<QEntry, "offer">): QAction[] {
    const actions: QAction[] = [];
    for (const other of [...this.entries.values()]) {
      if (other.playerId === entry.playerId && other.sid !== entry.sid) {
        actions.push({ kind: "send", sid: other.sid, msg: { t: "error", error: "already_queued" } });
        actions.push({ kind: "close", sid: other.sid, code: CLOSE.replaced, reason: "already_queued" });
        actions.push(...this.remove(other.sid, "left"));
      }
    }
    this.entries.set(entry.sid, { ...entry, offer: null });
    actions.push({ kind: "send", sid: entry.sid, msg: { t: "queued", waiting: this.waiting().length } });
    return actions;
  }

  /** Offer matches to as many waiting players as the pairing rules allow. */
  pair(now: number): QAction[] {
    const waiting = this.waiting();
    const pairs = pickPairs(
      waiting.map((e) => ({ id: e.sid, rating: e.rating, since: e.since })),
      now,
    );
    const actions: QAction[] = [];
    for (const [a, b] of pairs) {
      const ea = this.entries.get(a.id)!;
      const eb = this.entries.get(b.id)!;
      const id = this.newId();
      const expiresAt = now + OFFER_MS;
      ea.offer = { id, partner: eb.sid, accepted: false, expiresAt };
      eb.offer = { id, partner: ea.sid, accepted: false, expiresAt };
      for (const [me, them] of [
        [ea, eb],
        [eb, ea],
      ] as const) {
        actions.push({
          kind: "send",
          sid: me.sid,
          msg: { t: "offer", offer: id, table: this.table, expiresIn: OFFER_MS, opponent: { nickname: them.nickname, rating: them.rating } },
        });
      }
    }
    return actions;
  }

  accept(sid: string, offerId: string): QAction[] {
    const me = this.entries.get(sid);
    if (!me?.offer || me.offer.id !== offerId) return [];
    me.offer.accepted = true;
    const partner = this.entries.get(me.offer.partner);
    if (!partner?.offer?.accepted) return []; // waiting for the other player to say yes
    return [{ kind: "open", offer: offerId, sids: [partner.sid, me.sid], players: [partner.playerId, me.playerId] }];
  }

  /** Declining leaves the queue entirely; the other player goes back into line. */
  decline(sid: string, offerId: string): QAction[] {
    const me = this.entries.get(sid);
    if (!me?.offer || me.offer.id !== offerId) return [];
    return [{ kind: "close", sid, code: CLOSE.declined, reason: "declined" }, ...this.remove(sid, "declined")];
  }

  /** A socket closed. If they were part of an offer, their partner goes back into line. */
  gone(sid: string): QAction[] {
    return this.remove(sid, "left");
  }

  /** Offers that ran out: whoever didn't accept leaves the queue, whoever did goes back into line. */
  expire(now: number): QAction[] {
    const actions: QAction[] = [];
    for (const e of [...this.entries.values()]) {
      const offer = e.offer;
      if (!this.entries.has(e.sid) || !offer || offer.expiresAt > now) continue;
      const partner = this.entries.get(offer.partner);
      if (offer.accepted && partner?.offer?.accepted) {
        // Both said yes: the room is being opened. Only step in if that clearly never finished.
        if (now >= offer.expiresAt + OPEN_GRACE_MS) actions.push(...this.openFailed(offer.id));
        continue;
      }
      if (!offer.accepted && partner?.offer?.id === offer.id && !partner.offer.accepted) {
        // Neither answered: both leave (removing one would otherwise put the other back in line).
        for (const sid of [e.sid, partner.sid]) {
          actions.push({ kind: "close", sid, code: CLOSE.expired, reason: "offer_expired" });
          this.entries.delete(sid);
        }
      } else if (!offer.accepted) {
        actions.push({ kind: "close", sid: e.sid, code: CLOSE.expired, reason: "offer_expired" });
        actions.push(...this.remove(e.sid, "expired"));
      }
    }
    return actions;
  }

  /** The room is ready: send both players to it. */
  opened(offerId: string, room: string): QAction[] {
    const actions: QAction[] = [];
    for (const e of [...this.entries.values()]) {
      if (e.offer?.id !== offerId) continue;
      actions.push({ kind: "send", sid: e.sid, msg: { t: "matched", room, table: this.table } });
      actions.push({ kind: "close", sid: e.sid, code: CLOSE.matched, reason: "matched" });
      this.entries.delete(e.sid);
    }
    return actions;
  }

  /** Opening a room failed: put both back in line, keeping their places. */
  openFailed(offerId: string): QAction[] {
    const actions: QAction[] = [];
    for (const e of this.entries.values()) {
      if (e.offer?.id !== offerId) continue;
      e.offer = null;
      actions.push({ kind: "send", sid: e.sid, msg: { t: "offer_cancelled", reason: "server" } });
    }
    return actions;
  }

  /** When the queue next needs attention: an offer running out, or the next pairing attempt. */
  nextWake(now: number): number | null {
    const times: number[] = [];
    for (const e of this.entries.values()) {
      if (!e.offer) continue;
      const bothAccepted = e.offer.accepted && this.entries.get(e.offer.partner)?.offer?.accepted;
      times.push(bothAccepted ? e.offer.expiresAt + OPEN_GRACE_MS : e.offer.expiresAt);
    }
    const retry = nextRetry(this.waiting().map((e) => ({ id: e.sid, rating: e.rating, since: e.since })), now);
    if (retry !== null) times.push(retry); // the acceptable rating gap widens with time
    return times.length ? Math.min(...times) : null;
  }

  /** Offers whose partner is no longer here (their socket dropped while the queue was asleep): back in line. */
  dropOrphans(): QAction[] {
    const actions: QAction[] = [];
    for (const e of this.entries.values()) {
      if (e.offer && this.entries.get(e.offer.partner)?.offer?.id !== e.offer.id) {
        e.offer = null;
        actions.push({ kind: "send", sid: e.sid, msg: { t: "offer_cancelled", reason: "left" } });
      }
    }
    return actions;
  }

  /** Take someone out of the queue. If they were part of an offer, put their partner back in line. */
  private remove(sid: string, reason: "declined" | "expired" | "left"): QAction[] {
    const me = this.entries.get(sid);
    if (!me) return [];
    this.entries.delete(sid);
    const partner = me.offer ? this.entries.get(me.offer.partner) : undefined;
    if (!partner || partner.offer?.id !== me.offer?.id) return [];
    partner.offer = null;
    return [{ kind: "send", sid: partner.sid, msg: { t: "offer_cancelled", reason } }];
  }
}
