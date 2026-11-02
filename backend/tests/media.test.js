import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import {
  inspectMedia,
  convertMedia,
  validateRange,
  MAX_TRANSCRIPTION_SECONDS,
} from '../src/services/media.service.js';
import express from 'express';
import { mediaRouter } from '../src/routes/media.routes.js';
import { app } from '../src/app.js';
const ffmpeg =
  process.env.FFMPEG_PATH || (ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg');
const ffprobe =
  process.env.FFPROBE_PATH || (existsSync(ffprobeStatic.path) ? ffprobeStatic.path : 'ffprobe');
function generate(args) {
  const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  assert.equal(run.status, 0, run.stderr?.toString());
}
const available = spawnSync(ffmpeg, ['-version']).status === 0;

test('rejects invalid or oversized trim ranges', () => {
  assert.deepEqual(validateRange(1, 2.5, 3), { start: 1, end: 2.5, duration: 1.5 });
  for (const [start, end] of [
    [-1, 2],
    [2, 1],
    [0, 4],
    ['NaN', 1],
    [3, 3],
  ])
    assert.throws(() => validateRange(start, end, 3), { code: 'INVALID_TRIM' });
  assert.throws(() => validateRange(0, MAX_TRANSCRIPTION_SECONDS + 1, 7200), {
    code: 'TRIM_REQUIRED',
  });
});
test(
  'real FFmpeg: inspect and trim MP4, MP3, WAV, M4A, AAC, OGG, FLAC, WebM and MOV',
  { skip: !available, timeout: 60000 },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'voz-test-'));
    try {
      const wav = path.join(directory, 'source.wav');
      generate(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', wav]);
      for (const extension of ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'webm', 'mov']) {
        await t.test(extension, async () => {
          const input = path.join(directory, `source.${extension}`);
          if (extension === 'mp4' || extension === 'mov')
            generate([
              '-f',
              'lavfi',
              '-i',
              'color=c=blue:s=160x100:d=3',
              '-i',
              wav,
              '-shortest',
              '-c:v',
              'libx264',
              '-c:a',
              'aac',
              input,
            ]);
          else if (extension === 'webm')
            generate([
              '-f',
              'lavfi',
              '-i',
              'color=c=blue:s=160x100:d=3',
              '-i',
              wav,
              '-shortest',
              '-c:v',
              'libvpx',
              '-c:a',
              'libopus',
              input,
            ]);
          else if (extension !== 'wav') generate(['-i', wav, input]);
          const buffer = await readFile(input),
            info = await inspectMedia(buffer, extension);
          assert(Math.abs(info.durationMs - 3000) < 150);
          assert.equal(info.hasAudio, true);
          assert.equal(info.peaks.length, 180);
          assert(Math.max(...info.peaks) > 0);
          assert.equal(info.hasVideo, ['mp4', 'webm', 'mov'].includes(extension));
          const clip = await convertMedia(buffer, extension, { start: 0.8, end: 1.55 });
          assert.equal(clip.durationMs, 750);
          assert.equal(clip.mimeType, 'audio/wav');
          const target = path.join(directory, `clip-${extension}.wav`);
          await writeFile(target, clip.buffer);
          const clipMetadata = JSON.parse(
            spawnSync(ffprobe, [
              '-v',
              'error',
              '-show_format',
              '-show_streams',
              '-of',
              'json',
              target,
            ]).stdout,
          );
          assert(Math.abs(Number(clipMetadata.format.duration) - 0.75) < 0.01);
          assert.equal(clipMetadata.streams[0].sample_rate, '16000');
          assert.equal(clipMetadata.streams[0].channels, 1);
          if (extension === 'mp4' || extension === 'mp3') {
            const exported = await convertMedia(buffer, extension, {
              start: 1,
              end: 2,
              output: extension,
            });
            assert(exported.buffer.length > 100);
            assert.equal(exported.extension, extension);
            await writeFile(path.join(directory, `export.${extension}`), exported.buffer);
            const exportMetadata = JSON.parse(
              spawnSync(ffprobe, [
                '-v',
                'error',
                '-show_format',
                '-show_streams',
                '-of',
                'json',
                path.join(directory, `export.${extension}`),
              ]).stdout,
            );
            assert(Math.abs(Number(exportMetadata.format.duration) - 1) < 0.15);
            if (extension === 'mp4')
              assert(exportMetadata.streams.some((s) => s.codec_type === 'video'));
          }
        });
      }
      await t.test('malformed file, forbidden format and video without sound', async () => {
        await assert.rejects(inspectMedia(Buffer.from('invalid'), 'mp4'), {
          code: 'INVALID_MEDIA',
        });
        await assert.rejects(inspectMedia(Buffer.from('invalid'), 'm3u8'), {
          code: 'INVALID_MEDIA_TYPE',
        });
        const silent = path.join(directory, 'silent.mp4');
        generate(['-f', 'lavfi', '-i', 'color=c=blue:s=160x100:d=1', '-c:v', 'libx264', silent]);
        await assert.rejects(inspectMedia(await readFile(silent), 'mp4'), { code: 'NO_AUDIO' });
      });
      await t.test('actual HTTP media router returns a clipped WAV and metadata', async () => {
        const server = express().use('/api/media', mediaRouter).listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        try {
          const response = await fetch(
            `http://127.0.0.1:${server.address().port}/api/media/convert?extension=wav&start=1&end=2`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream' },
              body: await readFile(wav),
            },
          );
          assert.equal(response.status, 200);
          assert.equal(response.headers.get('content-type'), 'audio/wav');
          assert.equal(response.headers.get('x-media-duration-ms'), '1000');
          assert((await response.arrayBuffer()).byteLength > 32000);
        } finally {
          server.close();
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test('production media routes enforce authentication before accepting bytes', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    for (const action of ['inspect', 'convert']) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/media/${action}?extension=mp4`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: Buffer.from('invalid'),
        },
      );
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
    }
    const config = await fetch(`http://127.0.0.1:${server.address().port}/api/config`).then((r) =>
      r.json(),
    );
    assert.equal(config.supabaseSecretKey, undefined);
    assert.deepEqual(config.oauthProviders, ['google', 'github']);
    assert.equal(
      (await fetch(`http://127.0.0.1:${server.address().port}/assets/brand/logo-symbol.png`))
        .status,
      200,
    );
    const favicon = await fetch(`http://127.0.0.1:${server.address().port}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type'), /image\/png/);
  } finally {
    server.close();
  }
});
