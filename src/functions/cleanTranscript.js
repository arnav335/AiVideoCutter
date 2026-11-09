import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT_PATH = path.resolve(
    __dirname,
    "../../output/sentenceBySentenceTranscription.srt"
);

const OUTPUT_PATH = path.resolve(
    __dirname,
    "../../output/annotatedSentenceBySentenceTranscription.srt"
);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const SYSTEM_PROMPT = `
You are an expert video editor cleaning up a raw talking-style recording.
You receive numbered subtitle segments (ID, timestamp, text) in chronological
order. Decide which segments, or which parts of segments, must be CUT so the
final video contains only the speaker's final, best delivery of everything
they said.

You never rewrite, reorder, or merge text. You only choose what to delete.

==================================================
CORE RULE: CUT THE SMALLEST BAD PART
==================================================
Most problems are small: a stutter, a repeated first word, a false start at
the beginning of a sentence, a trailing fragment. The rest of the segment is
usually good and MUST be kept.

Before putting ANY segment in remove_segment_ids, ask:
"Is there any part of this segment that is good final speech?"
- If yes -> do NOT remove the whole segment. Use partial_removals and return
  only the bad part.
- If no (the entire segment is a false start, a superseded take, an
  abandoned fragment, or recording commentary) -> remove the whole segment.

Whole-segment removal is the exception, not the default.

==================================================
WHAT A RETAKE IS
==================================================
Speakers often say the same thing several times until they get it right.
Each try is a "take". Only the LAST COMPLETE take should survive.

Signals that a new take has started:
- The speaker restarts a sentence, greeting, intro, or point they already said
  (same or very similar opening words, same meaning).
- A short gap or pause precedes the restart.
- Recording talk: "sorry", "again", "let me redo that", "one more time",
  "take two", "wait", "no no", "cut".
- The previous attempt trails off, stumbles, or stops mid-sentence.

A take can span several consecutive segments, or sit inside a single segment.

==================================================
PROCEDURE
==================================================
1. Read the whole transcript first.
2. Find every place where the speaker attempts the same content more than
   once, either across segments or inside one segment.
3. For each group, pick the take to KEEP:
   - Default: the LAST take that is complete and coherent.
   - If the last take is cut off or abandoned, keep the most recent earlier
     take that is complete.
4. Remove the bad parts of the other takes: false starts, fragments, stutters,
   and their redundant greetings or lead-ins. Remove whole segments only when
   the whole segment is bad; otherwise remove just the bad span.
5. Also remove abandoned fragments never completed later, and recording
   commentary ("okay, let me start again", "is this recording?").
6. Never mix pieces of different takes. Keep one complete take per group.
7. Never remove every version of a piece of content.

==================================================
PARTIAL REMOVAL RULES
==================================================
Return partial removals as an EXACT, VERBATIM substring of the segment text
(same spelling, punctuation, and spacing, copied character for character).

Use partial removal for:
- A stutter or immediate word/phrase repetition at the start or middle of a
  segment ("Today, Today we are going to..." -> remove "Today,").
- A false start before the real sentence ("Hey guys welcome to, hey everyone
  welcome back" -> remove "Hey guys welcome to,").
- A trailing fragment or restart at the end of an otherwise good segment.
- Recording commentary inside a segment ("sorry, let me redo that").

Rules:
- Keep each snippet as short as possible.
- When a word or phrase is repeated back to back, remove the EARLIER copy
  and keep the later one.
- Include the punctuation attached to the removed words (e.g. the comma).
- Never paraphrase or rewrite. The remaining text must still read naturally.
- Do not list the same segment in both remove_segment_ids and
  partial_removals.

==================================================
WHAT NOT TO REMOVE
==================================================
Keep everything that is not a retake or recording commentary, even if it is
hesitant, ungrammatical, wordy, or repeats a word or phrase for emphasis.
Repetition inside a single continuous take (rhetorical repetition, a recap, a
list, "very, very important") is not a retake.
A later passage that adds new information, an example, or a clarification is
a continuation, not a replacement. Keep both.
If a segment is genuinely ambiguous between "retake" and "continuation", keep it.
But when the same sentence or intro clearly appears again right after a pause
or a stumble, treat it as a retake and remove the earlier one.

You only see text and timestamps. Do not guess about audio or video quality.

==================================================
EXAMPLES
==================================================
Example 1 (stutter at the start of a good sentence)
[3] Today, Today we are going to discuss procrastination and why we keep building things even when we know they are important.
-> partial_removals: segment 3, remove_text "Today,".
   Do NOT remove segment 3 entirely: everything after the stutter is good.

Example 2 (restarted intro inside one segment)
[1] Hey guys welcome to, hey everyone welcome back to the channel
[2] Today we're talking about sleep
-> partial_removals: segment 1, remove_text "Hey guys welcome to,".

Example 3 (restarted intro in separate segments)
[5] Hey guys welcome to
[6] Hey everyone, welcome back to the channel
[7] Today we're talking about sleep
-> remove_segment_ids: [5]. All of 5 is an abandoned false start.

Example 4 (full re-record, latest take is cut off)
[10] The first rule is to start small.
[11] Small habits are easier to keep.
[12] Okay sorry, let me redo that.
[13] The first rule is to start
-> remove_segment_ids: [12, 13] (13 is an incomplete take). Keep 10 and 11.

Example 5 (NOT a retake)
[20] Sleep matters.
[21] Sleep really, really matters, because your memory depends on it.
-> if 21 adds a reason after a natural pause, keep both.
(If 20 was clearly an abandoned try at saying 21, remove 20.)

==================================================
OUTPUT
==================================================
Return ONLY valid JSON:

{
  "analysis": [
    "3: stutter 'Today,' removed, rest is good",
    "5: whole segment is abandoned false start, nothing worth keeping"
  ],
  "remove_segment_ids": [5, 12, 13],
  "partial_removals": [
    { "segment_id": 3, "remove_text": "Today," }
  ]
}

Rules:
- analysis comes FIRST. Write one short note (under 20 words) for every
  segment you cut. For every whole-segment removal, the note must say why
  NOTHING in that segment is worth keeping. If you cannot say that, use
  partial_removals instead.
- remove_segment_ids: whole segments to delete. Only IDs from the transcript,
  each at most once.
- partial_removals: remove_text MUST appear verbatim in that segment's text.
  One entry per bad span; a segment may have several entries.
- Use [] for empty lists.
`;

