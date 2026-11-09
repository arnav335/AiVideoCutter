
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------- CONFIGURATION ----------------

const CUT_PADDING_SECONDS = 0.08;
const MERGE_GAP_SECONDS = 0.25;

const MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".avi",
  ".m4v",
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
]);

// ------------------------------------------------

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../");

const inputDir = path.join(projectRoot, "input");
const outputDir = path.join(projectRoot, "output");

const wordSrtPath = path.join(
  outputDir,
  "wordByWordTranscription.srt"
);

const originalSrtPath = path.join(
  outputDir,
  "sentenceBySentenceTranscription.srt"
);

const annotatedSrtPath = path.join(
  outputDir,
  "annotatedSentenceBySentenceTranscription.srt"
);

// ---------------- SRT PARSING ----------------

function timestampToSeconds(timestamp) {
  const match = timestamp.match(
    /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/
  );

  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${timestamp}`);
  }

  const [, hours, minutes, seconds, milliseconds] = match;

  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(milliseconds) / 1000
  );
}

function parseSRT(content) {
  const blocks = content
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/);

  const entries = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 3) {
      continue;
    }

    const timestampIndex = lines.findIndex((line) =>
      /^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line)
    );

    if (timestampIndex === -1) {
      continue;
    }

    const id = lines[0];

    const timestampMatch = lines[timestampIndex].match(
      /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );

    if (!timestampMatch) {
      continue;
    }

    const start = timestampToSeconds(timestampMatch[1]);
    const end = timestampToSeconds(timestampMatch[2]);

    if (end <= start) {
      throw new Error(`Invalid SRT interval for entry ${id}`);
    }

    const text = lines
      .slice(timestampIndex + 1)
      .join(" ")
      .trim();

    entries.push({
      id,
      start,
      end,
      text,
    });
  }

  return entries;
}

// ---------------- DELETION DETECTION ----------------

function isMarkedForDeletion(text) {
  const trimmed = text.trim();

  return trimmed.startsWith("[") && trimmed.endsWith("]");
}

function getDeletedSentenceEntries(originalEntries, annotatedEntries) {
  const originalById = new Map(
    originalEntries.map((entry) => [entry.id, entry])
  );

  const deletedEntries = [];

  for (const annotated of annotatedEntries) {
    if (!isMarkedForDeletion(annotated.text)) {
      continue;
    }

    const original = originalById.get(annotated.id);

    if (!original) {
      throw new Error(
        `Could not find original sentence SRT entry ${annotated.id}`
      );
    }

    deletedEntries.push(original);
  }

  return deletedEntries;
}

// ---------------- WORD-LEVEL ALIGNMENT ----------------

function getWordIntervals(deletedSentences, wordEntries) {
  const intervals = [];

  for (const sentence of deletedSentences) {
    // Use word midpoints to avoid accidentally including
    // neighbouring words that only slightly overlap a sentence.
    const matchingWords = wordEntries.filter((word) => {
      const midpoint = (word.start + word.end) / 2;

      return (
        midpoint >= sentence.start - 0.05 &&
        midpoint <= sentence.end + 0.05
      );
    });

    if (matchingWords.length === 0) {
      throw new Error(
        `No word-level timestamps found for deleted sentence ${sentence.id}: "${sentence.text}"`
      );
    }

    // The sentence-level editorial decision removes the
    // complete sentence, so use its first and last word.
    const firstWord = matchingWords[0];
    const lastWord = matchingWords[matchingWords.length - 1];

    intervals.push({
      start: firstWord.start,
      end: lastWord.end,
    });
  }

  return intervals;
}

// ---------------- INTERVAL PROCESSING ----------------

function addPadding(intervals, duration) {
  return intervals.map((interval) => ({
    start: Math.max(0, interval.start - CUT_PADDING_SECONDS),
    end: Math.min(duration, interval.end + CUT_PADDING_SECONDS),
  }));
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort(
    (a, b) => a.start - b.start
  );

  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = merged[merged.length - 1];

    const gap = current.start - previous.end;

    // Merge overlapping intervals AND intervals separated
    // by a very small surviving gap.
    if (gap <= MERGE_GAP_SECONDS) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function getKeepIntervals(deletionIntervals, duration) {
  const keepIntervals = [];
  let cursor = 0;

  for (const interval of deletionIntervals) {
    if (interval.start > cursor) {
      keepIntervals.push({
        start: cursor,
        end: interval.start,
      });
    }

    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < duration) {
    keepIntervals.push({
      start: cursor,
      end: duration,
    });
  }

  // Ignore extremely short surviving fragments.
  return keepIntervals.filter(
    (interval) => interval.end - interval.start > 0.02
  );
}

// ---------------- MEDIA PROBING ----------------

async function probeMedia(mediaPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,duration",
    "-of",
    "json",
    mediaPath,
  ]);

  const data = JSON.parse(stdout);

  const hasVideo = data.streams.some(
    (stream) => stream.codec_type === "video"
  );

  const hasAudio = data.streams.some(
    (stream) => stream.codec_type === "audio"
  );

  const formatDuration = Number(data.format?.duration);

  const streamDurations = data.streams
    .map((stream) => Number(stream.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);

  const duration =
    Number.isFinite(formatDuration) && formatDuration > 0
      ? formatDuration
      : streamDurations.length > 0
        ? Math.max(...streamDurations)
        : NaN;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine media duration.");
  }

  if (!hasVideo && !hasAudio) {
    throw new Error("Input media contains neither video nor audio.");
  }

  return {
    duration,
    hasVideo,
    hasAudio,
  };
}

// ---------------- FILTER GRAPH ----------------

function formatSeconds(seconds) {
  return seconds.toFixed(6);
}

function buildFilterGraph(keepIntervals, hasVideo, hasAudio) {
  const filters = [];
  const concatInputs = [];

  keepIntervals.forEach((interval, index) => {
    const start = formatSeconds(interval.start);
    const end = formatSeconds(interval.end);

    if (hasVideo) {
      filters.push(
        `[0:v:0]setpts=PTS-STARTPTS,` +
        `trim=start=${start}:end=${end},` +
        `setpts=PTS-STARTPTS[v${index}]`
      );

      concatInputs.push(`[v${index}]`);
    }

    if (hasAudio) {
      filters.push(
        `[0:a:0]asetpts=PTS-STARTPTS,` +
        `atrim=start=${start}:end=${end},` +
        `asetpts=PTS-STARTPTS[a${index}]`
      );

      concatInputs.push(`[a${index}]`);
    }
  });

  const concatOptions =
    `concat=n=${keepIntervals.length}:` +
    `v=${hasVideo ? 1 : 0}:` +
    `a=${hasAudio ? 1 : 0}`;

  const outputLabels = [];

  if (hasVideo) outputLabels.push("[vout]");
  if (hasAudio) outputLabels.push("[aout]");

  filters.push(
    `${concatInputs.join("")}${concatOptions}${outputLabels.join("")}`
  );

  return filters.join(";\n");
}

// ---------------- INPUT DISCOVERY ----------------

async function findInputMedia() {
  return "output/long_pauses_trimmed.mp4"
}

// ---------------- MAIN RENDER FUNCTION ----------------


export async function renderFinalVideo() {
  try {
    console.log("\nStarting final media rendering...\n");

    await fs.mkdir(outputDir, { recursive: true });

    // 1. Fixed input media path.
    const mediaPath = path.join(
      outputDir,
      "long_pauses_trimmed.mp4"
    );

    // Verify input exists.
    await fs.access(mediaPath);

    console.log(`Input media: ${mediaPath}`);

    // 2. Read all three subtitle files.
    const [
      wordSrt,
      originalSrt,
      annotatedSrt,
    ] = await Promise.all([
      fs.readFile(wordSrtPath, "utf8"),
      fs.readFile(originalSrtPath, "utf8"),
      fs.readFile(annotatedSrtPath, "utf8"),
    ]);

    const wordEntries = parseSRT(wordSrt);
    const originalEntries = parseSRT(originalSrt);
    const annotatedEntries = parseSRT(annotatedSrt);

    if (wordEntries.length === 0) {
      throw new Error("Word-level SRT contains no entries.");
    }

    if (originalEntries.length === 0) {
      throw new Error("Original sentence SRT contains no entries.");
    }

    console.log(`Word entries: ${wordEntries.length}`);
    console.log(`Sentence entries: ${originalEntries.length}`);

    // 3. Identify sentences Groq marked for deletion.
    const deletedSentences = getDeletedSentenceEntries(
      originalEntries,
      annotatedEntries
    );

    console.log(
      `Sentences marked for deletion: ${deletedSentences.length}`
    );

    // 4. Map deleted sentences to word-level timestamps.
    const wordIntervals = getWordIntervals(
      deletedSentences,
      wordEntries
    );

    // 5. Probe the input media.
    const mediaInfo = await probeMedia(mediaPath);

    // 6. Add padding to deletion intervals.
    const paddedIntervals = addPadding(
      wordIntervals,
      mediaInfo.duration
    );

    // 7. Merge overlapping or very closely spaced intervals.
    const deletionIntervals = mergeIntervals(paddedIntervals);

    console.log(
      `Deletion intervals after merging: ${deletionIntervals.length}`
    );

    // 8. Calculate intervals that should remain.
    const keepIntervals = getKeepIntervals(
      deletionIntervals,
      mediaInfo.duration
    );

    if (keepIntervals.length === 0) {
      throw new Error(
        "All media content would be removed. Rendering cancelled."
      );
    }

    console.log(`Surviving segments: ${keepIntervals.length}`);

    // 9. Generate the FFmpeg filter graph.
    const filterGraph = buildFilterGraph(
      keepIntervals,
      mediaInfo.hasVideo,
      mediaInfo.hasAudio
    );

    // 10. Choose output format.
    const isVideo = mediaInfo.hasVideo;

    const outputPath = path.join(
      outputDir,
      isVideo ? "output.mp4" : "output.wav"
    );

    // 11. Build FFmpeg arguments.
    // Pass filter graph directly instead of using
    // -filter_complex_script, which this FFmpeg build
    // does not support.
    const ffmpegArgs = [
      "-y",
      "-i",
      mediaPath,
      "-filter_complex",
      filterGraph,
    ];

    if (mediaInfo.hasVideo) {
      ffmpegArgs.push("-map", "[vout]");
    }

    if (mediaInfo.hasAudio) {
      ffmpegArgs.push("-map", "[aout]");
    }

    if (isVideo) {
      ffmpegArgs.push(
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p"
      );

      if (mediaInfo.hasAudio) {
        ffmpegArgs.push(
          "-c:a",
          "aac",
          "-b:a",
          "192k"
        );
      }

      ffmpegArgs.push(
        "-movflags",
        "+faststart"
      );
    } else {
      ffmpegArgs.push(
        "-c:a",
        "pcm_s16le"
      );
    }

    ffmpegArgs.push(outputPath);

    // 12. Render.
    console.log("\nRendering with FFmpeg...\n");

    await execFileAsync("ffmpeg", ffmpegArgs, {
      maxBuffer: 20 * 1024 * 1024,
    });

    console.log("\nRendering completed successfully.");
    console.log(`Output: ${outputPath}\n`);

    return outputPath;

  } catch (error) {
    console.error("\nRendering failed:", error.message);
    throw error;
  }
}

export default renderFinalVideo;
