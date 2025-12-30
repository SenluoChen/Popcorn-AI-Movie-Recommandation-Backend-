import { useEffect, useState } from "react";
import Slider from "react-slick";

import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

type Top10Item = {
  imdbId: string;
  title?: string;
  posterUrl?: string | null;
};

async function loadTop10(): Promise<Top10Item[]> {
  try {
    const resp = await fetch("/media_top10.json", { cache: "no-cache" });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    const items: Top10Item[] = Array.isArray(data?.items) ? data.items : [];
    return items.filter((x) => x && String(x.imdbId || "").trim()).slice(0, 10);
  } catch {
    return [];
  }
}

export default function BannerCarousel() {
  const [items, setItems] = useState<Top10Item[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadTop10();
      if (!cancelled) setItems(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const settings = {
    dots: false,
    infinite: false,
    speed: 420,
    autoplay: false,
    arrows: true,
    slidesToShow: 5,
    slidesToScroll: 2,
    responsive: [
      { breakpoint: 1024, settings: { slidesToShow: 4, slidesToScroll: 2 } },
      { breakpoint: 760, settings: { slidesToShow: 2, slidesToScroll: 2 } },
    ],
  };

  if (!items.length) {
    return (
      <div
        style={{
          width: "100%",
          height: 280,
          borderRadius: 14,
          border: "1px solid var(--border-1)",
          background: "linear-gradient(135deg, rgba(25,30,37,0.10), rgba(100,154,139,0.22))",
        }}
      />
    );
  }

  return (
    <div style={{ width: "100%", margin: "0 auto", position: "relative" }}>
      <Slider {...settings}>
        {items.map((it) => {
          const title = String(it?.title || "").trim();
          const posterUrl = String(it?.posterUrl || "").trim();

          return (
            <div key={String(it.imdbId)} style={{ padding: "0 8px" }}>
              <div
                style={{
                  width: "100%",
                  height: 280,
                  borderRadius: 14,
                  border: "1px solid var(--border-1)",
                  backgroundColor: "var(--surface-muted)",
                  overflow: "hidden",
                  position: "relative",
                }}
                title={title}
              >
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt={title || "Top pick"}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : null}

                {title ? (
                  <div
                    style={{
                      position: "absolute",
                      left: 10,
                      right: 10,
                      bottom: 10,
                      color: "var(--text-invert)",
                      fontWeight: 800,
                      fontSize: 14,
                      letterSpacing: "-0.01em",
                      textShadow: "0 2px 12px rgba(0,0,0,0.45)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      pointerEvents: "none",
                    }}
                  >
                    {title}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </Slider>
    </div>
  );
}
