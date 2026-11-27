"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessAddress({ address, copy = false }: { address: string; copy?: boolean }) {
  const [showQr, setShowQr] = useState(false);
  const [feedback, setFeedback] = useState("");
  const qrId = useId();

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setFeedback("Link copied.");
    } catch {
      setFeedback("Copy is unavailable. Select the address above to copy it.");
    }
  }

  return (
    <div className="space-y-2">
      <p className="break-all text-sm font-medium text-foreground">{address}</p>
      <div className="flex flex-wrap gap-1">
        <Button asChild variant="secondary" className="min-h-11">
          <a href={address} target="_blank" rel="noopener noreferrer" aria-label={`Open ${address}`}>
            <ExternalLink className="size-4" aria-hidden="true" /> Open
          </a>
        </Button>
        {copy ? <Button type="button" variant="secondary" onClick={() => void copyAddress()} className="min-h-11">
          <Copy className="size-4" aria-hidden="true" /> Copy link
        </Button> : null}
        <Button type="button" variant="ghost" aria-expanded={showQr} aria-controls={qrId}
          onClick={() => setShowQr(!showQr)} className="min-h-11">
          <QrCode className="size-4" aria-hidden="true" /> QR code
        </Button>
      </div>
      {copy ? <p role="status" className="text-sm text-muted-foreground empty:hidden">{feedback}</p> : null}
      <div id={qrId} hidden={!showQr}>{showQr ? <AccessQrCode address={address} /> : null}</div>
    </div>
  );
}

function AccessQrCode({ address }: { address: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let disposed = false;
    void import("qrcode").then(({ toCanvas }) => {
      if (!disposed) return toCanvas(element, address, { width: 144, margin: 3 });
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [address]);
  return error ? <p className="text-sm text-muted-foreground">QR code unavailable. Open the address on your phone.</p>
    : <canvas ref={canvas} role="img" aria-label={`QR code for ${address}`} className="rounded-md" />;
}
