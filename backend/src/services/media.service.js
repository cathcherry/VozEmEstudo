import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { AppError } from '../domain/errors.js';

export const MEDIA_EXTENSIONS = Object.freeze(['mp4', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'mov']);
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const MAX_TRANSCRIPTION_SECONDS = Math.floor((MAX_MEDIA_BYTES - 4096) / 32000);
/** Transcription outputs: 16 kHz PCM WAV, or 'speech' (mono MP3, ~0.5 MB/min) for uploads. */
const TRANSCRIPTION_OUTPUTS = new Set(['wav', 'speech']);
const SPEECH_ARGS = Object.freeze(['-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k']);
const ffmpeg = process.env.FFMPEG_PATH || (ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : 'ffmpeg');
const ffprobe = process.env.FFPROBE_PATH || (existsSync(ffprobeStatic.path) ? ffprobeStatic.path : 'ffprobe');
const inputOptions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp3,wav,ogg,matroska,webm,flac,aac'];
let active = 0;

function execute(binary, args, { maxBytes = MAX_MEDIA_BYTES + 4096, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0; let failure;
    const timer = setTimeout(() => { failure = new AppError('MEDIA_TIMEOUT', 'O arquivo demorou demais para ser processado. Escolha um trecho menor.', 408); process.kill('SIGKILL'); }, timeoutMs);
    process.stdout.on('data', (data) => {
      size += data.length;
      if (size > maxBytes) { failure = new AppError('MEDIA_TOO_LARGE', 'O trecho convertido excede 100 MB. Reduza a duração do recorte.', 413); process.kill('SIGKILL'); }
      else chunks.push(data);
    });
    process.stderr.on('data', () => {});
    process.on('error', () => { clearTimeout(timer); reject(new AppError('MEDIA_TOOL_MISSING', 'O conversor de mídia não está disponível. Reinstale as dependências do servidor ou configure FFmpeg e FFprobe.', 503)); });
    process.on('close', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new AppError('INVALID_MEDIA', 'Não foi possível ler a mídia. Confira se o arquivo está íntegro e contém áudio.', 422));
      else resolve(Buffer.concat(chunks));
    });
  });
}

export function validateRange(start, end, duration, output = 'wav') {
  const from = Number(start ?? 0), to = end == null || end === '' ? duration : Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > duration + .05 || from >= duration) {
    throw new AppError('INVALID_TRIM', 'Escolha um início e um fim válidos dentro da duração do arquivo.', 400);
  }
  if (TRANSCRIPTION_OUTPUTS.has(output) && to - from > MAX_TRANSCRIPTION_SECONDS) {
    throw new AppError('TRIM_REQUIRED', `Para transcrever, selecione um trecho de até ${Math.floor(MAX_TRANSCRIPTION_SECONDS / 60)} minutos.`, 413);
  }
  return { start: from, end: Math.min(to, duration), duration: Math.min(to, duration) - from };
}