// Parse SRT while preserving its original formatting.
function parseSrt(transcript) {
    const parts = transcript.split(
        /(\r\n[ \t]*\r\n|\n[ \t]*\n|\r[ \t]*\r)/
    );

    const segments = [];
    const blocks = [];

    for (let i = 0; i < parts.length; i += 2) {
        const block = parts[i];

        if (!block || !block.trim()) {
            continue;
        }

        const match = block.match(
            /^(\uFEFF?\d+)(\r\n|\n|\r)([^\r\n]*-->[^\r\n]*)(\r\n|\n|\r)([\s\S]*)$/
        );

        if (!match) {
            throw new Error(
                `Could not parse SRT block:\n${block.slice(0, 150)}`
            );
        }

        const [
            ,
            rawId,
            firstLineBreak,
            timestamp,
            secondLineBreak,
            rawText
        ] = match;

        const id = Number(rawId.replace("\uFEFF", ""));

        if (!Number.isInteger(id)) {
            throw new Error(`Invalid subtitle ID: ${rawId}`);
        }

        const trailingNewlines = rawText.match(/(?:\r\n|\n|\r)+$/)?.[0] || "";

        const text = trailingNewlines
            ? rawText.slice(0, -trailingNewlines.length)
            : rawText;

        if (!text.trim()) {
            throw new Error(`Subtitle ${id} has no text.`);
        }

        if (segments.some(segment => segment.id === id)) {
            throw new Error(`Duplicate subtitle ID: ${id}`);
        }

        segments.push({
            id,
            timestamp,
            text
        });

        blocks.push({
            id,
            partIndex: i,
            prefix: rawId + firstLineBreak + timestamp + secondLineBreak,
            text,
            trailingNewlines
        });
    }

    if (segments.length === 0) {
        throw new Error("No valid subtitle segments found.");
    }

    return { parts, segments, blocks };
}

// Ask Groq which segments (or parts of segments) should be removed.
async function getRemovalDecisions(segments) {
    if (!GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is missing from your .env file.");
    }

    const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: GROQ_MODEL,

                messages: [
                    {
                        role: "system",
                        content: SYSTEM_PROMPT
                    },
                    {
                        role: "user",
                        content:
                            "Review this recording and identify the subtitle IDs (or parts of subtitles) to remove:\n\n" +
                            JSON.stringify(segments, null, 2)
                    }
                ],

                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "editorial_decisions",
                        strict: true,
                        schema: {
                            type: "object",
                            properties: {
                                analysis: {
                                    type: "array",
                                    items: { type: "string" }
                                },
                                remove_segment_ids: {
                                    type: "array",
                                    items: { type: "integer" }
                                },
                                partial_removals: {
                                    type: "array",
                                    items: {
                                        type: "object",
                                        properties: {
                                            segment_id: { type: "integer" },
                                            remove_text: { type: "string" }
                                        },
                                        required: ["segment_id", "remove_text"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: [
                                "analysis",
                                "remove_segment_ids",
                                "partial_removals"
                            ],
                            additionalProperties: false
                        }
                    }
                },

                max_completion_tokens: 8192,
                reasoning_effort: "medium"
            })
        }
    );

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(
            `Groq API error (${response.status}):\n${responseText}`
        );
    }

    let data;

    try {
        data = JSON.parse(responseText);
    } catch {
        throw new Error("Groq returned an invalid API response.");
    }

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error("Groq returned an empty response.");
    }

    let result;

    try {
        result = JSON.parse(content);
    } catch {
        throw new Error(
            `Could not parse Groq's editorial decisions:\n${content}`
        );
    }

    if (
        !Array.isArray(result.remove_segment_ids) ||
        !Array.isArray(result.partial_removals)
    ) {
        throw new Error("Groq returned an invalid response shape.");
    }

    if (Array.isArray(result.analysis) && result.analysis.length > 0) {
        console.log("Model analysis:");
        for (const note of result.analysis) {
            console.log(`  - ${note}`);
        }
        console.log("");
    }

    const validIds = new Set(segments.map(segment => segment.id));

    for (const id of result.remove_segment_ids) {
        if (!Number.isInteger(id) || !validIds.has(id)) {
            throw new Error(`Groq returned an unknown segment ID: ${id}`);
        }
    }

    const removeIds = new Set(result.remove_segment_ids);
    const partials = new Map(); // segment id -> array of snippets

    for (const item of result.partial_removals) {
        if (!validIds.has(item.segment_id)) {
            console.warn(
                `Ignoring partial removal for unknown ID ${item.segment_id}`
            );
            continue;
        }

        // A whole-segment removal always wins over a partial one.
        if (removeIds.has(item.segment_id)) {
            continue;
        }

        if (!partials.has(item.segment_id)) {
            partials.set(item.segment_id, []);
        }

        partials.get(item.segment_id).push(item.remove_text);
    }

    return { removeIds, partials };
}

