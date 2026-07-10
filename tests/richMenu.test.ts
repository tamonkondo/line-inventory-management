import { describe, it, expect } from 'vitest';
import richMenuDef from '../assets/richmenu/richmenu.json';

/** リッチメニュー定義が実装書11のpostback表・LINE APIの制約と整合していることの検証 */
describe('richmenu.json', () => {
  it('2500x1686・6区画・chatBarTextを持つ', () => {
    expect(richMenuDef.size).toEqual({ width: 2500, height: 1686 });
    expect(richMenuDef.areas).toHaveLength(6);
    expect(richMenuDef.chatBarText).toBe('在庫メニュー');
    expect(richMenuDef.selected).toBe(true);
  });

  it('postback dataがハンドラ側のアクション定義と一致する', () => {
    const data = richMenuDef.areas.map((area) => area.action.data);
    expect(data).toEqual([
      'action=list',
      'action=shortage',
      'action=out&step=start',
      'action=buy&step=start',
      'action=new&step=start',
      'action=help',
    ]);
  });

  it('全ボタンがpostback型でdisplayTextを持つ', () => {
    for (const area of richMenuDef.areas) {
      expect(area.action.type).toBe('postback');
      expect(area.action.displayText.length).toBeGreaterThan(0);
    }
  });

  it('区画がキャンバス全体を隙間・重なりなく覆う', () => {
    const total = richMenuDef.areas.reduce((sum, area) => sum + area.bounds.width * area.bounds.height, 0);
    expect(total).toBe(2500 * 1686);
    for (const area of richMenuDef.areas) {
      expect(area.bounds.x + area.bounds.width).toBeLessThanOrEqual(2500);
      expect(area.bounds.y + area.bounds.height).toBeLessThanOrEqual(1686);
    }
  });
});
