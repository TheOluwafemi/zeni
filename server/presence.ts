// One global Durable Object that counts who's around (see presence-core.ts). It keeps everything
// in memory: if it's evicted while nobody is pinging, the counts simply start again from zero.

import { DurableObject } from "cloudflare:workers";
import type { Difficulty } from "../shared/constants";
import { PresenceBook, type PresenceInfo } from "./presence-core";

export class Presence extends DurableObject<Env> {
  private book = new PresenceBook();

  async ping(session: unknown): Promise<PresenceInfo> {
    return this.book.ping(session, Date.now());
  }

  async leave(session: unknown): Promise<void> {
    this.book.leave(session);
  }

  /** Called by the Quick Match queues whenever their size changes. */
  async setSearching(table: Difficulty, count: number): Promise<void> {
    this.book.setSearching(table, count);
  }
}
