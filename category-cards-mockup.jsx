import { useState, useEffect, useCallback, useRef } from "react";

const CATEGORIES = [
  {
    label: "Trending Now",
    videos: [
      { id: 1, title: "Late Night Session with DJ Snake", thumbnail: "https://picsum.photos/seed/v1/400/600", duration: "12:34", source: "YouTube", views: "2.1M views" },
      { id: 2, title: "Urban Freestyle Battle Round 4", thumbnail: "https://picsum.photos/seed/v2/400/600", duration: "8:21", source: "TikTok", views: "890K views" },
      { id: 3, title: "Neon City Drift Compilation", thumbnail: "https://picsum.photos/seed/v3/400/600", duration: "15:07", source: "YouTube", views: "1.4M views" },
      { id: 4, title: "Acoustic Cover: Blinding Lights", thumbnail: "https://picsum.photos/seed/v4/400/600", duration: "4:12", source: "Instagram", views: "340K views" },
      { id: 5, title: "Underground Hip Hop Cypher", thumbnail: "https://picsum.photos/seed/v5/400/600", duration: "22:45", source: "YouTube", views: "567K views" },
      { id: 6, title: "Street Art Time-lapse Tokyo", thumbnail: "https://picsum.photos/seed/v6/400/600", duration: "6:33", source: "TikTok", views: "1.8M views" },
      { id: 7, title: "Midnight Rooftop Sessions", thumbnail: "https://picsum.photos/seed/v7/400/600", duration: "18:09", source: "YouTube", views: "423K views" },
      { id: 8, title: "Beat Making From Scratch", thumbnail: "https://picsum.photos/seed/v8/400/600", duration: "31:22", source: "YouTube", views: "756K views" },
    ],
  },
  {
    label: "New Arrivals",
    videos: [
      { id: 9, title: "Morning Routine Aesthetic", thumbnail: "https://picsum.photos/seed/v9/400/600", duration: "7:15", source: "TikTok", views: "2.3M views" },
      { id: 10, title: "Vintage Film Look Tutorial", thumbnail: "https://picsum.photos/seed/v10/400/600", duration: "11:48", source: "YouTube", views: "198K views" },
      { id: 11, title: "Cooking ASMR: Ramen Night", thumbnail: "https://picsum.photos/seed/v11/400/600", duration: "9:30", source: "Instagram", views: "1.1M views" },
      { id: 12, title: "Skateboarding Downtown LA", thumbnail: "https://picsum.photos/seed/v12/400/600", duration: "5:44", source: "TikTok", views: "670K views" },
      { id: 13, title: "Digital Art Speed Paint", thumbnail: "https://picsum.photos/seed/v13/400/600", duration: "14:20", source: "YouTube", views: "445K views" },
      { id: 14, title: "Sneaker Collection Tour 2026", thumbnail: "https://picsum.photos/seed/v14/400/600", duration: "19:55", source: "YouTube", views: "312K views" },
      { id: 15, title: "Lo-fi Beats Study Session", thumbnail: "https://picsum.photos/seed/v15/400/600", duration: "45:00", source: "YouTube", views: "5.6M views" },
      { id: 16, title: "Parkour POV Chase Scene", thumbnail: "https://picsum.photos/seed/v16/400/600", duration: "3:28", source: "TikTok", views: "920K views" },
    ],
  },
  {
    label: "Staff Picks",
    videos: [
      { id: 17, title: "The Art of Film Grain", thumbnail: "https://picsum.photos/seed/v17/400/600", duration: "28:13", source: "YouTube", views: "89K views" },
      { id: 18, title: "Piano Improvisation Live", thumbnail: "https://picsum.photos/seed/v18/400/600", duration: "16:40", source: "YouTube", views: "234K views" },
      { id: 19, title: "Street Photography Tokyo", thumbnail: "https://picsum.photos/seed/v19/400/600", duration: "10:55", source: "Instagram", views: "1.5M views" },
      { id: 20, title: "Vintage Car Restoration Ep.7", thumbnail: "https://picsum.photos/seed/v20/400/600", duration: "24:30", source: "YouTube", views: "678K views" },
      { id: 21, title: "Dance Choreography Breakdown", thumbnail: "https://picsum.photos/seed/v21/400/600", duration: "8:17", source: "TikTok", views: "3.2M views" },
      { id: 22, title: "Analog Synth Deep Dive", thumbnail: "https://picsum.photos/seed/v22/400/600", duration: "33:42", source: "YouTube", views: "156K views" },
      { id: 23, title: "Graffiti Wall Mural Process", thumbnail: "https://picsum.photos/seed/v23/400/600", duration: "12:08", source: "YouTube", views: "890K views" },
      { id: 24, title: "Drone Racing Championship", thumbnail: "https://picsum.photos/seed/v24/400/600", duration: "7:51", source: "TikTok", views: "1.1M views" },
    ],
  },
];

