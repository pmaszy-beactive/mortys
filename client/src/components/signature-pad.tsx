import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Save } from "lucide-react";

interface SignaturePadProps {
  onSave?: (signature: string) => void;
  height?: number;
  title?: string;
  disabled?: boolean;
}

export interface SignaturePadRef {
  clear: () => void;
  getSignature: () => string | null;
  isEmpty: () => boolean;
}

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ onSave, height = 200, title = "Digital Signature", disabled = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDrawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const hasDrawnRef = useRef(false);
    const [canvasWidth, setCanvasWidth] = useState(0);

    const getCoordinates = useCallback((e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      let clientX: number, clientY: number;

      if ('touches' in e) {
        if (e.touches.length === 0) return null;
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    }, []);

    const drawLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }, []);

    const drawDot = useCallback((point: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.beginPath();
      ctx.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'black';
      ctx.fill();
    }, []);

    const startDrawing = useCallback((e: MouseEvent | TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      const point = getCoordinates(e);
      if (!point) return;

      isDrawingRef.current = true;
      lastPointRef.current = point;
      hasDrawnRef.current = true;
      drawDot(point);
    }, [disabled, getCoordinates, drawDot]);

    const continueDrawing = useCallback((e: MouseEvent | TouchEvent) => {
      if (!isDrawingRef.current || disabled) return;
      e.preventDefault();
      const point = getCoordinates(e);
      if (!point || !lastPointRef.current) return;

      drawLine(lastPointRef.current, point);
      lastPointRef.current = point;
    }, [disabled, getCoordinates, drawLine]);

    const stopDrawing = useCallback((e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawingRef.current = false;
      lastPointRef.current = null;
    }, []);

    const clearCanvas = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      hasDrawnRef.current = false;
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || canvasWidth <= 0) return;

      let savedImage: string | null = null;
      if (hasDrawnRef.current) {
        savedImage = canvas.toDataURL();
      }

      canvas.width = canvasWidth;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (savedImage) {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          };
          img.src = savedImage;
        }
      }

      const handleMouseDown = (e: MouseEvent) => startDrawing(e);
      const handleMouseMove = (e: MouseEvent) => continueDrawing(e);
      const handleMouseUp = (e: MouseEvent) => stopDrawing(e);
      const handleMouseLeave = (e: MouseEvent) => stopDrawing(e);
      const handleTouchStart = (e: TouchEvent) => startDrawing(e);
      const handleTouchMove = (e: TouchEvent) => continueDrawing(e);
      const handleTouchEnd = (e: TouchEvent) => stopDrawing(e);

      canvas.addEventListener('mousedown', handleMouseDown);
      canvas.addEventListener('mousemove', handleMouseMove);
      canvas.addEventListener('mouseup', handleMouseUp);
      canvas.addEventListener('mouseleave', handleMouseLeave);
      canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
      canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
      canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

      return () => {
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseLeave);
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
      };
    }, [canvasWidth, height, startDrawing, continueDrawing, stopDrawing]);

    const updateCanvasSize = useCallback(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newWidth = Math.floor(rect.width);
        if (newWidth > 0 && newWidth !== canvasWidth) {
          setCanvasWidth(newWidth);
        }
      }
    }, [canvasWidth]);

    useEffect(() => {
      updateCanvasSize();
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver(() => {
        updateCanvasSize();
      });
      observer.observe(container);

      return () => {
        observer.disconnect();
      };
    }, [updateCanvasSize]);

    useImperativeHandle(ref, () => ({
      clear: clearCanvas,
      getSignature: () => {
        if (!hasDrawnRef.current) return null;
        return canvasRef.current?.toDataURL() || null;
      },
      isEmpty: () => !hasDrawnRef.current,
    }));

    const handleClear = () => {
      clearCanvas();
    };

    const handleSave = () => {
      if (hasDrawnRef.current && canvasRef.current) {
        const signature = canvasRef.current.toDataURL();
        onSave?.(signature);
      }
    };

    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-2 sm:p-4 bg-gray-50">
            <div ref={containerRef} className="overflow-hidden rounded bg-white">
              {canvasWidth > 0 && (
                <canvas
                  ref={canvasRef}
                  className="signature-canvas bg-white border rounded cursor-crosshair"
                  style={{
                    touchAction: 'none',
                    display: 'block',
                    width: `${canvasWidth}px`,
                    height: `${height}px`,
                  }}
                />
              )}
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button 
              type="button" 
              variant="outline" 
              onClick={handleClear}
              disabled={disabled}
              size="sm"
              className="w-full sm:w-auto touch-manipulation"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
            {onSave && (
              <Button 
                type="button" 
                onClick={handleSave}
                disabled={disabled}
                size="sm"
                className="w-full sm:w-auto touch-manipulation"
              >
                <Save className="mr-2 h-4 w-4" />
                Save Signature
              </Button>
            )}
          </div>
          
          <p className="text-xs text-gray-500 mt-2">
            Use your finger or stylus to sign above on mobile, or mouse on desktop.
          </p>
        </CardContent>
      </Card>
    );
  }
);

SignaturePad.displayName = "SignaturePad";

export default SignaturePad;
