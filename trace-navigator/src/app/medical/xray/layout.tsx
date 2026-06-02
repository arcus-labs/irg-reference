import './xray.css';

export const metadata = {
  title: 'X-Ray IRG — Decision Support',
  description: 'X-ray diagnostic decision-support powered by Iterative Reasoning Graphs',
};

// Nested layout: renders inside trace-navigator's root layout (html/body/auth).
// Everything is wrapped in .xray-app so the imported X-ray styles stay scoped
// and don't bleed into the rest of the navigator.
export default function XrayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="xray-app">
      <nav>
        <a href="/medical/xray" className="nav-mark">
          X-Ray <span>IRG</span>
        </a>
        <div className="nav-links">
          <a href="/">← Home</a>
          <a href="/medical/xray">Cases</a>
          <a href="/medical/xray" className="nav-cta">New Case</a>
        </div>
      </nav>
      <main>{children}</main>
      <footer>
        <span className="footer-mark">X-Ray IRG · Decision Support</span>
        <span className="footer-links">
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--stone-light)' }}>
            Not a medical diagnosis
          </span>
        </span>
      </footer>
    </div>
  );
}
