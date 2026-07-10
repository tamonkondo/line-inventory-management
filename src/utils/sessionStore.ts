import type { SessionState } from '../types';

const TTL_SECONDS = 300;

const cacheKey = (userId: string): string => `session:${userId}`;

/**
 * ユーザーごとの会話状態(TTL 300秒)。
 * CacheServiceは揮発性: 消えていても再操作で復帰できる設計にすること(状態消失を致命傷にしない)。
 */
export const SessionStore = {
  get(userId: string): SessionState | null {
    const raw = CacheService.getScriptCache().get(cacheKey(userId));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  },
  set(userId: string, state: SessionState): void {
    CacheService.getScriptCache().put(cacheKey(userId), JSON.stringify(state), TTL_SECONDS);
  },
  clear(userId: string): void {
    CacheService.getScriptCache().remove(cacheKey(userId));
  },
};
