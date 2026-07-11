import { CONFIG, NOTION_PROPS, USER_STATUS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import { LineClient } from '../clients/lineClient';
import { logInfo, logError } from '../utils/logger';
import type { User } from '../types';

const P = NOTION_PROPS.USERS;

const todayStr = (): string => Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

/** LINE ユーザーの登録状態を管理する(F-13/F-15)。 */
export const UserService = {
  /** lineUserIdで1件検索 */
  findByLineUserId(lineUserId: string): User | null {
    const res = NotionClient.queryDataSource(CONFIG.NOTION_USERS_DB_ID, {
      filter: { property: P.LINE_USER_ID, rich_text: { equals: lineUserId } },
      page_size: 1,
    });
    const page = res.results[0];
    return page ? NotionMapper.toUser(page) : null;
  },

  /** 登録 or 再有効化(再フォロー時はページを増やさない) */
  register(lineUserId: string): User {
    const existing = this.findByLineUserId(lineUserId);
    if (existing) {
      NotionClient.updatePage(existing.pageId, {
        properties: { [P.STATUS]: { select: { name: USER_STATUS.ACTIVE } } },
      });
      return { ...existing, active: true };
    }

    // 表示名の取得失敗(ブロック直後等)でも登録は止めない
    let displayName = '(不明)';
    try {
      displayName = LineClient.getProfile(lineUserId).displayName;
    } catch (err) {
      logError('UserService.register:getProfile', err);
    }

    const page = NotionClient.createPage({
      parent: { type: 'data_source_id', data_source_id: CONFIG.NOTION_USERS_DB_ID },
      properties: {
        [P.NAME]: { title: [{ text: { content: displayName } }] },
        [P.LINE_USER_ID]: { rich_text: [{ text: { content: lineUserId } }] },
        [P.STATUS]: { select: { name: USER_STATUS.ACTIVE } },
        [P.REGISTERED_AT]: { date: { start: todayStr() } },
      },
    });
    return NotionMapper.toUser(page);
  },

  /** 無効化(未登録なら何もしない) */
  deactivate(lineUserId: string): void {
    const user = this.findByLineUserId(lineUserId);
    if (!user) {
      logInfo('UserService.deactivate', `not registered: ${lineUserId}`);
      return;
    }
    NotionClient.updatePage(user.pageId, {
      properties: { [P.STATUS]: { select: { name: USER_STATUS.INACTIVE } } },
    });
  },

  /** 有効ユーザー一覧(通知対象) */
  listActive(): User[] {
    const pages = NotionClient.queryAll(CONFIG.NOTION_USERS_DB_ID, {
      filter: { property: P.STATUS, select: { equals: USER_STATUS.ACTIVE } },
    });
    return pages.map((page) => NotionMapper.toUser(page));
  },
};
