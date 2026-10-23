import type { Floor, Pin } from './model';

interface Props {
  pin: Pin;
  floors: Floor[];
  photoUrls: Record<string, string>;
  onChange: (patch: Partial<Pin>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onAddPhoto: () => void;
  onCamera: () => void;
  onRemovePhoto: (key: string) => void;
}

/** Свойства пина-замечания: текст, статус, координаты и фотографии. */
export function PinProperties({ pin, floors, photoUrls, onChange, onRemove, onCopy, onAddPhoto, onCamera, onRemovePhoto }: Props) {
  return (
    <>
      <div className="object-heading"><span className="eyebrow">ЗАМЕЧАНИЕ</span><h2>{pin.number}</h2></div>
      <label className="field">Обозначение<input value={pin.number} onChange={event => onChange({ number: event.target.value })} /></label>
      <label className="field">Этаж<select value={pin.floorId} onChange={event => onChange({ floorId: event.target.value })}>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>
      <div className="field-pair">
        <label className="field">X, ед. PDF<input type="number" value={pin.x} onChange={event => onChange({ x: Number(event.target.value) || 0 })} /></label>
        <label className="field">Y, ед. PDF<input type="number" value={pin.y} onChange={event => onChange({ y: Number(event.target.value) || 0 })} /></label>
      </div>
      <label className="field">Статус<select value={pin.status} onChange={event => onChange({ status: event.target.value === 'closed' ? 'closed' : 'open' })}><option value="open">Открыто</option><option value="closed">Закрыто</option></select></label>
      <label className="field">Замечание<textarea rows={4} value={pin.comment} onChange={event => onChange({ comment: event.target.value })} /></label>
      <div className="section-label">Фотографии <span>{pin.photos?.length || 0}</span></div>
      <div className="photo-strip">
        {(pin.photos || []).map(key => photoUrls[key] ? <div className="photo-card" key={key}><img src={photoUrls[key]} alt={`Фото ${pin.number}`} /><button aria-label="Удалить фото" onClick={() => onRemovePhoto(key)}>×</button></div> : null)}
        <button className="photo-add" onClick={onAddPhoto}>＋ Фото</button>
        <button className="photo-add" onClick={onCamera}>📷 Снять</button>
      </div>
      <p className="help">Фото замечания хранится в проекте и попадает в JSON-копию.</p>
      <div className="property-actions"><button onClick={onCopy}>Копировать</button><button className="danger" onClick={onRemove}>Удалить</button></div>
    </>
  );
}
