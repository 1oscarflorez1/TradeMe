/** Selector de activos. En M0 va vacío; se poblará con la lista real en M1. */
export function AssetSelector() {
  return (
    <label className="asset-selector">
      <span className="sr-only">Activo</span>
      <select defaultValue="" aria-label="Seleccionar activo" disabled>
        <option value="" disabled>
          Selecciona un activo…
        </option>
      </select>
    </label>
  );
}
