"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

interface SlideToAuthorizeProps {
  amountUsd: number;
  isAuthorized: boolean;
  onAuthorize: () => void;
  disabled?: boolean;
}

export default function SlideToAuthorize({
  amountUsd,
  isAuthorized,
  onAuthorize,
  disabled = false,
}: SlideToAuthorizeProps) {
  const [dragPercent, setDragPercent] = useState(isAuthorized ? 100 : 0);
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number>(0);
  const currentDragRef = useRef<number>(0);

  useEffect(() => {
    if (isAuthorized) {
      setDragPercent(100);
    } else {
      setDragPercent(0);
    }
  }, [isAuthorized]);

  const handleDrag = useCallback(
    (clientX: number) => {
      if (!trackRef.current || isAuthorized || disabled) return;
      const rect = trackRef.current.getBoundingClientRect();
      const trackWidth = rect.width;
      const maxDistance = trackWidth - 40; // 32px thumb + 8px horizontal padding (4px on each side)
      if (maxDistance <= 0) return;

      const rawOffset = clientX - rect.left - 20; // 20px = 4px left margin + 16px center of 32px thumb
      const clampedOffset = Math.max(0, Math.min(rawOffset, maxDistance));
      const percent = (clampedOffset / maxDistance) * 100;

      currentDragRef.current = percent;
      setDragPercent(percent);
    },
    [isAuthorized, disabled]
  );

  const handleEnd = useCallback(() => {
    if (!isDragging || isAuthorized || disabled) return;
    setIsDragging(false);

    if (currentDragRef.current >= 85) {
      // Threshold reached: complete authorization
      setDragPercent(100);
      onAuthorize();
    } else {
      // Snap back to zero
      setDragPercent(0);
      currentDragRef.current = 0;
    }
  }, [isDragging, isAuthorized, disabled, onAuthorize]);

  // Mouse event listeners on window
  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleDrag(e.clientX);
    };

    const onMouseUp = () => {
      handleEnd();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, handleDrag, handleEnd]);

  // Touch event listeners on window
  useEffect(() => {
    if (!isDragging) return;

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleDrag(e.touches[0].clientX);
      }
    };

    const onTouchEnd = () => {
      handleEnd();
    };

    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging, handleDrag, handleEnd]);

  const onThumbMouseDown = (e: React.MouseEvent) => {
    if (isAuthorized || disabled) return;
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    handleDrag(e.clientX);
  };

  const onThumbTouchStart = (e: React.TouchEvent) => {
    if (isAuthorized || disabled) return;
    setIsDragging(true);
    if (e.touches.length > 0) {
      startXRef.current = e.touches[0].clientX;
      handleDrag(e.touches[0].clientX);
    }
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isAuthorized || disabled) return;
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setDragPercent(100);
      onAuthorize();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 w-full sm:w-auto">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Slide to authorize PayPal Escrow Hold"
        aria-valuenow={Math.round(dragPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={isAuthorized ? -1 : 0}
        onKeyDown={handleKeyDown}
        className={`relative h-10 w-full sm:w-72 bg-[#0c0d0e] border rounded-full overflow-hidden select-none flex items-center transition-colors shadow-inner ${
          isAuthorized
            ? "border-emerald-800/80 bg-emerald-950/20"
            : isDragging
            ? "border-blue-500/80"
            : "border-[#1e2024] hover:border-zinc-700"
        }`}
        style={{ touchAction: "none" }}
      >
        {/* Dynamic progress fill */}
        <div
          className={`absolute left-0 top-0 bottom-0 pointer-events-none transition-all ${
            isAuthorized
              ? "w-full bg-emerald-950/50"
              : isDragging
              ? "bg-blue-600/30"
              : "bg-blue-900/20"
          }`}
          style={
            !isAuthorized
              ? {
                  width: `${dragPercent}%`,
                  transition: isDragging ? "none" : "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                }
              : undefined
          }
        />

        {/* Center Prompt Label */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none text-[11px] font-mono tracking-tight transition-opacity px-10"
          style={{
            opacity: isAuthorized ? 1 : Math.max(0, 1 - dragPercent / 60),
          }}
        >
          {isAuthorized ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Escrow Hold Authorized
            </span>
          ) : (
            <span className="text-zinc-400 truncate">
              Drag to Authorize (${amountUsd.toFixed(2)}) &rarr;
            </span>
          )}
        </div>

        {/* Draggable Thumb */}
        <div
          onMouseDown={onThumbMouseDown}
          onTouchStart={onThumbTouchStart}
          className={`absolute top-1 bottom-1 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-lg cursor-grab active:cursor-grabbing transition-transform ${
            isAuthorized
              ? "bg-emerald-500 text-white cursor-default"
              : isDragging
              ? "bg-[#2563eb] text-white scale-105"
              : "bg-zinc-700 hover:bg-zinc-600 text-white"
          }`}
          style={{
            left: `calc(4px + ${dragPercent}% - ${(dragPercent / 100) * 40}px)`,
            transition: isDragging ? "none" : "left 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {isAuthorized ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 px-1">
        <span>Step 1: Authorization Hold</span>
        {isAuthorized ? (
          <span className="text-emerald-400 font-medium">Locked in PayPal Escrow</span>
        ) : (
          <span>Drag thumb right</span>
        )}
      </div>
    </div>
  );
}
