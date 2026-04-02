import React from "react";

export default function LoadingOverlay({
  open,
  title = "Ищем варианты поставки",
  message = "Пожалуйста, подожди...",
}) {
  if (!open) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-spinner" />
        <div>
          <div className="loading-title">{title}</div>
          <div className="loading-text">{message}</div>
        </div>
      </div>
    </div>
  );
}
