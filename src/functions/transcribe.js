
import { BatchClient } from "@speechmatics/batch-client";
import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { convertToWav } from "../utils/convertToWav.js";

function formatSrtTimestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);

  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const secs = Math.floor((milliseconds % 60000) / 1000);
  const ms = milliseconds % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0")
  ].join(":") + `,${String(ms).padStart(3, "0")}`;
}

// Extract words and attach punctuation to the preceding word.
function extractWords(results) {
  const words = [];

  for (const result of results) {
    const content = result.alternatives?.[0]?.content;

    if (!content) continue;

    // Attach punctuation to the preceding word.
    if (
      result.type === "punctuation" &&
      result.attaches_to === "previous" &&
      words.length > 0
    ) {
      words[words.length - 1].text += content;
      continue;
    }

    if (result.type !== "word") continue;

    words.push({
      text: content,
      start: result.start_time,
      end: result.end_time
    });
  }

  return words;
}

// Generate word-by-word SRT.
function generateWordByWordSrt(words) {
  return words.map((word, index) => {
    return [
      index + 1,
      `${formatSrtTimestamp(word.start)} --> ${formatSrtTimestamp(word.end)}`,
      word.text
    ].join("\n");
  }).join("\n\n");
}

// Generate sentence-by-sentence SRT.
function generateSentenceBySentenceSrt(words) {
  const sentences = [];
  let currentSentence = [];

  for (const word of words) {
    currentSentence.push(word);

    // Detect sentence-ending punctuation.
    if (/[.!?]["')\]]*$/.test(word.text)) {
      sentences.push(currentSentence);
      currentSentence = [];
    }
  }

  // Save any remaining words, even if the transcript
  // does not end with sentence-ending punctuation.
  if (currentSentence.length > 0) {
    sentences.push(currentSentence);
  }

  return sentences.map((sentence, index) => {
    const start = sentence[0].start;
    const end = sentence[sentence.length - 1].end;

    const text = sentence
      .map(word => word.text)
      .join(" ");

    return [
      index + 1,
      `${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}`,
      text
    ].join("\n");
  }).join("\n\n");
}

// Transcribe output/raw.wav and generate two SRT files.


export async function transcribeRawAudio({ cycle = 1 } = {}) {
  const outputDir = path.resolve("output");

  let inputPath;

  if (cycle === 2) {
    const videoPath = path.join(
      outputDir,
      "long_pauses_trimmed.mp4"
    );

    inputPath = path.join(
      outputDir,
      "long_pauses_trimmed.wav"
    );

    await fs.access(videoPath);

    console.log("Converting trimmed video to WAV...");

    await convertToWav(videoPath, inputPath);
  } else {
    inputPath = path.join(outputDir, "raw.wav");
  }

  const wordOutputPath = path.join(
    outputDir,
    "wordByWordTranscription.srt"
  );

  const sentenceOutputPath = path.join(
    outputDir,
    "sentenceBySentenceTranscription.srt"
  );

  const apiKey = process.env.SPEECHMATICS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "SPEECHMATICS_API_KEY environment variable is missing."
    );
  }

  await fs.access(inputPath);

  const client = new BatchClient({
    apiKey,
    appId: "AiVideoCutter"
  });

  console.log(`Uploading ${path.basename(inputPath)} to Speechmatics...`);

  const blob = await openAsBlob(inputPath);
  const file = new File([blob], path.basename(inputPath));

  try {
    const response = await client.transcribe(
      file,
      {
        transcription_config: {
          language: "en",
        }
      },
      "json-v2"
    );

    console.log("Transcription completed. Generating SRT files...");

    const words = extractWords(response.results);

    if (words.length === 0) {
      throw new Error(
        "Speechmatics returned no recognizable words."
      );
    }

    const wordSrt = generateWordByWordSrt(words);
    const sentenceSrt = generateSentenceBySentenceSrt(words);

    await Promise.all([
      fs.writeFile(wordOutputPath, wordSrt, "utf8"),
      fs.writeFile(sentenceOutputPath, sentenceSrt, "utf8")
    ]);

    console.log("Word-by-word SRT saved.");
    console.log("Sentence-by-sentence SRT saved.");

    return {
      wordOutputPath,
      sentenceOutputPath
    };

  } catch (error) {
    console.error("Speechmatics error:", error);

    throw new Error(
      `Speechmatics transcription failed: ${error.message}`
    );
  }
}