// ---- Compact card (default state) ----
const COMPACT_W = 140;
const COMPACT_H = 210; // 2:3 poster ratio
const EXPANDED_W = 380;
const ROW_H = 240; // fixed row height to prevent layout shift
const GAP = 12;

function SpotlightCard({ video, onHover, isExpanded, isSibling }) {
  return (
    <div
      onMouseEnter={() => onHover(video.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        flex: "0 0 auto",
        width: isExpanded ? EXPANDED_W : COMPACT_W,
        height: ROW_H,
        cursor: "pointer",
        transition: "width 350ms cubic-bezier(0.25, 1, 0.5, 1), opacity 200ms ease-out",
        position: "relative",
        opacity: isSibling ? 0.5 : 1,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          height: isExpanded ? ROW_H : COMPACT_H,
          borderRadius: isExpanded ? 16 : 12,
          overflow: "hidden",
          position: "relative",
          transition: "height 350ms cubic-bezier(0.25, 1, 0.5, 1), border-radius 350ms ease, box-shadow 300ms ease",
          display: "flex",
          boxShadow: isExpanded
            ? "0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)"
            : "0 2px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      >
        {/* Thumbnail */}
        <img
          src={video.thumbnail}
          alt={video.title}
          style={{
            width: isExpanded ? "55%" : "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            transition: "width 350ms cubic-bezier(0.25, 1, 0.5, 1)",
          }}
          loading="lazy"
        />

        {/* Expanded: info panel on the right */}
        <div
          style={{
            position: isExpanded ? "relative" : "absolute",
            bottom: isExpanded ? undefined : 0,
            left: isExpanded ? undefined : 0,
            right: isExpanded ? undefined : 0,
            width: isExpanded ? "45%" : "100%",
            background: isExpanded
              ? "#222225"
              : "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)",
            padding: isExpanded ? "20px 18px" : "8px 10px",
            display: "flex",
            flexDirection: "column",
            justifyContent: isExpanded ? "center" : "flex-end",
            transition: "all 350ms cubic-bezier(0.25, 1, 0.5, 1)",
            overflow: "hidden",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: isExpanded ? 16 : 12,
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.3,
              fontFamily: "'Space Grotesk', 'Inter', sans-serif",
              display: "-webkit-box",
              WebkitLineClamp: isExpanded ? 3 : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              transition: "font-size 350ms ease",
              letterSpacing: isExpanded ? "-0.3px" : 0,
            }}
          >
            {video.title}
          </div>

          {/* Metadata - visible in both states but richer when expanded */}
          <div
            style={{
              fontSize: isExpanded ? 12 : 10,
              color: isExpanded ? "#c0c0c5" : "rgba(255,255,255,0.6)",
              marginTop: isExpanded ? 8 : 3,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              transition: "all 350ms ease",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{video.source}</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>{video.duration}</span>
          </div>

          {/* Expanded-only content */}
          <div
            style={{
              overflow: "hidden",
              maxHeight: isExpanded ? 80 : 0,
              opacity: isExpanded ? 1 : 0,
              transition: "max-height 350ms ease, opacity 250ms ease 100ms",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#b0b0b5",
                marginTop: 6,
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {video.views}
            </div>

            {/* Action row */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#f43f5e",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Inter', sans-serif",
                  transition: "background 150ms",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid #3a3a3e",
                  background: "rgba(255,255,255,0.08)",
                  color: "#c0c0c5",
                  cursor: "pointer",
                  transition: "all 150ms",
                }}
                title="Add to queue"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "1px solid #3a3a3e",
                  background: "rgba(255,255,255,0.08)",
                  color: "#c0c0c5",
                  cursor: "pointer",
                  transition: "all 150ms",
                }}
                title="Favorite"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Duration badge (compact only) */}
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 7px",
            borderRadius: 5,
            fontFamily: "'Inter', sans-serif",
            opacity: isExpanded ? 0 : 1,
            transition: "opacity 200ms ease",
            pointerEvents: "none",
          }}
        >
          {video.duration}
        </span>

        {/* Play overlay (compact hover - subtle) */}
        {!isExpanded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.15)",
              opacity: 0,
              transition: "opacity 200ms ease",
              pointerEvents: "none",
            }}
            className="play-overlay"
          />
        )}
      </div>
    </div>
  );
}

