import React, { forwardRef, useImperativeHandle, useRef } from "react";

const SignaturePad = forwardRef(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);

  const point = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches?.[0] || event;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const begin = (event) => {
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    drawing.current = true;
    context.beginPath();
    context.moveTo(p.x, p.y);
  };

  const draw = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#18181b";
    context.lineTo(p.x, p.y);
    context.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange?.(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange?.("");
  };

  useImperativeHandle(ref, () => ({ clear, toDataURL: () => canvasRef.current.toDataURL("image/png") }));

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={900}
        height={240}
        onMouseDown={begin}
        onMouseMove={draw}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={begin}
        onTouchMove={draw}
        onTouchEnd={end}
        className="h-40 w-full touch-none rounded-[7px] border border-slate-300 bg-white"
        aria-label="Draw your signature"
      />
      <button type="button" onClick={clear} className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-900">
        Clear signature
      </button>
    </div>
  );
});

export default SignaturePad;
