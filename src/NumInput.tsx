import { useEffect, useState } from 'react';

export function NumInput({ value, onChange, placeholder, label }: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === '' || Number.isNaN(Number(t)) ? null : Number(t);
      return parsed === value ? t : value == null ? '' : String(value);
    });
  }, [value]);
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace('−', '-');
        setText(t);
        const n = Number(t);
        onChange(t.trim() === '' || Number.isNaN(n) ? null : n);
      }}
    />
  );
}
