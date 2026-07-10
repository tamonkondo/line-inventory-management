export type CommandName =
  | 'list' | 'shortage' | 'out' | 'buy' | 'new'
  | 'history' | 'search' | 'edit' | 'help';

export interface ParsedCommand {
  command: CommandName;
  arg: string; // 引数なしは ''
}

/** コマンドの別名テーブル(正規名へ解決) */
const COMMAND_ALIASES: Record<string, CommandName> = {
  '在庫': 'list', '一覧': 'list', '在庫一覧': 'list',
  '不足': 'shortage', '不足一覧': 'shortage', '買い物': 'shortage', '買い物リスト': 'shortage',
  'なくなった': 'out', '切れた': 'out', 'ない': 'out',
  '買った': 'buy', '買いました': 'buy', '購入': 'buy',
  '新規': 'new', '新規登録': 'new', '登録': 'new',
  '履歴': 'history',
  '検索': 'search',
  '編集': 'edit', '変更': 'edit',
  'ヘルプ': 'help', 'help': 'help', '使い方': 'help',
};

/** 「なくなった 食器用洗剤」等をコマンドと引数に分解する。コマンドでなければnull */
export const parseCommand = (text: string): ParsedCommand | null => {
  const normalized = text.trim().replace(/　/g, ' ').replace(/ +/g, ' ');
  if (!normalized) return null;

  const spaceIndex = normalized.indexOf(' ');
  const head = spaceIndex === -1 ? normalized : normalized.slice(0, spaceIndex);
  const arg = spaceIndex === -1 ? '' : normalized.slice(spaceIndex + 1).trim();

  const command = COMMAND_ALIASES[head];
  return command ? { command, arg } : null;
};
