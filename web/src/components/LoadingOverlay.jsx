import React from "react";

export default function LoadingOverlay({
  open,
  title = "Ищем варианты поставки",
  message = "Пожалуйста, подожди...",
}) {
  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes railmap-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.42)",
          backdropFilter: "blur(2px)",
          pointerEvents: "all",
        }}
      >
        <div
          style={{
            // minWidth: 320,
            width: 420,
            padding: 18,
            borderRadius: 14,
            background: "rgba(255,255,255,0.96)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
            fontFamily:
              "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "3px solid rgba(0,0,0,0.12)",
                borderTopColor: "#111",
                animation: "railmap-spin 1s linear infinite",
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
                {title}
              </div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.45 }}>
                {message}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}