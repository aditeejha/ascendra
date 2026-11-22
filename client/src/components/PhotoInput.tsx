import clsx from 'clsx';
import { Camera, ImagePlus, X } from 'lucide-react';
import { useId, useState } from 'react';

export async function resizeImage(file: File, maxSide = 900, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not an image we can read.'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the photo.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoInput({
  value,
  onChange,
  label = 'Add a photo',
  shape = 'wide',
  disabled,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
  shape?: 'wide' | 'round';
  disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file (JPEG, PNG or WebP).');
      return;
    }
    setBusy(true);
    try {
      onChange(await resizeImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {value ? (
        <div className={clsx('relative inline-block overflow-hidden ring-1 ring-line', shape === 'round' ? 'size-24 rounded-full' : 'w-full rounded-xl')}>
          <img src={value} alt="Selected photo" className={clsx('object-cover', shape === 'round' ? 'size-24' : 'max-h-56 w-full')} />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-navy-900/70 text-white hover:bg-navy-900"
            aria-label="Remove photo"
            disabled={disabled}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <label
          htmlFor={id}
          className={clsx(
            'flex cursor-pointer items-center justify-center gap-2 border border-dashed border-navy-200 bg-navy-50/60 text-sm font-medium text-navy-700 transition-colors hover:bg-navy-50',
            shape === 'round' ? 'size-24 flex-col rounded-full text-xs' : 'h-24 w-full rounded-xl',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          {shape === 'round' ? <Camera className="size-5" /> : <ImagePlus className="size-5" />}
          {busy ? 'Processing…' : label}
        </label>
      )}
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only" disabled={disabled} onChange={(e) => pick(e.target.files?.[0])} />
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
    </div>
  );
}
