import { useState, useEffect, useRef } from "react";

// ============================================================
// Milestone 7 Design Preview
// Interactive comparison: Current FeedDeck vs M7 Vision
// Demonstrates: ambient color, card redesign, continue watching,
// cinematic transitions, directional shimmer, noise texture
// ============================================================

// Sample data with real-ish thumbnails
const SAMPLE_VIDEOS = [
  { id: 1, title: "Late Night Drive Through Tokyo", source: "YouTube", duration: "12:34", progress: 0.65, views: "2.1M", uploader: "CityWalks", daysAgo: 3, rating: 9.2, thumbnail: "https://picsum.photos/seed/tokyo/640/360", dominantColor: [88, 28, 135] },
  { id: 2, title: "Abstract Fluid Art Compilation", source: "TikTok", duration: "3:21", progress: 0, views: "890K", uploader: "ArtVibes", daysAgo: 1, rating: 8.7, thumbnail: "https://picsum.photos/seed/fluid/640/360", dominantColor: [30, 64, 175] },
  { id: 3, title: "Mountain Sunrise Timelapse 4K", source: "YouTube", duration: "8:45", progress: 0.3, views: "4.5M", uploader: "NatureFilm", daysAgo: 7, rating: 9.5, thumbnail: "https://picsum.photos/seed/mountain/640/360", dominantColor: [180, 83, 9] },
  { id: 4, title: "Neon City Cyberpunk Ambience", source: "YouTube", duration: "45:00", progress: 0.82, views: "1.2M", uploader: "SynthScapes", daysAgo: 2, rating: 8.9, thumbnail: "https://picsum.photos/seed/neon/640/360", dominantColor: [147, 51, 234] },
  { id: 5, title: "Ocean Waves at Golden Hour", source: "TikTok", duration: "2:15", progress: 0, views: "3.3M", uploader: "CoastalVibes", daysAgo: 5, rating: 9.1, thumbnail: "https://picsum.photos/seed/ocean/640/360", dominantColor: [14, 116, 144] },
  { id: 6, title: "Rainy Window Lo-Fi Session", source: "YouTube", duration: "1:02:30", progress: 0.15, views: "780K", uploader: "ChillBeats", daysAgo: 4, rating: 8.4, thumbnail: "https://picsum.photos/seed/rain/640/360", dominantColor: [55, 65, 81] },
  { id: 7, title: "Street Food Night Market Bangkok", source: "YouTube", duration: "18:22", progress: 0, views: "5.6M", uploader: "FoodTravel", daysAgo: 6, rating: 9.3, thumbnail: "https://picsum.photos/seed/bangkok/640/360", dominantColor: [194, 65, 12] },
  { id: 8, title: "Aurora Borealis Iceland 8K", source: "YouTube", duration: "22:10", progress: 0.45, views: "8.9M", uploader: "NorthLights", daysAgo: 10, rating: 9.8, thumbnail: "https://picsum.photos/seed/aurora/640/360", dominantColor: [6, 95, 70] },
];

const SOURCE_COLORS = {
  YouTube: { bg: "rgba(255,0,0,0.15)", text: "#ff4444", icon: "YT" },
  TikTok: { bg: "rgba(0,242,234,0.12)", text: "#00f2ea", icon: "TT" },
  PornHub: { bg: "rgba(255,153,0,0.15)", text: "#ff9900", icon: "PH" },
};

