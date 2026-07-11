import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/utils/parse';

describe('parseCommand', () => {
  it('コマンドと引数に分解する', () => {
    expect(parseCommand('なくなった 食器用洗剤')).toEqual({ command: 'out', arg: '食器用洗剤' });
    expect(parseCommand('在庫')).toEqual({ command: 'list', arg: '' });
    expect(parseCommand('検索 洗剤')).toEqual({ command: 'search', arg: '洗剤' });
  });

  it('全角スペース・前後空白・連続空白を正規化する', () => {
    expect(parseCommand('買った　トイレットペーパー')).toEqual({ command: 'buy', arg: 'トイレットペーパー' });
    expect(parseCommand('  履歴   米  ')).toEqual({ command: 'history', arg: '米' });
  });

  it('別名を正規コマンドに解決する', () => {
    expect(parseCommand('切れた 米')?.command).toBe('out');
    expect(parseCommand('購入 米')?.command).toBe('buy');
    expect(parseCommand('買い物リスト')?.command).toBe('shortage');
    expect(parseCommand('新規登録 米')?.command).toBe('new');
    expect(parseCommand('変更 米')?.command).toBe('edit');
    expect(parseCommand('使い方')?.command).toBe('help');
  });

  it('ID確認コマンド(whoami)を解決する', () => {
    expect(parseCommand('ID')?.command).toBe('whoami');
    expect(parseCommand('id')?.command).toBe('whoami');
    expect(parseCommand('ユーザーID')?.command).toBe('whoami');
  });

  it('コマンドでないテキストはnull', () => {
    expect(parseCommand('こんにちは')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('引数内の空白は保持する(最初の空白のみで分割)', () => {
    expect(parseCommand('新規 キッチン ハイター')).toEqual({ command: 'new', arg: 'キッチン ハイター' });
  });
});