async function withMedia(buffer, extension, callback) {
  if (!MEDIA_EXTENSIONS.includes(String(extension).toLowerCase())) throw new AppError('INVALID_MEDIA_TYPE', 'Use MP4, MP3, WAV, M4A, AAC, OGG, FLAC, WebM ou MOV.', 400);
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_MEDIA_BYTES) throw new AppError('MEDIA_TOO_LARGE', 'Escolha um arquivo com conteúdo e até 100 MB.', 413);
  if (active >= 2) throw new AppError('MEDIA_BUSY', 'O conversor está ocupado. Tente novamente em alguns instantes.', 429);
  active++;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'voz-media-'));
    const input = path.join(directory, `source.${String(extension).toLowerCase()}`);
    await writeFile(input, buffer);
    const data = JSON.parse((await execute(ffprobe, ['-v', 'error', ...inputOptions, '-show_format', '-show_streams', '-of', 'json', input], { maxBytes: 1024 * 1024, timeoutMs: 30000 })).toString());
    const streams = data.streams || [];
    if (!streams.some((s) => s.codec_type === 'audio')) throw new AppError('NO_AUDIO', 'Este vídeo não tem uma faixa de áudio. Escolha uma gravação com som.', 422);
    let duration = Number(data.format?.duration || streams.find((s) => s.codec_type === 'audio')?.duration);
    // Raw ADTS AAC has no duration field: ffprobe estimates it from the bitrate, which can be off
    // by several hundred ms and varies between FFmpeg builds. Count the frames instead
    // (1024 samples each), which is exact up to the encoder's priming frame.
    if (data.format?.format_name === 'aac') {
      const counted = JSON.parse((await execute(ffprobe, ['-v', 'error', '-count_packets', '-select_streams', 'a:0', '-show_entries', 'stream=nb_read_packets,sample_rate', '-of', 'json', input], { maxBytes: 1024 * 1024, timeoutMs: 30000 })).toString());
      const stream = counted.streams?.[0];
      const exact = (Number(stream?.nb_read_packets) * 1024) / Number(stream?.sample_rate);
      if (Number.isFinite(exact) && exact > 0) duration = exact;
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new AppError('INVALID_DURATION', 'Escolha uma gravação de até duas horas e com duração identificável.', 422);
    const hasVideo = streams.some((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
    return await callback({ input, directory, duration, hasVideo });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    active--;
  }
}

/** Trusted duration (seconds) measured with ffprobe on the server; never the browser's number. */
export async function probeDurationSeconds(buffer, extension) {
  return withMedia(buffer, extension, async ({ duration }) => duration);
}

export async function inspectMedia(buffer, extension) {
  return withMedia(buffer, extension, async ({ input, duration, hasVideo }) => {
    const pcm = await execute(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...inputOptions, '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '1000', '-f', 's16le', 'pipe:1'], { maxBytes: 16 * 1024 * 1024, timeoutMs: 120000 });
    const samples = pcm.length / 2, count = 180, peaks = [];
    for (let i = 0; i < count; i++) {
      let peak = 0;
      for (let j = Math.floor(i * samples / count); j < Math.floor((i + 1) * samples / count); j++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(j * 2)) / 32768);
      peaks.push(Number(peak.toFixed(4)));
    }
    return { durationMs: Math.round(duration * 1000), hasVideo, hasAudio: true, peaks, maxTranscriptionSeconds: MAX_TRANSCRIPTION_SECONDS };
  });
}

export async function convertMedia(buffer, extension, { start = 0, end, output = 'wav' } = {}) {
  if (!['wav', 'speech', 'mp3', 'mp4'].includes(output)) throw new AppError('INVALID_OUTPUT', 'Formato de exportação inválido.', 400);
  return withMedia(buffer, extension, async ({ input, directory, duration, hasVideo }) => {
    if (output === 'mp4' && !hasVideo) throw new AppError('NO_VIDEO', 'Escolha MP3 para exportar uma gravação sem vídeo.', 400);
    const range = validateRange(start, end, duration, output);
    const clipExtension = output === 'speech' ? 'mp3' : output;
    const target = path.join(directory, `clip.${clipExtension}`);
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputOptions, '-i', input, '-ss', String(range.start), '-t', String(range.duration)];
    if (output === 'mp4') args.push('-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
    else args.push('-map', '0:a:0', '-vn', '-ac', '1', ...(output === 'wav' ? ['-ar', '16000', '-c:a', 'pcm_s16le'] : output === 'speech' ? SPEECH_ARGS : ['-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k']));
    args.push('-fs', String(MAX_MEDIA_BYTES + 4096), target);
    await execute(ffmpeg, args);
    const result = await readFile(target);
    if (result.length > MAX_MEDIA_BYTES) throw new AppError('MEDIA_TOO_LARGE', 'O trecho exportado excede 100 MB. Escolha um recorte menor.', 413);
    // A file-size limit must never silently produce a shorter clip.
    const check = JSON.parse((await execute(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', target], { maxBytes: 1024 * 1024 })).toString());
    if (Number(check.format?.duration) < range.duration - .15) throw new AppError('MEDIA_TOO_LARGE', 'O trecho exportado excede o limite. Escolha um recorte menor.', 413);
    return { buffer: result, durationMs: Math.round(range.duration * 1000), extension: clipExtension, mimeType: output === 'mp4' ? 'video/mp4' : clipExtension === 'mp3' ? 'audio/mpeg' : 'audio/wav' };
  });
}
