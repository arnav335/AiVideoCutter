import "dotenv/config";

import { convertToWav, processInputDirectory } from "./utils/convertToWav.js";
import { transcribeRawAudio } from "./functions/transcribe.js";
import { removeLongPauses } from "./functions/remove_long_pauses.js";
import { cleanTranscript } from "./functions/cleanTranscript.js";
import renderFinalVideo from "./functions/renderFinalVideo.js";

(async () => {
    // const inputAndOutputPaths = await processInputDirectory();

    // const inputName = inputAndOutputPaths[0];


    // await transcribeRawAudio();


    // const trimmedPath = await removeLongPauses({
    //     inputFileName: inputName,
    //     maxPause: 0.6,
    //     padding: 0.08
    // });
        await transcribeRawAudio({cycle:2}); // tranribing again to match timeline

    await cleanTranscript()
    await renderFinalVideo()
})();