// Noise SVG as data URI
const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`;

// ============================================================
// Main App
// ============================================================
export default function M7Preview() {
  const [mode, setMode] = useState("m7"); // "current" | "m7"
  const [heroVideo, setHeroVideo] = useState(SAMPLE_VIDEOS[0]);
  const [ambientColor, setAmbientColor] = useState(SAMPLE_VIDEOS[0].dominantColor);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setTimeout(() => setLoaded(true), 300);
  }, []);

  const switchHero = (video) => {
    setHeroVideo(video);
    if (mode === "m7") {
      setAmbientColor(video.dominantColor);
    }
  };

  const isM7 = mode === "m7";
  const [r, g, b] = ambientColor;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: isM7
          ? `linear-gradient(180deg, rgb(${r * 0.15}, ${g * 0.15}, ${b * 0.15}) 0%, #111113 35%, #111113 100%)`
          : "#111113",
        color: "#e5e5e5",
        fontFamily: "'Inter', system-ui, sans-serif",
        transition: "background 800ms cubic-bezier(0.4, 0, 0.2, 1)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Noise texture overlay (M7 only) */}
      {isM7 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundImage: NOISE_SVG,
            backgroundRepeat: "repeat",
            backgroundSize: "256px",
            pointerEvents: "none",
            zIndex: 1,
            opacity: 0.5,
          }}
        />
      )}

      {/* Version toggle */}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 100,
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 999,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {["current", "m7"].map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              if (m === "m7") setAmbientColor(heroVideo.dominantColor);
            }}
            style={{
              padding: "8px 20px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: "all 250ms",
              background: mode === m ? (m === "m7" ? "rgba(124,58,237,0.9)" : "rgba(244,63,94,0.9)") : "transparent",
              color: mode === m ? "#fff" : "rgba(255,255,255,0.5)",
            }}
          >
            {m === "current" ? "Current" : "M7 Vision"}
          </button>
        ))}
      </div>

      {/* Header */}
      <Header isM7={isM7} ambientColor={ambientColor} />

      {/* Hero Section */}
      <HeroSection
        video={heroVideo}
        isM7={isM7}
        ambientColor={ambientColor}
        loaded={loaded}
      />

      {/* Continue Watching (M7 only) */}
      {isM7 && (
        <Section
          title="Continue Watching"
          isM7={isM7}
          ambientColor={ambientColor}
          delay={0}
        >
          <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
            {SAMPLE_VIDEOS.filter((v) => v.progress > 0).map((video, i) => (
              <ContinueWatchingCard
                key={video.id}
                video={video}
                onClick={() => switchHero(video)}
                delay={i * 80}
                loaded={loaded}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Category Rows */}
      <Section
        title="Trending Now"
        isM7={isM7}
        ambientColor={ambientColor}
        delay={100}
      >
        <div style={{ display: "flex", gap: isM7 ? 14 : 12, overflowX: "auto", paddingBottom: 8 }}>
          {SAMPLE_VIDEOS.map((video, i) => (
            isM7 ? (
              <M7Card key={video.id} video={video} onClick={() => switchHero(video)} delay={i * 80} loaded={loaded} ambientColor={ambientColor} />
            ) : (
              <CurrentCard key={video.id} video={video} onClick={() => switchHero(video)} delay={i * 80} loaded={loaded} />
            )
          ))}
        </div>
      </Section>

      <Section
        title="New Arrivals"
        isM7={isM7}
        ambientColor={ambientColor}
        delay={200}
      >
        <div style={{ display: "flex", gap: isM7 ? 14 : 12, overflowX: "auto", paddingBottom: 8 }}>
          {[...SAMPLE_VIDEOS].reverse().map((video, i) => (
            isM7 ? (
              <M7Card key={video.id} video={video} onClick={() => switchHero(video)} delay={i * 80} loaded={loaded} ambientColor={ambientColor} />
            ) : (
              <CurrentCard key={video.id} video={video} onClick={() => switchHero(video)} delay={i * 80} loaded={loaded} />
            )
          ))}
        </div>
      </Section>

      {/* Loading Skeleton Comparison */}
      <Section
        title={isM7 ? "Recommended (loading...)" : "Staff Picks (loading...)"}
        isM7={isM7}
        ambientColor={ambientColor}
        delay={300}
      >
        <div style={{ display: "flex", gap: isM7 ? 14 : 12, overflowX: "auto", paddingBottom: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            isM7 ? (
              <M7Skeleton key={i} delay={i * 100} />
            ) : (
              <CurrentSkeleton key={i} />
            )
          ))}
        </div>
      </Section>

      {/* Empty State Comparison */}
      <Section title="Your Playlists" isM7={isM7} ambientColor={ambientColor} delay={400}>
        {isM7 ? <M7EmptyState /> : <CurrentEmptyState />}
      </Section>

      <div style={{ height: 80 }} />
    </div>
  );
}

// ============================================================
// Header
// ============================================================
function Header({ isM7, ambientColor }) {
  const [r, g, b] = ambientColor;
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 40px",
        background: isM7
          ? `linear-gradient(180deg, rgba(${r * 0.12}, ${g * 0.12}, ${b * 0.12}, 0.95) 0%, transparent 100%)`
          : "linear-gradient(180deg, #111113 0%, transparent 100%)",
        backdropFilter: isM7 ? "blur(20px) saturate(1.2)" : "none",
        transition: "all 600ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
          <span style={{ color: isM7 ? "#7C3AED" : "#f43f5e" }}>Feed</span>
          <span>Deck</span>
        </span>
      </div>
      <nav style={{ display: "flex", gap: 28 }}>
        {["Home", "Feed", "Library"].map((item) => (
          <span
            key={item}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: item === "Home" ? "#e5e5e5" : "#a1a1a6",
              cursor: "pointer",
              position: "relative",
              paddingBottom: 4,
            }}
          >
            {item}
            {item === "Home" && (
              <span
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  borderRadius: 1,
                  background: isM7 ? "#7C3AED" : "#f43f5e",
                  transition: "background 400ms",
                }}
              />
            )}
          </span>
        ))}
      </nav>
      <div style={{ width: 120 }} />
    </header>
  );
}

