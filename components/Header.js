export default function Header() {
  return (
    <header>
      <div className="header-inner">
        <div className="header-logo">
          <div className="ferry-icon">⛴️</div>
          <div className="site-name">Will It Sail?</div>
        </div>
        <h1>CalMac <span>Sailing</span> Predictor</h1>
        <p className="subtitle">Unofficial weather-based predictions for all CalMac routes across Scotland's west coast and islands.</p>
      </div>
      <svg className="wave-divider" viewBox="0 0 1440 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        <path d="M0,20 C240,40 480,0 720,20 C960,40 1200,0 1440,20 L1440,40 L0,40 Z" fill="#f4f7fb" />
      </svg>
    </header>
  );
}
