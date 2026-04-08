import { useState, useRef } from "react";

// Fake queue data
const QUEUE_ITEMS = [
  { id: 1, title: "Late Night Session with DJ Snake", thumbnail: "https://picsum.photos/seed/q1/300/300", duration: "12:34", source: "YouTube", addedAgo: "2m ago" },
  { id: 2, title: "Urban Freestyle Battle Round 4", thumbnail: "https://picsum.photos/seed/q2/300/300", duration: "8:21", source: "TikTok", addedAgo: "5m ago" },
  { id: 3, title: "Neon City Drift Compilation", thumbnail: "https://picsum.photos/seed/q3/300/300", duration: "15:07", source: "YouTube", addedAgo: "12m ago" },
  { id: 4, title: "Acoustic Cover: Blinding Lights", thumbnail: "https://picsum.photos/seed/q4/300/300", duration: "4:12", source: "Instagram", addedAgo: "18m ago" },
  { id: 5, title: "Underground Hip Hop Cypher", thumbnail: "https://picsum.photos/seed/q5/300/300", duration: "22:45", source: "YouTube", addedAgo: "25m ago" },
  { id: 6, title: "Street Art Time-lapse Tokyo", thumbnail: "https://picsum.photos/seed/q6/300/300", duration: "6:33", source: "TikTok", addedAgo: "31m ago" },
  { id: 7, title: "Midnight Rooftop Sessions", thumbnail: "https://picsum.photos/seed/q7/300/300", duration: "18:09", source: "YouTube", addedAgo: "40m ago" },
];

// Simulated "Now Playing" bar
const NOW_PLAYING = {
  title: "Morning Routine Aesthetic",
  thumbnail: "https://picsum.photos/seed/np/300/300",
  source: "TikTok",
  duration: "7:15",
  progress: 0.35,
};

