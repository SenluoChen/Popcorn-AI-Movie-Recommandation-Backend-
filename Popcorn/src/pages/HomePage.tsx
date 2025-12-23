// note: src/pages/HomePage.tsx
import { useState } from "react";
import "../App.css";
import { useNavigate } from "react-router-dom";

import BannerCarousel from "../components/BannerCarousel";
import Navbar from "../components/Navbar";
import Footer from "../components/footer";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const pageBg = "var(--brand-900)";
  const accent = "var(--accent-500)";
  const surfaceMuted = "rgba(255,255,255,0.72)";

  return (
    <>
      <Navbar
        query={query}
        setQuery={setQuery}
        onRecommend={(nextResults, usedQuery) => {
          const q = String(usedQuery || query || "").trim();
          navigate(`/search?q=${encodeURIComponent(q)}`, {
            state: { results: nextResults, q },
          });
        }}
      />

      <div style={{ backgroundColor: pageBg }}>
        <Container style={{ paddingTop: 18, paddingBottom: 28 }}>
          <div
            style={{
              background: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              padding: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-invert)", letterSpacing: "-0.02em" }}>
                  Discover your next movie
                </div>
                <div style={{ fontSize: 13, color: surfaceMuted, marginTop: 4 }}>
                  Try natural language: mood, era, language, or genre.
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: accent,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                AI recommendations
              </div>
            </div>
            <BannerCarousel />
          </div>
        </Container>

        <Container style={{ paddingTop: 0, paddingBottom: 20 }}>
          <div
            style={{
              background: "transparent",
              borderRadius: 0,
              boxShadow: "none",
              padding: 0,
              textAlign: "center",
              color: surfaceMuted,
              lineHeight: 1.6,
            }}
          >
            {/* Instruction text removed per request */}
          </div>
        </Container>
      </div>

      <Footer />
    </>
  );
}

function Container({
  children,
  style = {},
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1200,
        margin: "0 auto",
        padding: "0 20px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
