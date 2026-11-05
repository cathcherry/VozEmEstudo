import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAcademicDatabase } from './fixtures/academic-db.fixture.js';
import { assertAudioMetadata } from '../src/domain/rules.js';
import { buildSummaryMessages } from '../src/prompts/summary.v1.js';
import { identities } from './fixtures/ownership.fixture.js';
import { PERMISSION_DECLARATION } from '../src/config/permission-declaration.js';

test('retained MP4 migration is repeatable, preserves old media and keeps storage private', async () => {
  const { db, call } = await createAcademicDatabase();
  try {
    const before = await db.query('select count(*)::int as count from public.audio_files');
    const sql = await readFile(
      new URL('../../database/migrations/20261105220000_video_retention.sql', import.meta.url),
      'utf8',
    );
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual(
      (await db.query('select count(*)::int as count from public.audio_files')).rows,
      before.rows,
    );
    const bucket = (await db.query("select * from storage.buckets where id='audios'")).rows[0];
    assert.equal(bucket.public, false);
    assert(bucket.allowed_mime_types.includes('video/mp4'));
    const videoId = randomUUID();
    await call('create_material_with_permission_admin', [
      identities.a.id,
      JSON.stringify({
        id: videoId,
        title: 'Vídeo sintético',
        subject: 'Física',
        originalFilename: 'clip.mp4',
        mimeType: 'video/mp4',
        extension: 'mp4',
        sizeBytes: 2048,
        durationMs: 3000,
        retainAudio: true,
        questionCount: 3,
        storagePath: `temp/${identities.a.id}/${videoId}/clip.mp4`,
      }),
      PERMISSION_DECLARATION.version,
      PERMISSION_DECLARATION.text,
    ]);
    assert.equal(
      (await db.query("select extension from public.audio_files where extension='mp4'")).rows
        .length,
      1,
    );
    assert.deepEqual(assertAudioMetadata({ extension: 'mp4', sizeBytes: 2048 }), {
      extension: 'mp4',
      sizeBytes: 2048,
    });
    await assert.rejects(
      db.query("update public.audio_files set extension='exe' where extension='mp4'"),
    );
  } finally {
    await db.close();
  }
});

test('summary choices reach the prompt without weakening source-only instructions', () => {
  const messages = buildSummaryMessages('Texto da aula.', { format: 'bullets', length: 'brief' });
  assert.match(messages[0].content, /tópicos/);
  assert.match(messages[0].content, /breve/);
  assert.match(messages[0].content, /exclusivamente/);
  assert.match(messages[0].content, /Markdown/);
  assert.equal(messages[1].content, 'TRANSCRIÇÃO:\n\nTexto da aula.');
});
