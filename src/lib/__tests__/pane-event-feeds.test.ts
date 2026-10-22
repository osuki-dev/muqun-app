import { describe, expect, test } from 'bun:test';

import {
  hasSharedPaneFeed,
  openPaneFeed,
  paneFeedKey,
  subscribeSharedPaneFeeds,
  watchPaneFeed,
} from '../pane-event-feeds';

describe('pane event feeds', () => {
  test('a screen feed is shared; a borrower is not, and closing ends both', () => {
    const key = paneFeedKey('http://desk:7777/', 'main');
    expect(key).toBe(paneFeedKey('http://desk:7777', 'main'));
    let changes = 0;
    const unsubscribe = subscribeSharedPaneFeeds(() => (changes += 1));
    const borrowed = openPaneFeed(key, true);
    expect(hasSharedPaneFeed(key)).toBe(false);
    const drawer = openPaneFeed(key, false);
    expect(hasSharedPaneFeed(key)).toBe(true);
    expect(hasSharedPaneFeed(paneFeedKey('http://desk:7777', 'other'))).toBe(false);
    drawer.close();
    drawer.close();
    borrowed.close();
    expect(hasSharedPaneFeed(key)).toBe(false);
    expect(changes).toBe(2);
    unsubscribe();
  });

  test('watchers hear changes and whether any feed is connected', () => {
    const key = paneFeedKey('http://desk:7777', 'live');
    const heard: string[] = [];
    const unwatch = watchPaneFeed(key, {
      onLive: (live) => heard.push(`live:${live}`),
      onChanged: (paneId) => heard.push(paneId),
    });
    const own = openPaneFeed(key, true);
    own.connected(true);
    // The drawer opens; the Stage's own feed hands over to it.
    const drawer = openPaneFeed(key, false);
    own.close();
    drawer.connected(true);
    drawer.changed('p1');
    drawer.connected(false);
    drawer.close();
    // A closed feed says nothing more.
    drawer.changed('p2');
    drawer.connected(true);
    unwatch();
    expect(heard).toEqual([
      'live:false',
      'live:true',
      'live:false',
      'live:true',
      'p1',
      'live:false',
    ]);
  });
});