function CategoryRow({ category, isActiveRow, onActivate }) {
  const [hoveredId, setHoveredId] = useState(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const scrollRef = useRef(null);
  const cardRefs = useRef([]);

  // Keyboard focus drives the same expanded state as hover
  const activeId = hoveredId !== null ? hoveredId : (focusIndex >= 0 ? category.videos[focusIndex]?.id : null);

  const handleHover = useCallback((id) => {
    setHoveredId(id);
    // Sync focus index when mouse hovers
    if (id !== null) {
      const idx = category.videos.findIndex((v) => v.id === id);
      if (idx >= 0) setFocusIndex(idx);
    }
  }, [category.videos]);

  // Scroll the focused card into view
  useEffect(() => {
    if (focusIndex >= 0 && cardRefs.current[focusIndex] && scrollRef.current) {
      cardRefs.current[focusIndex].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [focusIndex]);

  // Arrow key handler (only when this row is active)
  useEffect(() => {
    if (!isActiveRow) return;

    const handleKey = (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, category.videos.length - 1));
        setHoveredId(null); // keyboard takes over
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
        setHoveredId(null);
      } else if (e.key === "Escape") {
        setFocusIndex(-1);
        setHoveredId(null);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isActiveRow, category.videos.length]);

  return (
    <div
      style={{ marginBottom: 48 }}
      onClick={onActivate}
      onMouseEnter={onActivate}
    >
      {/* Row header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          padding: "0 40px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#e5e5e5",
              fontFamily: "'Space Grotesk', 'Inter', sans-serif",
              letterSpacing: "-0.3px",
              margin: 0,
            }}
          >
            {category.label}
          </h2>
          {isActiveRow && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "#f43f5e",
                background: "rgba(244,63,94,0.12)",
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "'Inter', sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Use arrow keys
            </span>
          )}
        </div>
        <button
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "#8a8a90",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
            transition: "color 150ms",
          }}
          onMouseEnter={(e) => (e.target.style.color = "#f43f5e")}
          onMouseLeave={(e) => (e.target.style.color = "#8a8a90")}
        >
          See All
        </button>
      </div>

      {/* Horizontal scroll row */}
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          gap: GAP,
          overflowX: "auto",
          overflowY: "hidden",
          padding: "0 40px 8px",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          alignItems: "center",
          height: ROW_H + 16,
        }}
      >
        {category.videos.map((video, i) => (
          <div key={video.id} ref={(el) => (cardRefs.current[i] = el)}>
            <SpotlightCard
              video={video}
              onHover={handleHover}
              isExpanded={activeId === video.id}
              isSibling={activeId !== null && activeId !== video.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CategoryCardsMockup() {
  const [activeRowIndex, setActiveRowIndex] = useState(0);

  // Up/Down arrows switch between rows
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveRowIndex((prev) => Math.min(prev + 1, CATEGORIES.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveRowIndex((prev) => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div
      style={{
        background: "#111113",
        minHeight: "100vh",
        paddingTop: 40,
        paddingBottom: 60,
      }}
    >
      {/* Page title */}
      <div style={{ padding: "0 40px", marginBottom: 36 }}>
        <h1
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#8a8a90",
            fontFamily: "'Inter', sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          Category Row Mockup - Spotlight on Hover
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "#555",
            fontFamily: "'Inter', sans-serif",
            marginTop: 6,
          }}
        >
          Hover any card to expand. Arrow keys navigate (left/right within row, up/down between rows). Esc to deselect.
        </p>
      </div>

      {CATEGORIES.map((cat, i) => (
        <CategoryRow
          key={cat.label}
          category={cat}
          isActiveRow={activeRowIndex === i}
          onActivate={() => setActiveRowIndex(i)}
        />
      ))}
    </div>
  );
}