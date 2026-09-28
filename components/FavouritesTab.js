export default function FavouritesTab() {
  return (
    <div className="tab-page" id="tabFavs">
      <div id="favsGrid" className="routes-grid" />
      <div id="favsEmpty" className="favs-empty" style={{display: 'none'}}>
        <div className="big-icon">⭐</div>
        <p>No favourite routes yet.<br />Tap the ★ on any route to save it here.</p>
      </div>
    </div>
  );
}
