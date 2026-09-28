// The bottom nav's tabs, and #favourites / #status / #about links to them

import { loadAboutStats, runStatusCheck } from './infoTabs';
import { createStore } from './store';

const TAB_HASH = { tabRoutes: '', tabFavs: 'favourites', tabStatus: 'status', tabAbout: 'about' };
const HASH_TAB = { '': 'tabRoutes', favourites: 'tabFavs', status: 'tabStatus', about: 'tabAbout' };

export const tabStore = createStore({ active: 'tabRoutes' });

export function switchTab(target, updateHash = true) {
  if (!(target in TAB_HASH)) return;
  tabStore.set({ active: target });
  if (target === 'tabAbout') loadAboutStats();
  if (target === 'tabStatus') runStatusCheck();
  window.scrollTo(0, 0);
  if (updateHash) {
    const hash = TAB_HASH[target];
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  }
}

// Follow the address bar's hash (links, back/forward)
export function watchTabHash() {
  window.addEventListener('hashchange', () => {
    switchTab(HASH_TAB[location.hash.replace('#', '')] || 'tabRoutes', false);
  });
}
