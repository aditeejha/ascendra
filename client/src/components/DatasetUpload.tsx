import { FileUp, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReplayStatus } from '../../../shared/types';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';
import { buttonClass } from './ui';

export const MAX_DATASET_BYTES = 6_000_000;

export function useDatasetUpload(onLoaded: (status: ReplayStatus) => void) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DATASET_BYTES) {
      toast('error', 'The file is larger than 6 MB.');
      return;
    }
    setUploading(true);
    try {
      const status = await api<ReplayStatus>('/replay/dataset', { method: 'POST', body: { name: file.name, csv: await file.text() } });
      toast('success', `${file.name} loaded. The model has predicted every row.`);
      onLoaded(status);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setUploading(false);
    }
  };
  return { upload, uploading };
}

export function DatasetUploadButton({
  label = 'Upload dataset',
  variant = 'primary',
  size = 'md',
  onLoaded,
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
  onLoaded?: (status: ReplayStatus) => void;
}) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useDatasetUpload(onLoaded ?? (() => navigate('/replay')));
  return (
    <label className={`${buttonClass(variant, size)} cursor-pointer`}>
      {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
      {uploading ? 'Uploading…' : label}
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={uploading}
        onChange={async (e) => {
          await upload(e.target.files?.[0]);
          if (input.current) input.current.value = '';
        }}
      />
    </label>
  );
}
