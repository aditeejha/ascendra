import type { NetworkInfo } from '../../../shared/types';
import { Select } from './ui';

export function NodeSelect({
  network,
  value,
  onChange,
  placeholder = 'Select a location',
  id,
  disabled,
}: {
  network: NetworkInfo;
  value: number | null;
  onChange: (id: number) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}) {
  const landmarks = network.nodes.filter((n) => n.poi || n.exit);
  const junctions = network.nodes.filter((n) => !n.poi && !n.exit);
  return (
    <Select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="" disabled>
        {placeholder}
      </option>
      <optgroup label="Landmarks & exits">
        {landmarks.map((n) => (
          <option key={n.id} value={n.id}>
            {n.poi?.name ?? n.exit} · {n.key}
          </option>
        ))}
      </optgroup>
      <optgroup label="Junctions">
        {junctions.map((n) => (
          <option key={n.id} value={n.id}>
            {n.name} · {n.key}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