function QueueItem({ item, index, isFirst }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        borderRadius: 12,
        background: hovered ? "rgba(0,0,0,0.04)" : "transparent",
        cursor: "pointer",
        transition: "background 150ms ease",
        minWidth: 280,
        flex: "0 0 auto",
      }}
    >
      {/* Index / play indicator */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isFirst ? "#f43f5e" : "#999",
          width: 18,
          textAlign: "center",
          fontFamily: "'Inter', sans-serif",
          flexShrink: 0,
        }}
      >
        {isFirst ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#f43f5e">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          index + 1
        )}
      </span>

      {/* Thumbnail */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={item.thumbnail}
          alt={item.title}
          style={{
            width: 56,
            height: 56,
            borderRadius: 10,
            objectFit: "cover",
            display: "block",
          }}
        />
        {/* Hover play overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 10,
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: hovered ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: isFirst ? "#f43f5e" : "#1a1a1d",
            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: "-0.2px",
          }}
        >
          {item.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#888",
            fontFamily: "'Inter', sans-serif",
            marginTop: 3,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>{item.source}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{item.duration}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{item.addedAgo}</span>
        </div>
      </div>

      {/* Remove button */}
      <button
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          border: "none",
          background: hovered ? "rgba(0,0,0,0.06)" : "transparent",
          color: "#aaa",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 150ms",
          flexShrink: 0,
        }}
        title="Remove from queue"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function NowPlayingBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 24px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {/* Thumbnail with progress ring */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={NOW_PLAYING.thumbnail}
          alt={NOW_PLAYING.title}
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            objectFit: "cover",
            display: "block",
          }}
        />
        {/* Animated bars icon */}
        <div
          style={{
            position: "absolute",
            bottom: -2,
            right: -2,
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "#f43f5e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
          }}
        >
          {[3, 5, 3.5].map((h, i) => (
            <div
              key={i}
              style={{
                width: 2.5,
                height: h,
                background: "#fff",
                borderRadius: 1,
                animation: `eqBounce 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Track info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#f43f5e",
            fontFamily: "'Inter', sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 2,
          }}
        >
          Now Playing
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#1a1a1d",
            fontFamily: "'Space Grotesk', 'Inter', sans-serif",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: "-0.2px",
          }}
        >
          {NOW_PLAYING.title}
        </div>
      </div>

      {/* Mini progress bar */}
      <div style={{ width: 80, flexShrink: 0 }}>
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: "rgba(0,0,0,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${NOW_PLAYING.progress * 100}%`,
              height: "100%",
              background: "#f43f5e",
              borderRadius: 2,
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: "#aaa",
            marginTop: 3,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <span>2:31</span>
          <span>{NOW_PLAYING.duration}</span>
        </div>
      </div>
    </div>
  );
}

export default function QueueDrawerMockup() {
  const [isOpen, setIsOpen] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState("queue"); // "queue" or "recent"
  const dragStartY = useRef(null);

  // Simulated drag-to-dismiss
  const handlePointerDown = (e) => {
    dragStartY.current = e.clientY;
  };
  const handlePointerMove = (e) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) setDragOffset(delta);
  };
  const handlePointerUp = () => {
    if (dragOffset > 120) {
      setIsOpen(false);
      setTimeout(() => {
        setIsOpen(true);
        setDragOffset(0);
      }, 1500);
    }
    setDragOffset(0);
    dragStartY.current = null;
  };

  return (
    <div
      style={{
        background: "#111113",
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Keyframes for equalizer animation */}
      <style>{`
        @keyframes eqBounce {
          0% { height: 2px; }
          100% { height: 8px; }
        }
      `}</style>

      {/* Fake background content to simulate the homepage */}
      <div style={{ padding: "40px 40px 200px", opacity: isOpen ? 0.3 : 1, transition: "opacity 300ms ease" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#8a8a90", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
          Queue Drawer Mockup
        </div>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 40 }}>
          {isOpen ? "Drag the handle down to dismiss. Click the button to toggle." : "Queue is closed. Click the button to reopen."}
        </div>

        {/* Toggle button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid #2a2a2e",
            background: "rgba(244,63,94,0.1)",
            color: "#f43f5e",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isOpen ? "Close Queue" : "Open Queue"} ({QUEUE_ITEMS.length} items)
        </button>

        {/* Fake category rows behind */}
        {[1, 2, 3].map((row) => (
          <div key={row} style={{ marginTop: 40 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e5e5e5", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 12 }}>
              Category Row {row}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[1, 2, 3, 4, 5, 6].map((card) => (
                <div
                  key={card}
                  style={{
                    width: 140,
                    height: 210,
                    borderRadius: 12,
                    background: "#1a1a1d",
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 300ms ease",
          zIndex: 90,
        }}
        onClick={() => setIsOpen(false)}
      />

      {/* Queue bottom sheet */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100,
          transform: isOpen
            ? `translateY(${dragOffset}px)`
            : "translateY(100%)",
          transition: dragOffset > 0 ? "none" : "transform 400ms cubic-bezier(0.25, 1, 0.5, 1)",
          touchAction: "none",
        }}
      >
        {/* Sheet body */}
        <div
          style={{
            background: "#f6f6f8",
            borderRadius: "20px 20px 0 0",
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.25), 0 -2px 10px rgba(0,0,0,0.1)",
          }}
        >
          {/* Drag handle */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "12px 0 4px",
              cursor: "grab",
            }}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "rgba(0,0,0,0.15)",
              }}
            />
          </div>

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 24px 12px",
            }}
          >
            <h2
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#1a1a1d",
                fontFamily: "'Space Grotesk', 'Inter', sans-serif",
                margin: 0,
                letterSpacing: "-0.5px",
              }}
            >
              Queue
            </h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: "#fff",
                  color: "#666",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Shuffle
              </button>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setSortOpen(!sortOpen)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "#fff",
                    color: "#666",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "'Inter', sans-serif",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  Sort by
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: sortOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 150ms ease" }}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {sortOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      background: "#fff",
                      borderRadius: 10,
                      boxShadow: "0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
                      padding: "4px",
                      minWidth: 170,
                      zIndex: 20,
                    }}
                  >
                    <button
                      onClick={() => { setSortBy("queue"); setSortOpen(false); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 7,
                        border: "none",
                        background: sortBy === "queue" ? "rgba(244,63,94,0.08)" : "transparent",
                        color: sortBy === "queue" ? "#f43f5e" : "#444",
                        fontSize: 13,
                        fontWeight: sortBy === "queue" ? 600 : 500,
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        textAlign: "left",
                        transition: "background 100ms",
                      }}
                    >
                      {sortBy === "queue" && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                      <span style={{ marginLeft: sortBy !== "queue" ? 22 : 0 }}>First in Queue</span>
                    </button>
                    <button
                      onClick={() => { setSortBy("recent"); setSortOpen(false); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: 7,
                        border: "none",
                        background: sortBy === "recent" ? "rgba(244,63,94,0.08)" : "transparent",
                        color: sortBy === "recent" ? "#f43f5e" : "#444",
                        fontSize: 13,
                        fontWeight: sortBy === "recent" ? 600 : 500,
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        textAlign: "left",
                        transition: "background 100ms",
                      }}
                    >
                      {sortBy === "recent" && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                      <span style={{ marginLeft: sortBy !== "recent" ? 22 : 0 }}>Recently Added</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(244,63,94,0.1)",
                  color: "#f43f5e",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Now playing */}
          <NowPlayingBar />

          {/* Queue list - scrollable */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px 10px 24px",
              scrollbarWidth: "none",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#999",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "4px 14px 8px",
              }}
            >
              Up Next · {QUEUE_ITEMS.length} videos
            </div>
            {QUEUE_ITEMS.map((item, i) => (
              <QueueItem key={item.id} item={item} index={i} isFirst={i === 0} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}