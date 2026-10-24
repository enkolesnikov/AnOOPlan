import test from 'node:test';
import assert from 'node:assert/strict';
import type { Equipment, Pin, Project } from '../src/model';
import { orphanPhotoKeys, purgePhotoBlobs } from '../src/photos';
import { baseProject, device, floor, pin } from './fixtures';

/** Камера с фото-ключами: на ней проверяются orphanPhotoKeys/purgePhotoBlobs. */
const photoDevice = (id: string, photos: string[]): Equipment =>
  device(id, 0, { name: `Устройство ${id}`, type: 'Камера', height: null, properties: {}, photos });
const photoPin = (id: string, photos: string[]): Pin => pin(id, { photos });

function fixture(): Project {
  return baseProject({
    name: 'Фото',
    floors: [floor('f1', { name: 'Этаж 1' })],
    equipment: [photoDevice('e1', ['a', 'b']), photoDevice('e2', ['c']), photoDevice('e3', ['b', 'd'])],
    routes: [], cables: [], pins: [photoPin('z1', ['z1'])],
  });
}

test('удаление оборудования возвращает только его фото-ключи', () => {
  const p = fixture();
  assert.deepEqual(orphanPhotoKeys(p, ['e2']), ['c']);
  assert.deepEqual(orphanPhotoKeys(p, ['e1']), ['a']);
});

test('фото-ключ, общий с другим оборудованием, не считается сиротой', () => {
  const p = fixture();
  // Ключ b есть и у e1, и у e3: после удаления e1 он должен остаться.
  assert.deepEqual(orphanPhotoKeys(p, ['e1', 'e3']).sort(), ['a', 'b', 'd']);
  p.equipment = p.equipment.filter(item => item.id !== 'e3');
  assert.deepEqual(orphanPhotoKeys(p, ['e1']).sort(), ['a', 'b']);
});

test('удаление этажа собирает фото всех его устройств', () => {
  const p = fixture();
  const floorEquipment = p.equipment.filter(item => item.floorId === 'f1').map(item => item.id);
  assert.deepEqual(orphanPhotoKeys(p, floorEquipment).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(orphanPhotoKeys(p, []), []);
});

test('очистка удаляет блобы с префиксом photo: и переживает ошибку одного ключа', async () => {
  const deleted: string[] = [];
  const removed = await purgePhotoBlobs(['a', 'bad', 'b'], async key => {
    deleted.push(key);
    if (key === 'photo:bad') throw new Error('нет доступа');
  });
  assert.deepEqual(deleted, ['photo:a', 'photo:bad', 'photo:b']);
  assert.equal(removed, 2);
});

test('удаление замечания возвращает его фото-ключи', () => {
  const p = fixture();
  assert.deepEqual(orphanPhotoKeys(p, ['z1']), ['z1']);
});
