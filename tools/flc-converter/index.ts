/**
 * SimGolf Web — FLC Converter
 *
 * Décode les fichiers Autodesk Animator FLC/FLI extraits du binaire
 * SimGolf et les convertit en spritesheets PNG + JSON compatibles
 * Phaser 4 Texture Manager.
 *
 * Backend: ffmpeg (décodeur FLC natif fiable + assemblage spritesheet)
 *
 * Usage:
 *   npx tsx tools/flc-converter/index.ts <input.flc> [options]
 *   npx tsx tools/flc-converter/index.ts --batch <input_dir> [options]
 *
 * Options:
 *   --output <dir>       Sortie (par défaut: ./output)
 *   --fps <n>            FPS de l'animation (par défaut: 15)
 *   --single             PNGs individuels au lieu de spritesheet
 *   --scale <n>          Facteur d'échelle pixel art (par défaut: 2)
 *   --transparent-color  Couleur chroma key hex (par défaut: FF00FF)
 *   --max-width <n>      Largeur max du spritesheet (par défaut: 2048)
 *   --keep-frames        Conserver les frames individuelles (debug)
 */

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync,
  existsSync, rmSync, copyFileSync,
} from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';

// ================================================================
// Types
// ================================================================

interface SpriteFrame {
  filename: string;
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;
}

interface TextureJson {
  frames: Record<string, SpriteFrame>;
  meta: {
    app: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: string;
    frameTags: { name: string; from: number; to: number; direction: string }[];
  };
}

