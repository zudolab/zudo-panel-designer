import { useEffect, useRef } from 'react';
import { renderPatternThumb } from '../renderer';
import { PATTERN_GENERATORS } from '../patterns';

export function PatternDialog({
  onSelect,
  onClose,
}: {
  onSelect: (patternName: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Choose a pattern</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="pattern-grid">
          {PATTERN_GENERATORS.map((gen) => (
            <PatternThumb key={gen.name} name={gen.name} displayName={gen.displayName} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PatternThumb({
  name,
  displayName,
  onSelect,
}: {
  name: string;
  displayName: string;
  onSelect: (patternName: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gen = PATTERN_GENERATORS.find((g) => g.name === name);
    if (gen) renderPatternThumb(canvas, gen, 104);
  }, [name]);
  return (
    <button className="pattern-thumb" onClick={() => onSelect(name)} title={displayName}>
      <canvas ref={canvasRef} />
      <span>{displayName}</span>
    </button>
  );
}