// Wrap each snippet found in the text with [ ].
// Snippets that can't be found verbatim are skipped, so the text stays
// untouched (safe default: nothing gets wrongly deleted).
function markPartialText(text, snippets, id) {
    const lowerText = text.toLowerCase();
    const ranges = [];

    for (const raw of snippets) {
        const snippet = raw.trim();

        if (!snippet) {
            continue;
        }

        const lowerSnippet = snippet.toLowerCase();
        let start = -1;
        let from = 0;

        // Find the first occurrence that doesn't overlap an existing range.
        while (true) {
            const idx = lowerText.indexOf(lowerSnippet, from);

            if (idx === -1) {
                break;
            }

            const end = idx + snippet.length;

            if (!ranges.some(([s, e]) => idx < e && end > s)) {
                start = idx;
                break;
            }

            from = idx + 1;
        }

        if (start === -1) {
            console.warn(
                `[${id}] Partial text not found, skipped: "${snippet}"`
            );
            continue;
        }

        ranges.push([start, start + snippet.length]);
    }

    ranges.sort((a, b) => a[0] - b[0]);

    let result = "";
    let cursor = 0;

    for (const [s, e] of ranges) {
        result += text.slice(cursor, s) + "[" + text.slice(s, e) + "]";
        cursor = e;
    }

    return result + text.slice(cursor);
}

// Apply decisions to the ORIGINAL SRT.
// No transcript text is rewritten or reconstructed by Groq.
function applyAnnotations(parts, blocks, removeIds, partials) {
    const outputParts = [...parts];

    for (const block of blocks) {
        let annotatedText = block.text;

        if (removeIds.has(block.id)) {
            annotatedText = `[${block.text}]`;
        } else if (partials.has(block.id)) {
            annotatedText = markPartialText(
                block.text,
                partials.get(block.id),
                block.id
            );
        }

        outputParts[block.partIndex] =
            block.prefix +
            annotatedText +
            block.trailingNewlines;
    }

    return outputParts.join("");
}

// Main function.
export async function cleanTranscript() {
    console.log("Reading transcript...");

    const originalTranscript = await fs.readFile(
        INPUT_PATH,
        "utf8"
    );

    const { parts, segments, blocks } = parseSrt(originalTranscript);

    console.log(`Found ${segments.length} subtitle segments.`);
    console.log(`Using Groq model: ${GROQ_MODEL}`);
    console.log("Sending transcript to Groq for editorial decisions...\n");

    const { removeIds, partials } = await getRemovalDecisions(segments);

    console.log("Editorial decisions received.");
    console.log(`Segments fully removed: ${removeIds.size}`);
    console.log(`Segments partially trimmed: ${partials.size}`);
    console.log(
        `Segments untouched: ${
            segments.length - removeIds.size - partials.size
        }\n`
    );

    const annotatedTranscript = applyAnnotations(
        parts,
        blocks,
        removeIds,
        partials
    );

    await fs.writeFile(
        OUTPUT_PATH,
        annotatedTranscript,
        "utf8"
    );

    console.log("Annotated transcript saved:");
    console.log(OUTPUT_PATH);

    console.log("\nSegments fully marked for removal:");

    for (const segment of segments) {
        if (removeIds.has(segment.id)) {
            console.log(`[${segment.id}] ${segment.text}`);
        }
    }

    console.log("\nSegments partially marked:");

    for (const block of blocks) {
        if (partials.has(block.id)) {
            console.log(
                `[${block.id}] ${markPartialText(
                    block.text,
                    partials.get(block.id),
                    block.id
                )}`
            );
        }
    }

    return annotatedTranscript;
}

export default cleanTranscript;