import { useEffect, useRef, useState } from "react";
import { Button } from "@homeflow/ui";

// 16-handover-gates.md Files list names this component explicitly — a real canvas signature
// capture, not a text field pretending to be one. No presigned-upload port is wired anywhere in
// this codebase yet (CommitmentDrawer.tsx's own comment flags the same gap for evidence files),
// so the captured PNG data URL itself stands in for a `*_signature_file_id` — flagged, not faked.

export function SignaturePad({ label, signedFileId, onSign, onClear, disabled }: {
  label: string;
  signedFileId: string | null;
  onSign: (dataUrl: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1C1F26";
  }, []);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || signedFileId) return;
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pointerPos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled || signedFileId) return;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = pointerPos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    hasInk.current = true;
    setEmpty(false);
  }
  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    hasInk.current = false;
    setEmpty(true);
    onClear();
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk.current) return;
    onSign(canvas.toDataURL("image/png"));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-footnote font-medium text-fg-muted">{label}</span>
        {signedFileId && <span className="text-caption font-medium text-ontrack">Signed</span>}
      </div>
      {signedFileId ? (
        <img src={signedFileId} alt={`${label} signature`} className="h-24 w-full rounded-lg border border-line bg-surface object-contain" />
      ) : (
        <canvas
          ref={canvasRef}
          width={320}
          height={100}
          role="img"
          aria-label={`${label} signature pad — draw to sign`}
          className="w-full touch-none rounded-lg border border-line bg-surface"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      )}
      {!signedFileId && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={clear} disabled={disabled || empty}>
            Clear
          </Button>
          <Button size="sm" onClick={save} disabled={disabled || empty}>
            Save signature
          </Button>
        </div>
      )}
    </div>
  );
}