// ================================================================
// ffmpeg helpers
// ================================================================

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function probeFlc(filePath: string): {
  width: number;
  height: number;
  frames: number;
  fps: number;
} | null {
  try {
    const output = exec(
      `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
    );
    const info = JSON.parse(output);
    const stream = info.streams?.[0];
    if (!stream) return null;

    return {
      width: stream.width,
      height: stream.height,
      frames: stream.nb_frames ? parseInt(stream.nb_frames) : 0,
      fps: stream.r_frame_rate
        ? evalFps(stream.r_frame_rate)
        : stream.avg_frame_rate
          ? evalFps(stream.avg_frame_rate)
          : 12,
    };
  } catch {
    return null;
  }
}

function evalFps(rate: string): number {
  const parts = rate.split('/');
  if (parts.length === 2) {
    return parseInt(parts[0]) / parseInt(parts[1]);
  }
  return parseFloat(rate) || 12;
}

function extractFrames(
  inputPath: string,
  outputDir: string,
  transparentColor: string,
): { width: number; height: number; count: number } | null {
  mkdirSync(outputDir, { recursive: true });

  // Extraire toutes les frames en PNG RGBA avec transparence chroma key
  const cmd = [
    'ffmpeg', '-y',
    '-i', `"${inputPath}"`,
    '-vf', `colorkey=0x${transparentColor}:0.01:0.0,format=rgba`,
    '-frames:v', '9999',
    '-compression_level', '0',  // PNG compression none (faster)
    `"${join(outputDir, 'frame_%04d.png')}"`,
  ].join(' ');

  try {
    exec(cmd);
  } catch {
    // ffmpeg may exit non-zero but still produce frames
  }

  const files = readdirSync(outputDir)
    .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
    .sort();

  if (files.length === 0) return null;

  // Dimensions via ffprobe
  try {
    const probePath = join(outputDir, files[0]);
    const probe = exec(
      `ffprobe -v quiet -print_format json -show_streams "${probePath}"`,
    );
    const info = JSON.parse(probe);
    const stream = info.streams?.[0];
    if (stream?.width && stream?.height) {
      return {
        width: stream.width,
        height: stream.height,
        count: files.length,
      };
    }
  } catch {
    // Fallback: read via PIL or just assume
  }

  // Fallback: assume all frames same size, get from first file
  return { width: 0, height: 0, count: files.length };
}

// ================================================================
// PNG assembly via ffmpeg (spritesheet)
// ================================================================

function buildSpritesheet(
  framesDir: string,
  outputPath: string,
  width: number,
  height: number,
  scale: number,
  maxWidth: number,
  frameCount: number,
): { sheetWidth: number; sheetHeight: number; framesPerRow: number } | null {
  const sw = width * scale;
  const sh = height * scale;

  const framesPerRow = Math.min(frameCount, Math.floor(maxWidth / sw));
  if (framesPerRow < 1) return null;

  const rows = Math.ceil(frameCount / framesPerRow);

  // ffmpeg tile filter to create spritesheet
  const cmd = [
    'ffmpeg', '-y',
    '-pattern_type', 'glob',
    '-i', `"${join(framesDir, 'frame_*.png')}"`,
    '-vf', `scale=${sw}:${sh},tile=${framesPerRow}x${rows}:padding=0:margin=0`,
    '-frames:v', '1',
    '-compression_level', '0',
    `"${outputPath}"`,
  ].join(' ');

  try {
    exec(cmd);
  } catch {
    return null;
  }

  if (!existsSync(outputPath)) return null;

  // Get actual sheet dimensions
  try {
    const probe = exec(
      `ffprobe -v quiet -print_format json -show_streams "${outputPath}"`,
    );
    const info = JSON.parse(probe);
    const stream = info.streams?.[0];
    if (stream?.width && stream?.height) {
      return {
        sheetWidth: stream.width,
        sheetHeight: stream.height,
        framesPerRow,
      };
    }
  } catch {
    // Fallback calculation
  }

  // Fallback
  return {
    sheetWidth: framesPerRow * sw,
    sheetHeight: rows * sh,
    framesPerRow,
  };
}

// ================================================================
// JSON generation
// ================================================================

function generateJson(
  name: string,
  frameCount: number,
  frameWidth: number,
  frameHeight: number,
  scale: number,
  sheetWidth: number,
  sheetHeight: number,
  framesPerRow: number,
  fps: number,
): TextureJson {
  const sw = frameWidth * scale;
  const sh = frameHeight * scale;
  const frameDuration = Math.round(1000 / fps);

  const framesJson: Record<string, SpriteFrame> = {};

  for (let i = 0; i < frameCount; i++) {
    const col = i % framesPerRow;
    const row = Math.floor(i / framesPerRow);

    // The tile filter may have trimmed empty rows at the end
    // Only include frames that actually fit in the sheet
    if (row * sh >= sheetHeight || col * sw >= sheetWidth) continue;

    framesJson[`frame_${i.toString().padStart(4, '0')}`] = {
      filename: `frame_${i.toString().padStart(4, '0')}`,
      frame: {
        x: col * sw,
        y: row * sh,
        w: sw,
        h: sh,
      },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frameWidth, h: frameHeight },
      sourceSize: { w: sw, h: sh },
      duration: frameDuration,
    };
  }

  const actualFrameCount = Object.keys(framesJson).length;

  return {
    frames: framesJson,
    meta: {
      app: 'simgolf-flc-converter',
      image: `${name}.png`,
      format: 'RGBA8888',
      size: { w: sheetWidth, h: sheetHeight },
      scale: scale.toString(),
      frameTags: [
        {
          name: 'default',
          from: 0,
          to: actualFrameCount - 1,
          direction: 'forward',
        },
      ],
    },
  };
}

// ================================================================
// CLI
// ================================================================

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[key] = args[i + 1];
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function processFlcFile(
  inputPath: string,
  outputDir: string,
  options: Record<string, string | boolean>,
): void {
  const name = basename(inputPath, extname(inputPath));
  const fps = parseInt(options.fps as string) || 15;
  const scale = parseInt(options.scale as string) || 2;
  const transparentColor = (options['transparent-color'] as string) || 'FF00FF';
  const maxWidth = parseInt(options['max-width'] as string) || 2048;
  const singleMode = !!options.single;
  const keepFrames = !!options['keep-frames'];

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Converting: ${name}.flc`);

  // Probe
  const probe = probeFlc(inputPath);
  if (!probe) {
    console.error(`  ERREUR: Impossible de probe le fichier`);
    return;
  }

  console.log(`  ${probe.width}x${probe.height}, ~${probe.frames} frames, ${probe.fps.toFixed(1)} fps`);

  // Extract frames with ffmpeg
  const tmpDir = join(outputDir, '_tmp_' + name);
  const result = extractFrames(inputPath, tmpDir, transparentColor);

  if (!result || result.count === 0) {
    console.error(`  ERREUR: Aucune frame extraite`);
    rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  console.log(`  Frames extraites: ${result.count} (${result.width}x${result.height})`);

  // Export
  const outDir = join(outputDir, name);
  mkdirSync(outDir, { recursive: true });

  if (singleMode) {
    // Copier les frames individuelles
    const files = readdirSync(tmpDir)
      .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
      .sort();

    for (const ff of files) {
      const destName = `${name}_${ff}`;
      copyFileSync(join(tmpDir, ff), join(outDir, destName));
    }

    if (!keepFrames) {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log(`  Exporté ${files.length} PNGs individuels dans ${outDir}/`);
  } else {
    // Build spritesheet
    const sheetPath = join(outDir, `${name}.png`);
    const sheetInfo = buildSpritesheet(
      tmpDir,
      sheetPath,
      result.width,
      result.height,
      scale,
      maxWidth,
      result.count,
    );

    if (!sheetInfo) {
      console.error(`  ERREUR: Impossible de créer le spritesheet`);
      if (!keepFrames) rmSync(tmpDir, { recursive: true, force: true });
      return;
    }

    console.log(`  Spritesheet: ${sheetInfo.sheetWidth}x${sheetInfo.sheetHeight}px`);

    // Generate JSON
    const json = generateJson(
      name,
      result.count,
      result.width,
      result.height,
      scale,
      sheetInfo.sheetWidth,
      sheetInfo.sheetHeight,
      sheetInfo.framesPerRow,
      fps,
    );

    const jsonPath = join(outDir, `${name}.json`);
    writeFileSync(jsonPath, JSON.stringify(json, null, 2));

    console.log(`  Scale: ${scale}x, FPS: ${fps}, Frames: ${Object.keys(json.frames).length}`);
    console.log(`  PNG: ${sheetPath}`);
    console.log(`  JSON: ${jsonPath}`);

    if (!keepFrames) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  const outputDir = (opts.output as string) || './output';

  mkdirSync(outputDir, { recursive: true });

  if (opts.batch) {
    const inputDir = args.find(a => !a.startsWith('--'));
    if (!inputDir || !existsSync(inputDir)) {
      console.error('Usage: --batch <directory>');
      process.exit(1);
    }

    const files = readdirSync(inputDir)
      .filter(f => f.toLowerCase().endsWith('.flc') || f.toLowerCase().endsWith('.fli'))
      .sort();

    console.log(`Batch mode: ${files.length} fichiers dans ${inputDir}`);

    for (const file of files) {
      processFlcFile(join(inputDir, file), outputDir, opts);
    }

    console.log(`\n✅ Batch terminé: ${files.length} fichiers convertis`);
    return;
  }

  const inputFile = args.find(a => !a.startsWith('--'));
  if (!inputFile) {
    console.log(`
Usage:
  npx tsx tools/flc-converter/index.ts <input.flc> [options]
  npx tsx tools/flc-converter/index.ts --batch <dir> [options]

Options:
  --output <dir>       Sortie (par défaut: ./output)
  --fps <n>            FPS (par défaut: 15)
  --single             PNGs individuels au lieu de spritesheet
  --scale <n>          Facteur d'échelle (par défaut: 2)
  --transparent-color  Couleur chroma key hex (par défaut: FF00FF)
  --max-width <n>      Largeur max spritesheet (par défaut: 2048)
  --keep-frames        Conserver les frames individuelles (debug)
`);
    process.exit(0);
  }

  processFlcFile(inputFile, outputDir, opts);
}

main();