// ============================================================
// Hero Section
// ============================================================
function HeroSection({ video, isM7, ambientColor, loaded }) {
  const [r, g, b] = ambientColor;
  const accent = isM7 ? "#7C3AED" : "#f43f5e";

  return (
    <div
      style={{
        position: "relative",
        height: "85vh",
        minHeight: 500,
        overflow: "hidden",
      }}
    >
      {/* Background */}
      <div style={{ position: "absolute", inset: 0 }}>
        <img
          src={video.thumbnail}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "blur(40px) brightness(0.4)",
            transform: "scale(1.2)",
          }}
        />
        <img
          src={video.thumbnail}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: loaded ? 1 : 0,
            transition: "opacity 800ms ease-out",
          }}
        />
        {/* Vignette */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: isM7
              ? `radial-gradient(ellipse at center, transparent 30%, rgba(${r * 0.08}, ${g * 0.08}, ${b * 0.08}, 0.8) 100%)`
              : "radial-gradient(ellipse at center, transparent 50%, #111113 100%)",
            transition: "background 800ms",
          }}
        />
      </div>

      {/* Bottom gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isM7
            ? `linear-gradient(to top, rgb(${r * 0.1}, ${g * 0.1}, ${b * 0.1}) 0%, rgba(17,17,19,0.4) 40%, transparent 70%)`
            : "linear-gradient(to top, #111113 0%, rgba(17,17,19,0.55) 30%, transparent 65%)",
          transition: "background 800ms",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "absolute",
          left: 40,
          bottom: isM7 ? 100 : 80,
          maxWidth: 520,
          zIndex: 10,
          opacity: loaded ? 1 : 0,
          transform: loaded ? "translateY(0)" : "translateY(20px)",
          transition: "all 600ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* Tags */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {isM7 && (
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                background: `rgba(${r}, ${g}, ${b}, 0.25)`,
                color: `rgb(${Math.min(255, r + 80)}, ${Math.min(255, g + 80)}, ${Math.min(255, b + 80)})`,
                border: `1px solid rgba(${r}, ${g}, ${b}, 0.3)`,
              }}
            >
              98% Match
            </span>
          )}
          <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.1)", color: "#a1a1a6" }}>
            {video.source}
          </span>
          <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.1)", color: "#a1a1a6" }}>
            {video.duration}
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: "clamp(28px, 4vw, 48px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            marginBottom: 12,
            textShadow: "0 2px 20px rgba(0,0,0,0.5)",
          }}
        >
          {video.title}
        </h1>

        {/* Meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#a1a1a6", marginBottom: 20, flexWrap: "wrap" }}>
          {isM7 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 10px",
                borderRadius: 999,
                background: "rgba(250,204,21,0.12)",
                border: "1px solid rgba(250,204,21,0.2)",
                color: "#facc15",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              &#9733; {video.rating}
            </span>
          ) : (
            <span style={{ color: "#facc15", fontWeight: 600 }}>&#9733; {video.rating}/10</span>
          )}
          <span>{video.views} views</span>
          <span style={{ color: "#6b6b70" }}>&middot;</span>
          <span>{video.uploader}</span>
          {!isM7 && (
            <>
              <span style={{ color: "#6b6b70" }}>&middot;</span>
              <span>{video.daysAgo}d ago</span>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 24px",
              borderRadius: isM7 ? 12 : 8,
              background: accent,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          >
            &#9654; Play
          </button>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 24px",
              borderRadius: isM7 ? 12 : 8,
              background: isM7 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.1)",
              color: "#e5e5e5",
              fontSize: 14,
              fontWeight: 600,
              border: isM7 ? `1px solid rgba(${r}, ${g}, ${b}, 0.3)` : "1px solid rgba(255,255,255,0.15)",
              cursor: "pointer",
              fontFamily: "'Inter', system-ui, sans-serif",
              backdropFilter: isM7 ? "blur(12px)" : "none",
              transition: "all 200ms",
            }}
          >
            &#9782; Theatre
          </button>
          <button
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#e5e5e5",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section Wrapper
// ============================================================
function Section({ title, children, isM7, ambientColor, delay = 0 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200 + delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const accent = isM7 ? "#7C3AED" : "#f43f5e";

  return (
    <div
      ref={ref}
      style={{
        padding: "0 40px",
        marginBottom: 36,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: isM7
          ? "all 500ms cubic-bezier(0.34, 1.56, 0.64, 1)"
          : "all 400ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h3
          style={{
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "-0.3px",
          }}
        >
          {title}
        </h3>
        <span style={{ fontSize: 11, fontWeight: 600, color: accent, textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", opacity: 0.75 }}>
          See all &rarr;
        </span>
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Current Card (existing design)
// ============================================================
function CurrentCard({ video, onClick, delay, loaded }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300 + delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        width: 200,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        background: "#141416",
        transition: "all 220ms ease-out",
        transform: hovered ? "scale(1.03) translateY(-2px)" : visible ? "translateY(0)" : "translateY(22px)",
        opacity: visible ? 1 : 0,
        boxShadow: hovered ? "0 12px 32px rgba(0,0,0,0.4)" : "none",
      }}
    >
      <div style={{ position: "relative" }}>
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          style={{ width: "100%", height: 113, objectFit: "cover", display: "block", background: "#1c1c1f" }}
        />
        <span
          style={{
            position: "absolute",
            bottom: 6,
            right: 7,
            background: "rgba(0,0,0,0.8)",
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {video.duration}
        </span>
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {video.title}
        </div>
        <div style={{ fontSize: 11, color: "#a1a1a6", marginTop: 2 }}>
          {video.uploader} &middot; {video.views}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// M7 Card (redesigned)
// ============================================================
function M7Card({ video, onClick, delay, loaded, ambientColor }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const cardRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300 + delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 3;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 3;
    setMousePos({ x, y });
  };

  const src = SOURCE_COLORS[video.source] || SOURCE_COLORS.YouTube;
  const [dr, dg, db] = video.dominantColor;

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMousePos({ x: 0, y: 0 }); }}
      onMouseMove={handleMouseMove}
      style={{
        flexShrink: 0,
        width: 220,
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        background: "#141416",
        transition: "all 350ms cubic-bezier(0.25, 1, 0.5, 1)",
        transform: hovered
          ? "scale(1.04) translateY(-4px)"
          : visible
          ? "translateY(0)"
          : "translateY(22px)",
        opacity: visible ? 1 : 0,
        boxShadow: hovered
          ? `0 20px 40px rgba(${dr * 0.3}, ${dg * 0.3}, ${db * 0.3}, 0.4), 0 0 0 1px rgba(255,255,255,0.08)`
          : "0 0 0 1px rgba(255,255,255,0.04)",
        border: hovered
          ? `1px solid rgba(${dr}, ${dg}, ${db}, 0.3)`
          : "1px solid rgba(255,255,255,0.04)",
        backdropFilter: hovered ? "blur(2px)" : "none",
        position: "relative",
      }}
    >
      {/* Glass highlight on top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
          zIndex: 5,
        }}
      />

      <div style={{ position: "relative", overflow: "hidden" }}>
        <img
          src={video.thumbnail}
          alt={video.title}
          loading="lazy"
          style={{
            width: "100%",
            height: 124,
            objectFit: "cover",
            display: "block",
            background: "#1c1c1f",
            transition: "transform 400ms cubic-bezier(0.25, 1, 0.5, 1)",
            transform: hovered ? `scale(1.06) translate(${mousePos.x}px, ${mousePos.y}px)` : "scale(1)",
          }}
        />

        {/* Content-aware gradient at bottom of thumbnail */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 50,
            background: `linear-gradient(to top, rgba(${dr * 0.15}, ${dg * 0.15}, ${db * 0.15}, 0.9), transparent)`,
          }}
        />

        {/* Source badge */}
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: src.bg,
            backdropFilter: "blur(8px)",
            color: src.text,
            fontSize: 9,
            fontWeight: 800,
            padding: "3px 7px",
            borderRadius: 6,
            letterSpacing: "0.04em",
            zIndex: 3,
            border: `1px solid ${src.text}22`,
          }}
        >
          {src.icon}
        </span>

        {/* Duration */}
        <span
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(4px)",
            fontSize: 10,
            fontWeight: 600,
            padding: "3px 7px",
            borderRadius: 6,
            zIndex: 3,
          }}
        >
          {video.duration}
        </span>

        {/* Watch progress bar */}
        {video.progress > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "rgba(255,255,255,0.1)",
              zIndex: 4,
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${video.progress * 100}%`,
                background: "#7C3AED",
                borderRadius: "0 2px 2px 0",
              }}
            />
          </div>
        )}
      </div>

      <div style={{ padding: "10px 12px 12px" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
          }}
        >
          {video.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8a8a90" }}>
          <span>{video.uploader}</span>
          <span style={{ opacity: 0.4 }}>&middot;</span>
          <span>{video.views}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Continue Watching Card (M7 exclusive)
// ============================================================
function ContinueWatchingCard({ video, onClick, delay, loaded }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200 + delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const [dr, dg, db] = video.dominantColor;
  const progressPct = Math.round(video.progress * 100);
  const remaining = Math.round((1 - video.progress) * parseInt(video.duration) || 5);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flexShrink: 0,
        width: 280,
        borderRadius: 14,
        overflow: "hidden",
        cursor: "pointer",
        background: "#141416",
        transition: "all 350ms cubic-bezier(0.25, 1, 0.5, 1)",
        transform: hovered ? "scale(1.03) translateY(-3px)" : visible ? "translateY(0)" : "translateY(16px)",
        opacity: visible ? 1 : 0,
        boxShadow: hovered ? `0 16px 36px rgba(${dr * 0.3}, ${dg * 0.3}, ${db * 0.3}, 0.35)` : "none",
        border: `1px solid ${hovered ? `rgba(${dr}, ${dg}, ${db}, 0.25)` : "rgba(255,255,255,0.04)"}`,
        position: "relative",
      }}
    >
      <div style={{ position: "relative" }}>
        <img
          src={video.thumbnail}
          alt={video.title}
          style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }}
        />
        {/* Resume badge */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "rgba(124,58,237,0.85)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 6,
          }}
        >
          Resume
        </div>
        {/* Remaining time */}
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            fontSize: 10,
            fontWeight: 600,
            padding: "3px 7px",
            borderRadius: 6,
          }}
        >
          {remaining}m left
        </div>
        {/* Progress bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.1)" }}>
          <div style={{ height: "100%", width: `${progressPct}%`, background: "#7C3AED", borderRadius: "0 2px 2px 0" }} />
        </div>
      </div>
      <div style={{ padding: "8px 12px 10px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {video.title}
        </div>
        <div style={{ fontSize: 11, color: "#8a8a90", marginTop: 2 }}>{video.uploader}</div>
      </div>
    </div>
  );
}

// ============================================================
// Current Skeleton (basic pulse)
// ============================================================
function CurrentSkeleton() {
  return (
    <div style={{ flexShrink: 0, width: 200 }}>
      <div
        style={{
          width: "100%",
          height: 113,
          borderRadius: 10,
          background: "rgba(255,255,255,0.06)",
          marginBottom: 8,
          animation: "pulse 1.5s ease-in-out infinite",
        }}
      />
      <div style={{ height: 12, width: "75%", borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 6, animation: "pulse 1.5s ease-in-out infinite" }} />
      <div style={{ height: 10, width: "50%", borderRadius: 6, background: "rgba(255,255,255,0.06)", animation: "pulse 1.5s ease-in-out infinite" }} />
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

// ============================================================
// M7 Skeleton (directional shimmer)
// ============================================================
function M7Skeleton({ delay = 0 }) {
  return (
    <div style={{ flexShrink: 0, width: 220 }}>
      <div
        style={{
          width: "100%",
          height: 124,
          borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          marginBottom: 10,
          overflow: "hidden",
          position: "relative",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.06) 40%, rgba(124,58,237,0.1) 50%, rgba(124,58,237,0.06) 60%, transparent 100%)",
            animation: `shimmer 2s ease-in-out infinite`,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
      <div
        style={{
          height: 12,
          width: "80%",
          borderRadius: 8,
          background: "rgba(255,255,255,0.04)",
          marginBottom: 6,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.08) 50%, transparent 100%)",
            animation: `shimmer 2s ease-in-out infinite`,
            animationDelay: `${delay + 100}ms`,
          }}
        />
      </div>
      <div
        style={{
          height: 10,
          width: "55%",
          borderRadius: 8,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg, transparent 0%, rgba(124,58,237,0.08) 50%, transparent 100%)",
            animation: `shimmer 2s ease-in-out infinite`,
            animationDelay: `${delay + 200}ms`,
          }}
        />
      </div>
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
    </div>
  );
}

// ============================================================
// Current Empty State (emoji + text)
// ============================================================
function CurrentEmptyState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", textAlign: "center" }}>
      <span style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>&#128250;</span>
      <p style={{ fontSize: 14, color: "#8a8a90" }}>No playlists yet. Create one to organize your videos.</p>
    </div>
  );
}

// ============================================================
// M7 Empty State (branded, atmospheric)
// ============================================================
function M7EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 0",
        textAlign: "center",
        position: "relative",
      }}
    >
      {/* Atmospheric glow */}
      <div
        style={{
          position: "absolute",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)",
          filter: "blur(40px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Icon */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "rgba(124,58,237,0.1)",
          border: "1px solid rgba(124,58,237,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
          position: "relative",
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M12 12h.01" />
          <path d="M17 12h.01" />
          <path d="M7 12h.01" />
        </svg>
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: "#e5e5e5", marginBottom: 6, position: "relative" }}>
        No playlists yet
      </p>
      <p style={{ fontSize: 13, color: "#6b6b70", marginBottom: 20, maxWidth: 280, position: "relative" }}>
        Curate your own collections to keep your favorites organized
      </p>
      <button
        style={{
          padding: "10px 24px",
          borderRadius: 10,
          background: "rgba(124,58,237,0.15)",
          border: "1px solid rgba(124,58,237,0.3)",
          color: "#a78bfa",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "'Inter', system-ui, sans-serif",
          position: "relative",
          transition: "all 200ms",
        }}
      >
        + Create Playlist
      </button>
    </div>
  );
}
