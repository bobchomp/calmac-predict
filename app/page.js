import AboutTab from "../components/AboutTab";
import { AppStart } from "../components/AppStart";
import { InstallBanner, OfflineBanner } from "../components/AppBanners";
import BottomNav from "../components/BottomNav";
import FavouritesTab from "../components/FavouritesTab";
import Header from "../components/Header";
import LoadingScreen from "../components/LoadingScreen";
import NoticePopup from "../components/NoticePopup";
import { SharePicker, ThresholdPicker } from "../components/Pickers";
import RouteModal from "../components/RouteModal";
import RoutesTab from "../components/RoutesTab";
import ShareBanner from "../components/ShareBanner";
import ShareToast from "../components/ShareToast";
import StatusBar from "../components/StatusBar";
import StatusTab from "../components/StatusTab";
import Toolbar from "../components/Toolbar";
import VesselTracker from "../components/VesselTracker";

// The whole page; components/AppStart.js loads the data once it has hydrated.
export default function Home() {
  return (
    <>
      <OfflineBanner />
      <LoadingScreen />
      <Header />
      <ShareBanner />
      <Toolbar />
      <main>
        <StatusBar />
        <RoutesTab />
        <FavouritesTab />
        <StatusTab />
        <AboutTab />
      </main>
      <ShareToast />
      <BottomNav />
      <RouteModal />
      <VesselTracker />
      <NoticePopup />
      <ThresholdPicker />
      <SharePicker />
      <InstallBanner />
      <AppStart />
    </>
  );
}
