// Small pop-ups and banners (CalMac notice, vessel tracker, alert threshold
// picker, share picker, share banner, toast). Each has a store its component
// renders from, and open/close functions components call.

import { getAppState } from './appState';
import { topNotices } from './disruptions';
import { ROUTE_PORTS } from './routes';
import { createStore } from './store';

// Content stays after closing so it's still there while the sheet slides away
export const noticeStore = createStore({ open: false, title: '', detail: '' });
export const vesselStore = createStore({ open: false, vesselName: '', routeName: '', mmsi: null, frameSrc: 'about:blank' });
export const thresholdStore = createStore({ routeName: null, anchor: null, id: 0 });
export const sharePickerStore = createStore({ routeName: null, sailing: null, id: 0 });
export const shareBannerStore = createStore({ text: null });
export const toastStore = createStore({ text: '✅ Link copied!', show: false });

// ── CalMac notice ──
export function openTimetableNotice(routeName, idx = 0) {
  const notice = topNotices(getAppState().disruptions[routeName])[idx];
  if (!notice) return;
  noticeStore.set({ open: true, title: notice.title || 'Service notice', detail: notice.detail || '' });
  document.body.style.overflow = 'hidden';
}

export function closeTimetableNotice() {
  noticeStore.set({ open: false });
  document.body.style.overflow = '';
}

// ── Vessel tracker (MarineTraffic embed centred on the route) ──
let vesselTimer = null;

export function openVesselTracker(routeName, vesselName, mmsi) {
  const ports = ROUTE_PORTS[routeName];
  const midLat = ports ? ((ports.a[0] + ports.b[0]) / 2).toFixed(4) : '57.0';
  const midLon = ports ? ((ports.a[1] + ports.b[1]) / 2).toFixed(4) : '-5.5';
  const zoom   = ports ? 10 : 8;
  const embedUrl = `https://www.marinetraffic.com/en/ais/embed/zoom:${zoom}/centery:${midLat}/centerx:${midLon}/maptype:0/shownames:false/mmsi:${mmsi || 0}/shipid:0/fleet:/fleet_id:/vtypes:/showmenu:/remember:false`;

  clearTimeout(vesselTimer);
  vesselStore.set({ open: true, vesselName: vesselName || 'Vessel Tracker', routeName: routeName || '', mmsi: mmsi || null });
  document.body.style.overflow = 'hidden';
  // Let the sheet start sliding in before the map starts loading
  vesselTimer = setTimeout(() => vesselStore.set({ frameSrc: embedUrl }), 80);
}

export function closeVesselTracker() {
  clearTimeout(vesselTimer);
  vesselStore.set({ open: false });
  document.body.style.overflow = '';
  // Unload the map once hidden so it stops running in the background
  vesselTimer = setTimeout(() => vesselStore.set({ frameSrc: 'about:blank' }), 300);
}

// ── Alert threshold picker, shown before turning alerts on ──
// anchor is the button that opened it; tapping it doesn't count as outside
export function showThresholdPicker(routeName, anchor = null) {
  thresholdStore.set({ routeName, anchor, id: thresholdStore.get().id + 1 });
}

export function closeThresholdPicker() {
  thresholdStore.set({ routeName: null, anchor: null });
}

// ── Share ──
// A name picker first, so navigator.share can run straight from the Share tap
// (iOS needs it inside the gesture)
export function shareRoute(routeName, sailing) {
  sharePickerStore.set({ routeName, sailing: sailing || null, id: sharePickerStore.get().id + 1 });
}

export function closeSharePicker() {
  sharePickerStore.set({ routeName: null, sailing: null });
}

export function showShareBanner(text) {
  shareBannerStore.set({ text });
}

let toastTimer = null;
export function showToast(text, ms) {
  clearTimeout(toastTimer);
  toastStore.set({ text, show: true });
  toastTimer = setTimeout(() => toastStore.set({ show: false }), ms);
}
